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
    """Unified LLM configuration — built from per-user database config."""
    provider: str = ""           # "openrouter" or "vllm"
    base_url: str = ""           # Full API base URL
    api_key: str = ""            # API key (required for openrouter, optional for vllm)
    model: str = ""              # Model identifier

    # Common settings
    temperature: float = 0.0
    max_tokens: Optional[int] = 512
    use_guided_decoding: bool = True
    use_chat_template: bool = False  # False = /v1/completions (default), True = /v1/chat/completions

    # Parser LLM (Tier 2 fallback for MCQ parsing) — reuses OpenRouter API key
    parser_llm_model: str = "google/gemini-2.0-flash-001"

    @classmethod
    def from_user_config(
        cls,
        user_config: dict,
        api_key: Optional[str] = None,
    ) -> "LLMConfig":
        """
        Create LLMConfig from user's database configuration.

        Args:
            user_config: User's LLM settings from the database
            api_key: API key for the provider (OpenRouter key or vLLM auth token)

        Raises ValueError if the config is invalid or incomplete.
        """
        provider = user_config.get("provider", "")
        if not provider:
            raise ValueError("No LLM provider set in user configuration")

        if provider == "openrouter":
            base_url = "https://openrouter.ai/api/v1"
            model = user_config.get("openrouter_model", "")
            if not api_key:
                raise ValueError("OpenRouter API key is required")
            if not model:
                raise ValueError("OpenRouter model is required")
        elif provider == "vllm":
            endpoint = user_config.get("vllm_endpoint", "").rstrip("/")
            if not endpoint:
                raise ValueError("vLLM endpoint is required")
            base_url = f"{endpoint}/v1" if not endpoint.endswith("/v1") else endpoint
            model = user_config.get("vllm_model", "")
            if not model:
                raise ValueError("vLLM model is required")
        else:
            raise ValueError(f"Unknown LLM provider: {provider!r}")

        return cls(
            provider=provider,
            base_url=base_url,
            api_key=api_key or "",
            model=model,
            temperature=user_config.get("temperature") if user_config.get("temperature") is not None else 0.0,
            max_tokens=user_config.get("max_tokens") if user_config.get("max_tokens") is not None else 512,
            use_guided_decoding=user_config.get("use_guided_decoding") if user_config.get("use_guided_decoding") is not None else True,
            use_chat_template=user_config.get("use_chat_template") if user_config.get("use_chat_template") is not None else False,
            parser_llm_model=user_config.get("parser_llm_model") or "google/gemini-2.0-flash-001",
        )


@dataclass
class WorkerConfig:
    """Worker process configuration."""
    max_retries: int = field(default_factory=lambda: int(os.environ.get("MAX_RETRIES", "3")))
    retry_delay_base: float = field(default_factory=lambda: float(os.environ.get("RETRY_DELAY_BASE", "1.0")))
    retry_delay_max: float = field(default_factory=lambda: float(os.environ.get("RETRY_DELAY_MAX", "30.0")))
    max_concurrent_tasks: int = field(default_factory=lambda: int(os.environ.get("MAX_CONCURRENT_TASKS", "10")))
    metrics_log_interval: float = field(default_factory=lambda: float(os.environ.get("METRICS_LOG_INTERVAL", "30.0")))


@dataclass
class Config:
    """Main configuration container."""
    supabase: SupabaseConfig = field(default_factory=SupabaseConfig)
    rabbitmq: RabbitMQConfig = field(default_factory=RabbitMQConfig)
    worker: WorkerConfig = field(default_factory=WorkerConfig)


def get_config() -> Config:
    """
    Get the configuration singleton.

    Raises:
        ValueError: If required environment variables are missing.
    """
    config = Config()

    # Validate required Supabase config
    if not config.supabase.url:
        raise ValueError("SUPABASE_URL environment variable is required")
    if not config.supabase.service_key:
        raise ValueError("SUPABASE_SERVICE_KEY environment variable is required")

    # Validate RabbitMQ config (url has default, but warn if using default)
    if config.rabbitmq.url == "amqp://localhost":
        import logging
        logging.getLogger(__name__).warning(
            "Using default RabbitMQ URL (amqp://localhost). "
            "Set RABBITMQ_URL for production."
        )

    return config
