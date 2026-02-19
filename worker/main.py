"""
Main entry point for the survey worker.
"""
import logging
import signal
import sys
from typing import Optional, Dict, Any

from src.config import get_config, LLMConfig
from src.db import DatabaseClient
from src.llm import LLMClient, VLLMClient, BaseLLMClient
from src.parser import ParserLLM
from src.queue import QueueConsumer
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


def main():
    """Main entry point."""
    config = get_config()

    # Initialize components
    logger.info("Initializing worker...")

    # Database client
    db = DatabaseClient(config.supabase)

    # Cache for LLM clients and parser LLMs per user
    llm_cache: Dict[str, BaseLLMClient] = {}
    parser_cache: Dict[str, Optional[ParserLLM]] = {}

    def get_llm_for_task(task_id: str) -> tuple[BaseLLMClient, Optional[ParserLLM]]:
        """
        Get or create LLM client + parser for a task based on the survey run's user.

        Raises ValueError if the task/run/user chain is broken or user has no config.
        """
        # Get task to find run_id
        task = db.get_task(task_id)
        if not task:
            raise ValueError(f"Task {task_id} not found in database")

        run_id = task.get("survey_run_id")
        if not run_id:
            raise ValueError(f"Task {task_id} has no associated survey run")

        # Get user_id from survey run
        user_id = db.get_survey_run_user_id(run_id)
        if not user_id:
            raise ValueError(f"Survey run {run_id} has no associated user")

        # Check cache
        if user_id in llm_cache:
            return llm_cache[user_id], parser_cache.get(user_id)

        # Get user's LLM config and create client
        user_llm_config = get_llm_config_for_user(db, user_id)
        llm = create_llm_client(user_llm_config)
        parser_llm = create_parser_llm(user_llm_config)

        # Cache
        llm_cache[user_id] = llm
        parser_cache[user_id] = parser_llm
        logger.info(f"Created LLM client for user {user_id}: {user_llm_config.provider}")
        if parser_llm:
            logger.info(f"Parser LLM enabled for user {user_id}: {user_llm_config.parser_llm_model}")

        return llm, parser_llm

    # Message handler
    def on_message(message: dict):
        """Process a message from the queue."""
        task_id = message.get("task_id")
        if not task_id:
            logger.error(f"Invalid message, missing task_id: {message}")
            return

        logger.info(f"Processing task: {task_id}")

        try:
            # Get LLM client for this task's user
            llm, parser_llm = get_llm_for_task(task_id)
        except ValueError as e:
            # Config errors won't self-resolve — fail the task permanently
            error_msg = str(e)
            logger.error(f"Task {task_id} config error: {error_msg}")

            db.fail_task(task_id, error_msg)

            # Also log to the survey run if we can find it
            task = db.get_task(task_id)
            if task and task.get("survey_run_id"):
                run_id = task["survey_run_id"]
                db.append_run_error(run_id, task_id, error_msg)
                db.check_run_completion(run_id)

            return

        # Create processor with the appropriate LLM client
        processor = TaskProcessor(
            db=db,
            llm=llm,
            max_retries=config.worker.max_retries,
            parser_llm=parser_llm,
        )

        result = processor.process_task(task_id)

        if result.success:
            logger.info(f"Task {task_id} completed successfully")
        else:
            logger.warning(f"Task {task_id} failed: {result.error}")

    # Queue consumer
    consumer = QueueConsumer(config.rabbitmq, on_message=on_message)

    # Signal handlers for graceful shutdown
    def shutdown(signum, frame):
        logger.info("Shutting down worker...")
        consumer.stop_consuming()
        consumer.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Connect and start consuming
    try:
        consumer.connect()
        logger.info("Worker started, waiting for tasks...")
        consumer.start_consuming()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    finally:
        consumer.disconnect()


if __name__ == "__main__":
    main()
