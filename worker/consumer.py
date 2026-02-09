#!/usr/bin/env python3
"""
RabbitMQ Consumer for Virtual Personas Arena

This worker consumes survey tasks from RabbitMQ, runs LLM inference,
and updates results in Supabase.
"""

import json
import logging
import sys
from typing import Any

import pika
from supabase import create_client, Client

from config import (
    SUPABASE_URL,
    SUPABASE_KEY,
    RABBITMQ_URL,
    QUEUE_NAME,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_MODEL,
)
from llm_runner import LLMRunner, LLMConfig

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


class SurveyWorker:
    """Worker that processes survey tasks from the queue."""

    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.connection: pika.BlockingConnection | None = None
        self.channel: pika.channel.Channel | None = None

    def connect_rabbitmq(self):
        """Establish connection to RabbitMQ."""
        parameters = pika.URLParameters(RABBITMQ_URL)
        self.connection = pika.BlockingConnection(parameters)
        self.channel = self.connection.channel()
        self.channel.queue_declare(queue=QUEUE_NAME, durable=True)
        logger.info(f"Connected to RabbitMQ, listening on queue: {QUEUE_NAME}")

    def get_llm_config(self, user_id: str) -> LLMConfig:
        """Get LLM configuration for a user."""
        result = self.supabase.table("users").select("llm_config").eq("id", user_id).single().execute()

        if result.data and result.data.get("llm_config"):
            config = result.data["llm_config"]
            return LLMConfig(
                provider=config.get("provider", DEFAULT_LLM_PROVIDER),
                api_key=config.get("api_key"),
                model=config.get("model", DEFAULT_LLM_MODEL),
                vllm_endpoint=config.get("vllm_endpoint"),
            )

        # Return default config
        return LLMConfig(
            provider=DEFAULT_LLM_PROVIDER,
            model=DEFAULT_LLM_MODEL,
        )

    def get_survey(self, survey_id: str) -> dict[str, Any] | None:
        """Fetch survey details from database."""
        result = self.supabase.table("surveys").select("*").eq("id", survey_id).single().execute()
        return result.data

    def get_backstory(self, backstory_id: str) -> dict[str, Any] | None:
        """Fetch backstory from database."""
        result = self.supabase.table("backstories").select("*").eq("id", backstory_id).single().execute()
        return result.data

    def update_survey_results(
        self,
        survey_id: str,
        backstory_id: str,
        answers: dict[str, Any]
    ):
        """Update survey results with answers for a specific backstory."""
        # Fetch current results
        survey = self.get_survey(survey_id)
        if not survey:
            logger.error(f"Survey {survey_id} not found")
            return

        current_results = survey.get("results", {})
        current_results[backstory_id] = answers

        # Update completed count
        completed_count = len(current_results)
        matched_count = survey.get("matched_count", 0)

        # Determine new status
        status = "running"
        if completed_count >= matched_count:
            status = "completed"

        # Update database
        self.supabase.table("surveys").update({
            "results": current_results,
            "completed_count": completed_count,
            "status": status,
        }).eq("id", survey_id).execute()

        logger.info(f"Updated survey {survey_id}: {completed_count}/{matched_count} complete")

    def process_task(self, task: dict[str, Any]):
        """Process a single survey task."""
        survey_id = task.get("survey_id")
        backstory_id = task.get("backstory_id")

        if not survey_id or not backstory_id:
            logger.error(f"Invalid task: {task}")
            return

        logger.info(f"Processing task: survey={survey_id}, backstory={backstory_id}")

        # Fetch survey and backstory
        survey = self.get_survey(survey_id)
        backstory = self.get_backstory(backstory_id)

        if not survey or not backstory:
            logger.error(f"Survey or backstory not found")
            return

        # Get LLM config for the survey owner
        llm_config = self.get_llm_config(survey["user_id"])

        # Run the survey
        try:
            runner = LLMRunner(llm_config)
            answers = runner.run_survey(
                questions=survey["questions"],
                backstory=backstory["backstory_text"]
            )

            # Update results
            self.update_survey_results(survey_id, backstory_id, answers)

        except Exception as e:
            logger.error(f"Error running survey: {e}")
            # Mark survey as failed if critical error
            self.supabase.table("surveys").update({
                "status": "failed"
            }).eq("id", survey_id).execute()

    def callback(self, ch, method, properties, body):
        """Callback for processing messages from the queue."""
        try:
            task = json.loads(body)
            self.process_task(task)
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            # Negative acknowledge to requeue the message
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    def start(self):
        """Start consuming messages from the queue."""
        self.connect_rabbitmq()

        if not self.channel:
            logger.error("Failed to connect to RabbitMQ")
            return

        self.channel.basic_qos(prefetch_count=1)
        self.channel.basic_consume(
            queue=QUEUE_NAME,
            on_message_callback=self.callback
        )

        logger.info("Worker started. Waiting for tasks...")

        try:
            self.channel.start_consuming()
        except KeyboardInterrupt:
            logger.info("Worker stopped by user")
            self.channel.stop_consuming()
        finally:
            if self.connection:
                self.connection.close()


def enqueue_survey_tasks(survey_id: str):
    """
    Enqueue tasks for all matched backstories for a survey.
    This function would typically be called by the backend when a user clicks "Run Survey".
    """
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Get survey with demographic filters
    survey = supabase.table("surveys").select("*").eq("id", survey_id).single().execute()
    if not survey.data:
        logger.error(f"Survey {survey_id} not found")
        return

    demographics = survey.data.get("demographics", {})

    # Query backstories matching the demographic filters
    # Note: This is a simplified query - in production you'd need proper JSONB filtering
    query = supabase.table("backstories").select("id").eq("is_public", True)

    # Execute query
    result = query.execute()
    backstories = result.data or []

    logger.info(f"Found {len(backstories)} matching backstories for survey {survey_id}")

    # Update survey with matched count and status
    supabase.table("surveys").update({
        "matched_count": len(backstories),
        "completed_count": 0,
        "status": "running" if backstories else "completed",
    }).eq("id", survey_id).execute()

    if not backstories:
        return

    # Connect to RabbitMQ and enqueue tasks
    parameters = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(parameters)
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)

    for backstory in backstories:
        task = {
            "survey_id": survey_id,
            "backstory_id": backstory["id"],
        }
        channel.basic_publish(
            exchange="",
            routing_key=QUEUE_NAME,
            body=json.dumps(task),
            properties=pika.BasicProperties(delivery_mode=2)  # Make message persistent
        )

    connection.close()
    logger.info(f"Enqueued {len(backstories)} tasks for survey {survey_id}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Virtual Personas Arena Worker")
    parser.add_argument("--enqueue", type=str, help="Enqueue tasks for a survey ID")
    args = parser.parse_args()

    if args.enqueue:
        enqueue_survey_tasks(args.enqueue)
    else:
        worker = SurveyWorker()
        worker.start()
