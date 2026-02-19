"""
Main entry point for the async survey worker.

Runs an asyncio event loop that consumes tasks from RabbitMQ and
processes them concurrently (up to MAX_CONCURRENT_TASKS at a time).

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
from src.llm import LLMClient, VLLMClient, BaseLLMClient
from src.metrics import LatencyTracker, MetricsLogger
from src.parser import ParserLLM
from src.queue import AsyncQueueConsumer
from src.worker import TaskProcessor

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def create_llm_client(llm_config: LLMConfig) -> BaseLLMClient:
    """Create an LLM client from config."""
    if llm_config.provider == "openrouter":
        return LLMClient.create(
            provider="openrouter",
            api_key=llm_config.openrouter_api_key,
            model=llm_config.openrouter_model,
            temperature=llm_config.temperature,
            max_tokens=llm_config.max_tokens,
        )
    elif llm_config.provider == "vllm":
        return VLLMClient(
            endpoint=llm_config.vllm_endpoint,
            model=llm_config.vllm_model,
            api_key=llm_config.vllm_api_key or None,
            temperature=llm_config.temperature,
            max_tokens=llm_config.max_tokens if llm_config.max_tokens is not None else 128,
            use_guided_decoding=llm_config.use_guided_decoding,
        )
    else:
        raise ValueError(f"Unknown LLM provider: {llm_config.provider}")


def create_parser_llm(llm_config: LLMConfig) -> Optional[ParserLLM]:
    """Create a parser LLM from config (Tier 2 fallback for MCQ parsing)."""
    if llm_config.openrouter_api_key:
        return ParserLLM(
            api_key=llm_config.openrouter_api_key,
            model=llm_config.parser_llm_model,
        )
    return None


def get_llm_config_for_user(db: DatabaseClient, user_id: str) -> LLMConfig:
    """
    Get LLM config for a user. Raises ValueError if not configured.

    Args:
        db: Database client
        user_id: UUID of the user

    Returns:
        LLMConfig from user's database settings

    Raises:
        ValueError: If user has no LLM config or it is incomplete
    """
    user_config = db.get_user_llm_config(user_id)

    if not user_config or not user_config.get("provider"):
        raise ValueError(
            f"User {user_id} has no LLM configuration. "
            "Please configure LLM settings in the Settings page."
        )

    # Fetch API keys from Vault based on provider
    provider = user_config["provider"]
    openrouter_key = None
    vllm_key = None

    if provider == "openrouter":
        openrouter_key = db.get_user_api_key(user_id, "openrouter")
        if not openrouter_key:
            raise ValueError(
                f"User {user_id} selected OpenRouter but has no API key. "
                "Please add your OpenRouter API key in the Settings page."
            )
    elif provider == "vllm":
        vllm_key = db.get_user_api_key(user_id, "vllm")
        # vLLM key is optional — some deployments don't need auth

    return LLMConfig.from_user_config(
        user_config,
        openrouter_api_key=openrouter_key,
        vllm_api_key=vllm_key,
    )


async def main():
    """Async main entry point."""
    config = get_config()
    max_concurrent = config.worker.max_concurrent_tasks

    logger.info(f"Initializing async worker (max_concurrent_tasks={max_concurrent})...")

    # Database client (sync — calls wrapped in to_thread)
    db = DatabaseClient(config.supabase)

    # Cache for LLM clients and parser LLMs per user
    llm_cache: Dict[str, BaseLLMClient] = {}
    parser_cache: Dict[str, Optional[ParserLLM]] = {}

    # Metrics
    tracker = LatencyTracker(window_seconds=config.worker.metrics_log_interval)
    metrics_logger = MetricsLogger(tracker, interval_seconds=config.worker.metrics_log_interval)

    # Concurrency control
    semaphore = asyncio.Semaphore(max_concurrent)
    in_flight_tasks: set[asyncio.Task] = set()
    shutting_down = False

    async def get_llm_for_task(task_id: str) -> tuple[BaseLLMClient, Optional[ParserLLM]]:
        """
        Get or create LLM client + parser for a task based on the survey run's user.

        Raises ValueError if the task/run/user chain is broken or user has no config.
        """
        task = await asyncio.to_thread(db.get_task, task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found in database")

        run_id = task.get("survey_run_id")
        if not run_id:
            raise ValueError(f"Task {task_id} has no associated survey run")

        user_id = await asyncio.to_thread(db.get_survey_run_user_id, run_id)
        if not user_id:
            raise ValueError(f"Survey run {run_id} has no associated user")

        if user_id in llm_cache:
            return llm_cache[user_id], parser_cache.get(user_id)

        # Get user's LLM config and create client
        user_llm_config = await asyncio.to_thread(
            get_llm_config_for_user, db, user_id
        )
        llm = create_llm_client(user_llm_config)
        parser_llm = create_parser_llm(user_llm_config)

        llm_cache[user_id] = llm
        parser_cache[user_id] = parser_llm
        logger.info(f"Created LLM client for user {user_id}: {user_llm_config.provider}")
        if parser_llm:
            logger.info(f"Parser LLM enabled for user {user_id}: {user_llm_config.parser_llm_model}")

        return llm, parser_llm

    async def handle_message(message) -> None:
        """Process a single message from RabbitMQ."""
        try:
            body = json.loads(message.body.decode("utf-8"))
            task_id = body.get("task_id")

            if not task_id:
                logger.error(f"Invalid message, missing task_id: {body}")
                await message.ack()
                return

            logger.info(f"Processing task: {task_id}")

            try:
                llm, parser_llm = await get_llm_for_task(task_id)
            except ValueError as e:
                # Config errors won't self-resolve — fail the task permanently
                error_msg = str(e)
                logger.error(f"Task {task_id} config error: {error_msg}")

                await asyncio.to_thread(db.fail_task, task_id, error_msg)

                # Also log to the survey run if we can find it
                task = await asyncio.to_thread(db.get_task, task_id)
                if task and task.get("survey_run_id"):
                    run_id = task["survey_run_id"]
                    await asyncio.to_thread(db.append_run_error, run_id, task_id, error_msg)
                    await asyncio.to_thread(db.check_run_completion, run_id)

                await message.ack()
                return

            processor = TaskProcessor(
                db=db,
                llm=llm,
                max_retries=config.worker.max_retries,
                parser_llm=parser_llm,
            )

            start = time.monotonic()
            result = await processor.async_process_task(task_id)
            duration_ms = (time.monotonic() - start) * 1000
            tracker.record(duration_ms)

            if result.success:
                logger.info(f"Task {task_id} completed successfully ({duration_ms:.0f}ms)")
            else:
                logger.warning(f"Task {task_id} failed: {result.error}")

            await message.ack()

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON message: {e}")
            await message.nack(requeue=False)
        except Exception as e:
            logger.error(f"Error processing message: {e}", exc_info=True)
            await message.nack(requeue=True)

    async def process_with_semaphore(message) -> None:
        """Acquire semaphore then process message."""
        async with semaphore:
            await handle_message(message)
            # Log metrics periodically
            metrics_logger.maybe_log(
                in_flight=len(in_flight_tasks),
                max_concurrent=max_concurrent,
            )

    # Set up RabbitMQ consumer with prefetch = max_concurrent
    config.rabbitmq.prefetch_count = max_concurrent
    consumer = AsyncQueueConsumer(config.rabbitmq, prefetch_count=max_concurrent)

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
        logger.info(
            f"Async worker started, consuming from {config.rabbitmq.queue_name} "
            f"(max_concurrent={max_concurrent})"
        )

        async for message in consumer:
            if shutting_down:
                # Nack unprocessed messages so they go back to queue
                await message.nack(requeue=True)
                break

            task = asyncio.create_task(process_with_semaphore(message))
            in_flight_tasks.add(task)
            task.add_done_callback(in_flight_tasks.discard)

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
