"""
Configuration module for the survey worker.
Loads settings from environment variables.
"""
import os
from dataclasses import dataclass, field
from typing import Optional
from dotenv import load_dotenv

load_dotenv()


@dataclass
class SupabaseConfig:
    """Supabase connection configuration."""
    url: str = field(default_factory=lambda: os.environ.get("SUPABASE_URL", ""))
    service_key: str = field(default_factory=lambda: os.environ.get("SUPABASE_SERVICE_KEY", ""))


@dataclass
class RabbitMQConfig:
    """RabbitMQ connection configuration."""
    url: str = field(default_factory=lambda: os.environ.get("RABBITMQ_URL", "amqp://localhost"))
    queue_name: str = field(default_factory=lambda: os.environ.get("RABBITMQ_QUEUE", "survey_tasks"))
    prefetch_count: int = field(default_factory=lambda: int(os.environ.get("RABBITMQ_PREFETCH", "1")))


@dataclass
class LLMConfig:
    """LLM provider configuration."""
    provider: str = field(default_factory=lambda: os.environ.get("LLM_PROVIDER", "openrouter"))

    # OpenRouter
    openrouter_api_key: str = field(default_factory=lambda: os.environ.get("OPENROUTER_API_KEY", ""))
    openrouter_model: str = field(default_factory=lambda: os.environ.get("OPENROUTER_MODEL", "anthropic/claude-3-haiku"))

    # vLLM
    vllm_endpoint: str = field(default_factory=lambda: os.environ.get("VLLM_ENDPOINT", "http://localhost:8000/v1"))
    vllm_model: str = field(default_factory=lambda: os.environ.get("VLLM_MODEL", "meta-llama/Llama-3-70b"))
    vllm_api_key: str = field(default_factory=lambda: os.environ.get("VLLM_API_KEY", ""))

    # Common settings
    temperature: float = field(default_factory=lambda: float(os.environ.get("LLM_TEMPERATURE", "0.0")))
    max_tokens: int = field(default_factory=lambda: int(os.environ.get("LLM_MAX_TOKENS", "512")))


@dataclass
class WorkerConfig:
    """Worker process configuration."""
    max_retries: int = field(default_factory=lambda: int(os.environ.get("MAX_RETRIES", "3")))
    retry_delay_base: float = field(default_factory=lambda: float(os.environ.get("RETRY_DELAY_BASE", "1.0")))
    retry_delay_max: float = field(default_factory=lambda: float(os.environ.get("RETRY_DELAY_MAX", "30.0")))


@dataclass
class Config:
    """Main configuration container."""
    supabase: SupabaseConfig = field(default_factory=SupabaseConfig)
    rabbitmq: RabbitMQConfig = field(default_factory=RabbitMQConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    worker: WorkerConfig = field(default_factory=WorkerConfig)


def get_config() -> Config:
    """Get the configuration singleton."""
    return Config()
