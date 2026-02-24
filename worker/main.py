"""
Main entry point for the async survey worker.

Runs an asyncio event loop that consumes tasks from RabbitMQ.
Concurrency is controlled by the dispatcher (per-run max_concurrent_tasks),
not by the worker. The worker simply processes whatever messages it receives.

Questions within each task are still processed sequentially
(context accumulation), but different tasks run in parallel.
"""
import asyncio
import json
import logging
import signal
import sys
import time
from typing import Optional, Dict, Any

from src.config import get_config, LLMConfig
from src.db import DatabaseClient
from src.llm import UnifiedLLMClient
from src.media import WasabiMediaClient
from src.response import NonRetryableError, MultimodalNotSupportedError
from src.metrics import LatencyTracker, MetricsLogger
from src.parser import ParserLLM
from src.queue import AsyncQueueConsumer
from src.worker import TaskProcessor, IndependentRepeat

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def create_llm_client(llm_config: LLMConfig) -> UnifiedLLMClient:
    """Create an LLM client from config."""
    return UnifiedLLMClient(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key,
        model=llm_config.model,
        provider=llm_config.provider,
        temperature=llm_config.temperature,
        max_tokens=llm_config.max_tokens,
        use_guided_decoding=llm_config.use_guided_decoding,
        use_chat_template=llm_config.use_chat_template,
    )


def create_parser_llm(llm_config: LLMConfig) -> Optional[ParserLLM]:
    """Create a parser LLM from config (Tier 2 fallback for MCQ parsing).

    Parser LLM always uses OpenRouter, so it's only available when the
    main provider is OpenRouter (same API key).
    """
    if llm_config.provider == "openrouter" and llm_config.api_key:
        return ParserLLM(
            api_key=llm_config.api_key,
            model=llm_config.parser_llm_model,
        )
    return None


def get_llm_config_for_run(db: DatabaseClient, run_id: str) -> LLMConfig:
    """
    Get LLM config from a survey run's snapshot. Raises ValueError if missing.

    The snapshot (survey_runs.llm_config) was created at run time and includes
    per-survey overrides for temperature/max_tokens already merged in.
    API keys are fetched from Vault via the owning user.
    """
    ctx = db.get_run_llm_context(run_id)
    if not ctx:
        raise ValueError(f"Survey run {run_id} not found")

    run_config = ctx.get("llm_config")
    user_id = ctx.get("user_id")

    if not run_config or not run_config.get("provider"):
        raise ValueError(f"Survey run {run_id} has no LLM configuration snapshot")
    if not user_id:
        raise ValueError(f"Survey run {run_id} has no associated user")

    # Fetch API key from Vault (not stored in snapshot)
    provider = run_config["provider"]
    api_key = None

    if provider == "openrouter":
        api_key = db.get_user_api_key(user_id, "openrouter")
        if not api_key:
            raise ValueError(
                f"User {user_id} selected OpenRouter but has no API key. "
                "Please add your OpenRouter API key in the Settings page."
            )
    elif provider == "vllm":
        api_key = db.get_user_api_key(user_id, "vllm")

    return LLMConfig.from_user_config(run_config, api_key=api_key)


