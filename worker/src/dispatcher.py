"""
Task Dispatcher - Publishes pending tasks from database to RabbitMQ.

This is the "Backend (enqueue)" component in the architecture:
    PostgreSQL → Dispatcher → RabbitMQ → Worker

Run this alongside the worker:
    python -m src.dispatcher
"""
import logging
import signal
import sys
import time
from typing import List, Dict, Any

from .config import get_config
from .db import DatabaseClient
from .queue import QueuePublisher
from .bayesian_stability import compute_adaptive_sampling_state

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class TaskDispatcher:
    """
    Watches for new survey runs and publishes their tasks to RabbitMQ.
    """

    def __init__(
        self,
        db: DatabaseClient,
        publisher: QueuePublisher,
    ):
        self.db = db
        self.publisher = publisher
        self.running = False
        self._adaptive_check_cache: Dict[str, Dict[str, Any]] = {}

    def dispatch_run(self, run: Dict[str, Any]) -> int:
        """
        Dispatch tasks for a survey run to RabbitMQ.

        Throttles dispatch based on the run's max_concurrent_tasks setting
        (from llm_config snapshot). Only pushes enough tasks to fill available
        concurrency slots, so the total in-flight never exceeds the limit
        regardless of how many workers are running.

        Args:
            run: Survey run record

        Returns:
            Number of tasks dispatched
        """
        run_id = run["id"]
        run_status = run.get("status", "pending")

        # Get max_concurrent from the run's llm_config snapshot
        llm_config = run.get("llm_config", {}) or {}
        max_concurrent = llm_config.get("max_concurrent_tasks", 10)

        # Count tasks currently in-flight (queued + processing)
        in_flight = self.db.get_in_flight_count(run_id)
        slots_available = max(0, max_concurrent - in_flight)

        if slots_available == 0:
            return 0

        # Only fetch and dispatch up to slots_available tasks
        tasks = self.db.get_pending_tasks_for_dispatch(run_id, limit=slots_available)
        if not tasks:
            return 0

        if len(tasks) > 0:
            logger.info(f"Found {len(tasks)} pending tasks for run {run_id} "
                        f"(in_flight={in_flight}, max_concurrent={max_concurrent})")

        # Batch-mark all tasks as queued in one UPDATE, then publish individually.
        # Reverting on publish failure is safe: only that task goes back to pending.
        task_ids = [task["id"] for task in tasks]
        self.db.mark_tasks_queued(task_ids)

        dispatched = 0
        for task in tasks:
            try:
                self.publisher.publish_task(run_id, task["id"])
                dispatched += 1
            except Exception as e:
                # Revert this single task so it can be re-dispatched next cycle
                self.db.update_task_status(task["id"], "pending")
                logger.error(f"Failed to publish task {task['id']}: {e}")

        if dispatched > 0:
            logger.info(f"Dispatched {dispatched} tasks for run {run_id}")

        # Update run status to 'running' if we dispatched tasks for a pending run
        if dispatched > 0 and run_status == "pending":
            self.db.update_run_status(run_id, "running")

        return dispatched

    def maybe_complete_adaptive_run(self, run: Dict[str, Any]) -> bool:
        """
        Finish adaptive-sampling runs once completed MCQ results are stable.

        Returns True when the run was completed early and should not dispatch
        more work this cycle.
        """
        llm_config = run.get("llm_config", {}) or {}
        adaptive = llm_config.get("adaptive_sampling") or {}
        if not adaptive.get("enabled"):
            return False
        if llm_config.get("distribution_mode") in ("n_sample", "logprobs"):
            return False

        run_id = run["id"]
        cache = self._adaptive_check_cache.setdefault(run_id, {})

        try:
            epsilon = float(adaptive.get("epsilon", 0.01))
        except (TypeError, ValueError):
            epsilon = 0.01
        try:
            min_samples = max(2, int(adaptive.get("min_samples", 30)))
        except (TypeError, ValueError):
            min_samples = 30
        if epsilon <= 0 or epsilon >= 1:
            if not cache.get("invalid_epsilon_logged"):
                logger.warning(f"Run {run_id} has invalid adaptive epsilon={epsilon}; skipping adaptive stop")
                cache["invalid_epsilon_logged"] = True
            return False

        completed = int(run.get("completed_tasks") or 0)
        if completed < min_samples:
            return False
        last_checked_completed = int(cache.get("last_checked_completed") or 0)
        check_stride = max(1, int(adaptive.get("check_every_samples", 5) or 5))
        total_tasks = int(run.get("total_tasks") or 0)
        if (
            last_checked_completed
            and completed < total_tasks
            and completed - last_checked_completed < check_stride
        ):
            return False

        results = self.db.get_completed_results_for_run(run_id)
        cache["last_checked_completed"] = completed

        questions = self.db.get_survey_questions(run_id)
        state = compute_adaptive_sampling_state(questions, results, epsilon, min_samples)
        if not state:
            return False

        if not state.should_stop:
            return False

        self.db.complete_run_early(run_id)
        logger.info(
            f"Adaptive sampling completed run {run_id} early: "
            f"samples={state.sample_count}, eligible_questions={state.eligible_questions}, "
            f"confidence_lower_bound={state.confidence_lower_bound:.4f}"
        )
        return True

    def poll_and_dispatch(self) -> tuple[int, int]:
        """
        Poll for pending runs and dispatch their tasks.
        Also checks if running runs are complete.

        Returns:
            (runs_found, total_dispatched) — used by start() to compute adaptive sleep.
        """
        pending_runs = self.db.get_runs_needing_dispatch()

        total_dispatched = 0
        for run in pending_runs:
            try:
                reset = self.db.reset_stale_tasks(run["id"])
                if reset > 0:
                    logger.warning(f"Reset {reset} stale tasks for run {run['id']}")

                if self.maybe_complete_adaptive_run(run):
                    continue

                dispatched = self.dispatch_run(run)
                total_dispatched += dispatched

                # Sync counters and check completion for all active runs.
                # Note: demographic_keys.status is updated automatically by a DB
                # trigger (trg_auto_finish_demographic_key) when the run completes,
                # so no Python-side bookkeeping is needed here.
                old_status = run.get("status")
                if old_status == "running" or (dispatched > 0 and old_status == "pending"):
                    self.db.check_run_completion(run["id"])
            except Exception as e:
                logger.error(f"Error dispatching run {run['id']}: {e}")

        return len(pending_runs), total_dispatched

    def start(self):
        """Start the dispatcher loop with adaptive poll interval.

        Sleep times:
          - busy  (tasks dispatched):        1s
          - active (runs exist, none queued): 3s
          - idle   (no active runs):          5s
        """
        self.running = True
        logger.info("Dispatcher started (adaptive poll: idle=5s active=3s busy=1s)")

        while self.running:
            try:
                runs_found, dispatched = self.poll_and_dispatch()
                if dispatched > 0:
                    logger.info(f"Dispatched {dispatched} tasks this cycle")
            except Exception as e:
                logger.error(f"Error in dispatch cycle: {e}")
                runs_found, dispatched = 0, 0

            if dispatched > 0:
                sleep_time = 1.0
            elif runs_found > 0:
                sleep_time = 3.0
            else:
                sleep_time = 5.0

            time.sleep(sleep_time)

    def stop(self):
        """Stop the dispatcher loop."""
        self.running = False
        logger.info("Dispatcher stopping...")


def main():
    """Main entry point for the dispatcher."""
    config = get_config()

    # Initialize components
    logger.info("Initializing dispatcher...")

    db = DatabaseClient(config.supabase)
    publisher = QueuePublisher(config.rabbitmq)

    # Connect to RabbitMQ
    publisher.connect()

    # Create dispatcher
    dispatcher = TaskDispatcher(
        db=db,
        publisher=publisher,
    )

    # Signal handlers for graceful shutdown
    def shutdown(signum, frame):
        logger.info("Shutting down dispatcher...")
        dispatcher.stop()
        publisher.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Start dispatcher
    try:
        logger.info("Dispatcher ready, watching for new survey runs...")
        dispatcher.start()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    finally:
        publisher.disconnect()


if __name__ == "__main__":
    main()
