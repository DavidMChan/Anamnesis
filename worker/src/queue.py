"""
RabbitMQ queue module.

Provides:
- QueueConsumer: Sync consumer using pika (legacy, still works)
- AsyncQueueConsumer: Async consumer using aio-pika (for async worker)
- QueuePublisher: Sync publisher using pika (used by dispatcher)
"""
import asyncio
import json
import logging
from typing import Callable, Optional, AsyncIterator

import pika
from pika.adapters.blocking_connection import BlockingChannel

from .config import RabbitMQConfig

logger = logging.getLogger(__name__)

try:
    import aio_pika
except ImportError:
    aio_pika = None  # type: ignore[assignment]


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


class AsyncQueueConsumer:
    """
    Async RabbitMQ consumer using aio-pika.

    Usage:
        consumer = AsyncQueueConsumer(config)
        await consumer.connect()
        async for message in consumer:
            # message is a dict (parsed JSON body)
            # Call message.ack() / message.nack() on the raw message
            pass
        await consumer.close()
    """

    def __init__(
        self,
        config: Optional[RabbitMQConfig] = None,
        prefetch_count: Optional[int] = None,
    ):
        if config is None:
            config = RabbitMQConfig()
        self.config = config
        self.prefetch_count = prefetch_count or config.prefetch_count
        self._connection: Optional["aio_pika.abc.AbstractRobustConnection"] = None
        self._channel: Optional["aio_pika.abc.AbstractChannel"] = None
        self._queue: Optional["aio_pika.abc.AbstractQueue"] = None
        self._iterator: Optional[AsyncIterator] = None
        self._closed = False

    async def connect(self, max_retries: int = 5, retry_delay: float = 2.0) -> None:
        """Connect to RabbitMQ with retry logic."""
        if aio_pika is None:
            raise ImportError("aio-pika is required for AsyncQueueConsumer. Install with: pip install aio-pika")

        current_delay = retry_delay
        last_error = None

        for attempt in range(max_retries):
            try:
                self._connection = await aio_pika.connect_robust(self.config.url)
                self._channel = await self._connection.channel()
                await self._channel.set_qos(prefetch_count=self.prefetch_count)

                self._queue = await self._channel.declare_queue(
                    self.config.queue_name,
                    durable=True,
                )

                logger.info(
                    f"Async consumer connected to RabbitMQ, "
                    f"queue: {self.config.queue_name}, "
                    f"prefetch: {self.prefetch_count}"
                )
                return

            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    logger.warning(
                        f"RabbitMQ connection failed (attempt {attempt + 1}/{max_retries}), "
                        f"retrying in {current_delay:.1f}s..."
                    )
                    await asyncio.sleep(current_delay)
                    current_delay = min(current_delay * 2, 30.0)

        raise RuntimeError(
            f"Failed to connect to RabbitMQ after {max_retries} attempts: {last_error}"
        )

    async def close(self) -> None:
        """Close the connection."""
        self._closed = True
        if self._connection and not self._connection.is_closed:
            await self._connection.close()
            logger.info("Async consumer disconnected from RabbitMQ")

    def __aiter__(self):
        """Start iterating over messages."""
        if self._queue is None:
            raise RuntimeError("Not connected. Call connect() first.")
        self._iterator = self._queue.iterator()
        return self

    async def __anext__(self) -> "aio_pika.IncomingMessage":
        """
        Get next message from the queue.

        Returns the raw aio_pika.IncomingMessage so the caller
        can ack/nack after processing.
        """
        if self._closed:
            raise StopAsyncIteration
        if self._iterator is None:
            raise RuntimeError("Not connected. Call connect() first.")
        try:
            return await self._iterator.__anext__()
        except StopAsyncIteration:
            raise
        except Exception as e:
            if self._closed:
                raise StopAsyncIteration
            raise

    @staticmethod
    def parse_message(message: "aio_pika.IncomingMessage") -> dict:
        """Parse a message body as JSON."""
        return json.loads(message.body.decode("utf-8"))


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