async def main():
    """Async main entry point."""
    config = get_config()

    logger.info("Initializing async worker...")

    # Database client (sync — calls wrapped in to_thread)
    db = DatabaseClient(config.supabase)

    # Media client (optional — only if Wasabi is configured)
    media_client = None
    if config.wasabi.is_configured:
        media_client = WasabiMediaClient(
            access_key=config.wasabi.access_key_id,
            secret_key=config.wasabi.secret_access_key,
            bucket=config.wasabi.bucket,
            region=config.wasabi.region,
        )
        logger.info(f"Wasabi media client initialized (bucket={config.wasabi.bucket})")
    else:
        logger.info("Wasabi not configured — multimodal media will be skipped")

    # Cache for LLM clients and parser LLMs per survey run
    # (each run snapshots its own temperature/max_tokens)
    llm_cache: Dict[str, UnifiedLLMClient] = {}
    parser_cache: Dict[str, Optional[ParserLLM]] = {}

    # Metrics
    tracker = LatencyTracker(window_seconds=config.worker.metrics_log_interval)
    metrics_logger = MetricsLogger(tracker, interval_seconds=config.worker.metrics_log_interval)

    # In-flight task tracking (for graceful shutdown)
    in_flight_tasks: set[asyncio.Task] = set()
    shutting_down = False

    async def get_llm_for_task(task: Dict[str, Any]) -> tuple[UnifiedLLMClient, Optional[ParserLLM]]:
        """
        Get or create LLM client + parser for a task's survey run.

        Uses the llm_config snapshot stored on survey_runs (includes
        per-survey temperature/max_tokens overrides).
        """
        run_id = task.get("survey_run_id")
        if not run_id:
            raise ValueError(f"Task {task['id']} has no associated survey run")

        if run_id in llm_cache:
            return llm_cache[run_id], parser_cache.get(run_id)

        # Get run's LLM config snapshot + API key from owning user
        run_llm_config = await asyncio.to_thread(
            get_llm_config_for_run, db, run_id
        )
        llm = create_llm_client(run_llm_config)
        parser_llm = create_parser_llm(run_llm_config)

        llm_cache[run_id] = llm
        parser_cache[run_id] = parser_llm
        api_mode = "chat" if run_llm_config.use_chat_template else "completions"
        logger.info(f"Created LLM client for run {run_id}: {run_llm_config.provider} "
                     f"(mode={api_mode}, temp={run_llm_config.temperature}, max_tokens={run_llm_config.max_tokens})")
        if parser_llm:
            logger.info(f"Parser LLM enabled for run {run_id}: {run_llm_config.parser_llm_model}")

        return llm, parser_llm

    async def handle_message(message) -> None:
        """
        Process a single message from RabbitMQ.

        Flow:
        1. Fetch task (single DB call)
        2. start_task → get attempt count
        3. Check max retries → fail permanently if exceeded
        4. Get LLM client (cached after first call per user)
        5. Process task
        6. Success → ACK
        7. Retryable error → nack(requeue=True)
        8. Non-retryable error → fail_task + ACK
        """
        task_id = None
        try:
            body = json.loads(message.body.decode("utf-8"))
            task_id = body.get("task_id")

            if not task_id:
                logger.error(f"Invalid message, missing task_id: {body}")
                await message.ack()
                return

            logger.info(f"Processing task: {task_id}")

            # 1. Fetch task once (single DB call for all downstream use)
            task = await asyncio.to_thread(db.get_task, task_id)
            if not task:
                logger.warning(f"Task {task_id} not found (survey likely deleted), discarding message")
                await message.ack()
                return

            # 1b. Check if run is cancelled/completed/failed — skip if so
            run_status = await asyncio.to_thread(db.get_run_status, task["survey_run_id"])
            if run_status in ("cancelled", "completed", "failed"):
                logger.info(f"Skipping task {task_id} — run {task['survey_run_id']} is {run_status}")
                await message.ack()
                return

            # 2. Start task: set status=processing, increment attempts
            attempts = await asyncio.to_thread(db.start_task, task_id)

            # 3. Check max retries
            if attempts > config.worker.max_retries:
                logger.error(f"Task {task_id} exceeded max retries ({attempts}/{config.worker.max_retries})")
                await asyncio.to_thread(db.fail_task, task_id, f"Max retries ({config.worker.max_retries}) exceeded")
                await message.ack()
                return

            # 4. Get LLM client (cached per user)
            try:
                llm, parser_llm = await get_llm_for_task(task)
            except ValueError as e:
                # Config errors won't self-resolve — fail permanently
                error_msg = str(e)
                logger.error(f"Task {task_id} config error: {error_msg}")
                await asyncio.to_thread(db.fail_task, task_id, error_msg)
                await message.ack()
                return

            # 5. Detect demographic survey and choose strategy
            demo_key_info = await asyncio.to_thread(
                db.get_demographic_key_for_survey, task["survey_run_id"]
            )
            is_demographic = demo_key_info is not None

            strategy = None
            if is_demographic:
                num_trials = demo_key_info.get("num_trials", 20)
                strategy = IndependentRepeat(num_trials=num_trials)
                logger.info(f"Task {task_id}: demographic survey, using IndependentRepeat(n={num_trials})")

            processor = TaskProcessor(
                db=db,
                llm=llm,
                max_retries=config.worker.max_retries,
                parser_llm=parser_llm,
                media_client=media_client,
                strategy=strategy,
            )

            start = time.monotonic()
            result = await processor.async_process_task(task)
            duration_ms = (time.monotonic() - start) * 1000
            tracker.record(duration_ms)

            # 5b. For demographic surveys, compute distribution and write back
            if is_demographic and result.success and result.result:
                demo_key = demo_key_info["key"]
                backstory_id = task["backstory_id"]

                for qkey, raw_answers_str in result.result.items():
                    # Parse the N answers (joined by '||')
                    answers = [a for a in raw_answers_str.split("||") if a]
                    if not answers:
                        continue

                    # Compute frequency distribution
                    counts: dict[str, int] = {}
                    for ans in answers:
                        counts[ans] = counts.get(ans, 0) + 1
                    total = len(answers)
                    distribution = {k: round(v / total, 4) for k, v in counts.items()}

                    # Find mode (most frequent answer)
                    value = max(counts, key=counts.get)  # type: ignore[arg-type]

                    logger.info(f"Task {task_id}: writing demographic result "
                                f"{demo_key}={value} (dist={distribution})")

                    await asyncio.to_thread(
                        db.write_demographic_result,
                        backstory_id, demo_key, value, distribution,
                    )

            # 6. Success → ACK
            logger.info(f"Task {task_id} completed successfully ({duration_ms:.0f}ms)")
            await message.ack()

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON message: {e}")
            await message.nack(requeue=False)
        except MultimodalNotSupportedError as e:
            # Multimodal not supported → fail entire run, not just this task
            logger.error(f"Task {task_id} multimodal not supported: {e}")
            if task_id:
                await asyncio.to_thread(
                    db.fail_task, task_id,
                    "This model does not support multimodal input (images/audio). "
                    "Please use a vision-capable model."
                )
            await message.ack()
        except NonRetryableError as e:
            # 8. Non-retryable → fail permanently + ACK
            logger.error(f"Task {task_id} non-retryable error: {e}")
            if task_id:
                await asyncio.to_thread(db.fail_task, task_id, str(e))
            await message.ack()
        except Exception as e:
            # 7. Retryable → nack for redelivery
            logger.warning(f"Task {task_id} retryable error, requeueing: {e}", exc_info=True)
            await message.nack(requeue=True)

    # Set up RabbitMQ consumer
    consumer = AsyncQueueConsumer(config.rabbitmq)

    # Graceful shutdown
    shutdown_event = asyncio.Event()

    def on_shutdown(signum, frame):
        nonlocal shutting_down
        if shutting_down:
            logger.warning("Force shutdown requested, exiting immediately")
            sys.exit(1)
        shutting_down = True
        logger.info(f"Shutdown signal received ({signal.Signals(signum).name}), "
                     f"waiting for {len(in_flight_tasks)} in-flight tasks...")
        shutdown_event.set()

    signal.signal(signal.SIGINT, on_shutdown)
    signal.signal(signal.SIGTERM, on_shutdown)

    # Connect and start consuming
    try:
        await consumer.connect()
        logger.info(f"Async worker started, consuming from {config.rabbitmq.queue_name}")

        async for message in consumer:
            if shutting_down:
                # Nack unprocessed messages so they go back to queue
                await message.nack(requeue=True)
                break

            task = asyncio.create_task(handle_message(message))
            in_flight_tasks.add(task)
            task.add_done_callback(in_flight_tasks.discard)

            # Log metrics periodically
            metrics_logger.maybe_log(in_flight=len(in_flight_tasks))

    except Exception as e:
        if not shutting_down:
            logger.error(f"Consumer error: {e}", exc_info=True)

    # Wait for in-flight tasks to complete
    if in_flight_tasks:
        logger.info(f"Waiting for {len(in_flight_tasks)} in-flight tasks to complete...")
        try:
            await asyncio.wait(in_flight_tasks, timeout=120)
        except Exception:
            pass

        # Nack any that didn't finish
        remaining = [t for t in in_flight_tasks if not t.done()]
        if remaining:
            logger.warning(f"{len(remaining)} tasks didn't complete in time, they will be redelivered")
            for t in remaining:
                t.cancel()

    # Close LLM clients
    for llm in llm_cache.values():
        await llm.close()
    for parser in parser_cache.values():
        if parser:
            await parser.close()

    await consumer.close()
    logger.info("Worker shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
