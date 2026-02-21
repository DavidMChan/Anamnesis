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
        poll_interval: float = 2.0,
    ):
        self.db = db
        self.publisher = publisher
        self.poll_interval = poll_interval
        self.running = False

    def dispatch_run(self, run: Dict[str, Any]) -> int:
        """
        Dispatch tasks for a survey run to RabbitMQ.

        Only dispatches tasks with status='pending'. RabbitMQ handles
        redelivery for crashed workers (heartbeat + unacked messages).

        Args:
            run: Survey run record

        Returns:
            Number of tasks dispatched
        """
        run_id = run["id"]
        run_status = run.get("status", "pending")

        tasks = self.db.get_pending_tasks_for_dispatch(run_id)
        if tasks:
            logger.info(f"Found {len(tasks)} pending tasks for run {run_id}")

        if not tasks:
            return 0

        # Publish each task to RabbitMQ
        dispatched = 0
        for task in tasks:
            try:
                # Mark as queued BEFORE publishing to prevent re-dispatch
                self.db.mark_task_queued(task["id"])
                self.publisher.publish_task(run_id, task["id"])
                dispatched += 1
            except Exception as e:
                # If publishing fails, revert to pending so it can be retried
                self.db.update_task_status(task["id"], "pending")
                logger.error(f"Failed to publish task {task['id']}: {e}")

        logger.info(f"Dispatched {dispatched}/{len(tasks)} tasks for run {run_id}")

        # Update run status to 'running' if we dispatched tasks for a pending run
        if dispatched > 0 and run_status == "pending":
            self.db.update_run_status(run_id, "running")

        return dispatched

    def poll_and_dispatch(self) -> int:
        """
        Poll for pending runs and dispatch their tasks.
        Also checks if running runs are complete.

        Returns:
            Total number of tasks dispatched
        """
        pending_runs = self.db.get_runs_needing_dispatch()

        total_dispatched = 0
        for run in pending_runs:
            try:
                dispatched = self.dispatch_run(run)
                total_dispatched += dispatched

                # If running but no tasks to dispatch, check if run is complete
                if dispatched == 0 and run.get("status") == "running":
                    self.db.check_run_completion(run["id"])
            except Exception as e:
                logger.error(f"Error dispatching run {run['id']}: {e}")

        return total_dispatched

    def start(self):
        """Start the dispatcher loop."""
        self.running = True
        logger.info(f"Dispatcher started (poll_interval={self.poll_interval}s)")

        while self.running:
            try:
                dispatched = self.poll_and_dispatch()
                if dispatched > 0:
                    logger.info(f"Dispatched {dispatched} tasks this cycle")
            except Exception as e:
                logger.error(f"Error in dispatch cycle: {e}")

            time.sleep(self.poll_interval)

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
        poll_interval=2.0,
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
