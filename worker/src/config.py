"""
Configuration module for the survey worker.
Loads settings from environment variables.
"""
import os
from dataclasses import dataclass, field
from typing import Optional
from dotenv import load_dotenv

load_dotenv()


def parse_max_tokens(value: str) -> Optional[int]:
    """
    Parse max_tokens from environment variable.

    Supports:
    - Numeric values: "512", "1024" → int
    - Unlimited: "INF", "unlimited", "-1" → None (no limit)

    Returns:
        int for numeric values, None for unlimited
    """
    if value.upper() in ("INF", "UNLIMITED", "-1"):
        return None
    return int(value)


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
    max_tokens: Optional[int] = field(default_factory=lambda: parse_max_tokens(os.environ.get("LLM_MAX_TOKENS", "512")))

    @classmethod
    def from_user_config(
        cls,
        user_config: dict,
        openrouter_api_key: Optional[str] = None,
        vllm_api_key: Optional[str] = None,
    ) -> "LLMConfig":
        """
        Create LLMConfig from user's database configuration.

        Uses user settings with fallback to environment defaults.

        Args:
            user_config: User's llm_config from database
            openrouter_api_key: Decrypted OpenRouter API key from Vault
            vllm_api_key: Decrypted vLLM API key from Vault

        Returns:
            LLMConfig with user settings or env fallbacks
        """
        # Get defaults from environment
        defaults = cls()

        return cls(
            provider=user_config.get("provider") or defaults.provider,
            openrouter_api_key=openrouter_api_key or defaults.openrouter_api_key,
            openrouter_model=user_config.get("openrouter_model") or defaults.openrouter_model,
            vllm_endpoint=user_config.get("vllm_endpoint") or defaults.vllm_endpoint,
            vllm_model=user_config.get("vllm_model") or defaults.vllm_model,
            vllm_api_key=vllm_api_key or defaults.vllm_api_key,
            temperature=user_config.get("temperature") if user_config.get("temperature") is not None else defaults.temperature,
            max_tokens=user_config.get("max_tokens") if user_config.get("max_tokens") is not None else defaults.max_tokens,
        )


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
