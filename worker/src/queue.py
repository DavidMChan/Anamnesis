"""
RabbitMQ queue consumer module.
"""
import json
import logging
from typing import Callable, Optional

import pika
from pika.adapters.blocking_connection import BlockingChannel

from .config import RabbitMQConfig

logger = logging.getLogger(__name__)


class QueueConsumer:
    """RabbitMQ consumer for survey tasks."""

    def __init__(
        self,
        config: Optional[RabbitMQConfig] = None,
        on_message: Optional[Callable[[dict], None]] = None,
    ):
        """
        Initialize queue consumer.

        Args:
            config: RabbitMQ configuration
            on_message: Callback function for processing messages
        """
        if config is None:
            config = RabbitMQConfig()
        self.config = config
        self.on_message = on_message
        self.connection: Optional[pika.BlockingConnection] = None
        self.channel: Optional[BlockingChannel] = None

    def connect(self, max_retries: int = 5, retry_delay: float = 2.0) -> None:
        """
        Establish connection to RabbitMQ with retry logic.

        Args:
            max_retries: Maximum number of connection attempts.
            retry_delay: Initial delay between retries (doubles each attempt).

        Raises:
            RuntimeError: If connection fails after all retries.
        """
        import time

        current_delay = retry_delay
        last_error = None

        for attempt in range(max_retries):
            try:
                params = pika.URLParameters(self.config.url)
                self.connection = pika.BlockingConnection(params)
                self.channel = self.connection.channel()

                # Declare the queue
                self.channel.queue_declare(
                    queue=self.config.queue_name,
                    durable=True,
                )

                # Set prefetch count for fair dispatch
                self.channel.basic_qos(prefetch_count=self.config.prefetch_count)

                logger.info(f"Connected to RabbitMQ, queue: {self.config.queue_name}")
                return

            except pika.exceptions.AMQPConnectionError as e:
                last_error = e
                if attempt < max_retries - 1:
                    logger.warning(
                        f"RabbitMQ connection failed (attempt {attempt + 1}/{max_retries}), "
                        f"retrying in {current_delay:.1f}s..."
                    )
                    time.sleep(current_delay)
                    current_delay = min(current_delay * 2, 30.0)  # Cap at 30s

        raise RuntimeError(
            f"Failed to connect to RabbitMQ after {max_retries} attempts: {last_error}"
        )

    def disconnect(self) -> None:
        """Close connection to RabbitMQ."""
        if self.connection and not self.connection.is_closed:
            self.connection.close()
            logger.info("Disconnected from RabbitMQ")

    def _callback(
        self,
        channel: BlockingChannel,
        method: pika.spec.Basic.Deliver,
        properties: pika.spec.BasicProperties,
        body: bytes,
    ) -> None:
        """
        Internal callback for processing messages.

        Args:
            channel: RabbitMQ channel
            method: Delivery method
            properties: Message properties
            body: Message body
        """
        try:
            # Parse message
            message = json.loads(body.decode("utf-8"))
            logger.info(f"Received message: {message}")

            # Process message
            if self.on_message:
                self.on_message(message)

            # Acknowledge message
            channel.basic_ack(delivery_tag=method.delivery_tag)
            logger.info(f"Processed message: {message}")

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON message: {e}")
            # Reject invalid messages
            channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

        except Exception as e:
            logger.error(f"Error processing message: {e}")
            # Requeue on error
            channel.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    def start_consuming(self) -> None:
        """Start consuming messages from the queue."""
        if not self.channel:
            raise RuntimeError("Not connected. Call connect() first.")

        self.channel.basic_consume(
            queue=self.config.queue_name,
            on_message_callback=self._callback,
        )

        logger.info(f"Starting to consume from {self.config.queue_name}")
        self.channel.start_consuming()

    def stop_consuming(self) -> None:
        """Stop consuming messages."""
        if self.channel:
            self.channel.stop_consuming()


class QueuePublisher:
    """RabbitMQ publisher for survey tasks."""

    def __init__(self, config: Optional[RabbitMQConfig] = None):
        """
        Initialize queue publisher.

        Args:
            config: RabbitMQ configuration
        """
        if config is None:
            config = RabbitMQConfig()
        self.config = config
        self.connection: Optional[pika.BlockingConnection] = None
        self.channel: Optional[BlockingChannel] = None

    def connect(self, max_retries: int = 5, retry_delay: float = 2.0) -> None:
        """
        Establish connection to RabbitMQ with retry logic.

        Args:
            max_retries: Maximum number of connection attempts.
            retry_delay: Initial delay between retries (doubles each attempt).

        Raises:
            RuntimeError: If connection fails after all retries.
        """
        import time

        current_delay = retry_delay
        last_error = None

        for attempt in range(max_retries):
            try:
                params = pika.URLParameters(self.config.url)
                self.connection = pika.BlockingConnection(params)
                self.channel = self.connection.channel()

                # Declare the queue
                self.channel.queue_declare(
                    queue=self.config.queue_name,
                    durable=True,
                )

                logger.info(f"Publisher connected to RabbitMQ, queue: {self.config.queue_name}")
                return

            except pika.exceptions.AMQPConnectionError as e:
                last_error = e
                if attempt < max_retries - 1:
                    logger.warning(
                        f"RabbitMQ connection failed (attempt {attempt + 1}/{max_retries}), "
                        f"retrying in {current_delay:.1f}s..."
                    )
                    time.sleep(current_delay)
                    current_delay = min(current_delay * 2, 30.0)  # Cap at 30s

        raise RuntimeError(
            f"Failed to connect to RabbitMQ after {max_retries} attempts: {last_error}"
        )

    def disconnect(self) -> None:
        """Close connection to RabbitMQ."""
        if self.connection and not self.connection.is_closed:
            self.connection.close()

    def is_connected(self) -> bool:
        """Check if connection and channel are open."""
        return (
            self.connection is not None
            and not self.connection.is_closed
            and self.channel is not None
            and self.channel.is_open
        )

    def ensure_connected(self) -> None:
        """Ensure connection is open, reconnect if needed."""
        if not self.is_connected():
            logger.info("RabbitMQ connection lost, reconnecting...")
            self.connect()

    def publish(self, message: dict) -> None:
        """
        Publish a message to the queue.
        Automatically reconnects if connection is lost.

        Args:
            message: Message to publish (will be JSON encoded)
        """
        self.ensure_connected()

        body = json.dumps(message).encode("utf-8")

        self.channel.basic_publish(
            exchange="",
            routing_key=self.config.queue_name,
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,  # Make message persistent
            ),
        )

        logger.debug(f"Published message: {message}")

    def publish_task(self, survey_run_id: str, task_id: str) -> None:
        """
        Publish a survey task to the queue.

        Args:
            survey_run_id: UUID of the survey run
            task_id: UUID of the task
        """
        self.publish({
            "survey_run_id": survey_run_id,
            "task_id": task_id,
        })
