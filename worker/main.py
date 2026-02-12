"""
Main entry point for the survey worker.
"""
import logging
import signal
import sys

from src.config import get_config
from src.db import DatabaseClient
from src.llm import LLMClient
from src.queue import QueueConsumer
from src.worker import TaskProcessor

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    """Main entry point."""
    config = get_config()

    # Initialize components
    logger.info("Initializing worker...")

    # Database client
    db = DatabaseClient(config.supabase)

    # LLM client
    llm_config = config.llm
    if llm_config.provider == "openrouter":
        llm = LLMClient.create(
            provider="openrouter",
            api_key=llm_config.openrouter_api_key,
            model=llm_config.openrouter_model,
            temperature=llm_config.temperature,
            max_tokens=llm_config.max_tokens,
        )
    elif llm_config.provider == "vllm":
        llm = LLMClient.create(
            provider="vllm",
            endpoint=llm_config.vllm_endpoint,
            model=llm_config.vllm_model,
            api_key=llm_config.vllm_api_key or None,
            temperature=llm_config.temperature,
            max_tokens=llm_config.max_tokens,
        )
    else:
        raise ValueError(f"Unknown LLM provider: {llm_config.provider}")

    # Task processor
    processor = TaskProcessor(
        db=db,
        llm=llm,
        max_retries=config.worker.max_retries,
    )

    # Message handler
    def on_message(message: dict):
        """Process a message from the queue."""
        task_id = message.get("task_id")
        if not task_id:
            logger.error(f"Invalid message, missing task_id: {message}")
            return

        logger.info(f"Processing task: {task_id}")
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
