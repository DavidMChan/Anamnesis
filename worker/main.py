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


def get_llm_config_for_user(db: DatabaseClient, user_id: str, default_config: LLMConfig) -> LLMConfig:
    """
    Get LLM config for a user with fallback to environment defaults.

    Args:
        db: Database client
        user_id: UUID of the user
        default_config: Default config from environment

    Returns:
        LLMConfig with user settings or defaults
    """
    user_config = db.get_user_llm_config(user_id)

    if not user_config or not user_config.get("provider"):
        logger.debug(f"No user config for {user_id}, using defaults")
        return default_config

    # Fetch API keys from Vault based on provider
    provider = user_config.get("provider", "openrouter")
    openrouter_key = None
    vllm_key = None

    if provider == "openrouter":
        openrouter_key = db.get_user_api_key(user_id, "openrouter")
        if not openrouter_key:
            logger.warning(f"User {user_id} selected openrouter but has no API key, using default")
            openrouter_key = default_config.openrouter_api_key
    elif provider == "vllm":
        vllm_key = db.get_user_api_key(user_id, "vllm")
        # vLLM key is optional, fallback to default only if user has none AND default exists
        if not vllm_key and default_config.vllm_api_key:
            vllm_key = default_config.vllm_api_key

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

    # Default LLM config (from environment)
    default_llm_config = config.llm

    # Cache for LLM clients and parser LLMs per user
    llm_cache: Dict[str, BaseLLMClient] = {}
    parser_cache: Dict[str, Optional[ParserLLM]] = {}

    def get_llm_for_task(task_id: str) -> tuple[BaseLLMClient, Optional[ParserLLM]]:
        """
        Get or create LLM client + parser for a task based on the survey run's user.

        Args:
            task_id: UUID of the task

        Returns:
            Tuple of (LLM client, parser LLM) configured for the user
        """
        # Get task to find run_id
        task = db.get_task(task_id)
        if not task:
            logger.warning(f"Task {task_id} not found, using default LLM config")
            return create_llm_client(default_llm_config), create_parser_llm(default_llm_config)

        run_id = task.get("survey_run_id")
        if not run_id:
            logger.warning(f"Task {task_id} has no run_id, using default LLM config")
            return create_llm_client(default_llm_config), create_parser_llm(default_llm_config)

        # Get user_id from survey run
        user_id = db.get_survey_run_user_id(run_id)
        if not user_id:
            logger.warning(f"Run {run_id} has no user_id, using default LLM config")
            return create_llm_client(default_llm_config), create_parser_llm(default_llm_config)

        # Check cache
        if user_id in llm_cache:
            return llm_cache[user_id], parser_cache.get(user_id)

        # Get user's LLM config and create client
        user_llm_config = get_llm_config_for_user(db, user_id, default_llm_config)
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

        # Get LLM client for this task's user
        llm, parser_llm = get_llm_for_task(task_id)

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
