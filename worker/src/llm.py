"""
LLM client module supporting OpenRouter and vLLM.
Uses structured outputs for reliable response parsing.
"""
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Dict, Any

import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)


class LLMError(Exception):
    """Base exception for LLM errors."""
    pass


class RetryableError(LLMError):
    """Error that can be retried (rate limits, server errors)."""
    pass


class NonRetryableError(LLMError):
    """Error that should not be retried (auth, bad request)."""
    pass


class TruncationError(LLMError):
    """Response was truncated (likely exceeded max_tokens)."""
    pass


@dataclass
class LLMResponse:
    """Parsed LLM response."""
    answer: str
    reasoning: Optional[str] = None
    raw: Optional[str] = None

    @classmethod
    def from_json(cls, json_str: str) -> "LLMResponse":
        """
        Parse LLM response from JSON string.

        Raises:
            TruncationError: If JSON appears to be truncated.
            NonRetryableError: If JSON is invalid or malformed.
        """
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            # Detect truncation patterns
            error_msg = str(e).lower()
            if "unterminated string" in error_msg or "expecting" in error_msg:
                raise TruncationError(f"Response appears truncated: {e}. Raw: {json_str[:200]}")
            raise NonRetryableError(f"Invalid JSON response from LLM: {e}. Raw: {json_str[:200]}")

        # Handle different response formats: answer, answers (multiple_select), ranking
        answer = data.get("answer")
        if answer is None:
            answers = data.get("answers")
            if answers is not None:
                # Multiple select: join array as comma-separated
                answer = ",".join(answers) if isinstance(answers, list) else str(answers)
            else:
                ranking = data.get("ranking")
                if ranking is not None:
                    # Ranking: join array as comma-separated (preserves order)
                    answer = ",".join(ranking) if isinstance(ranking, list) else str(ranking)
                else:
                    answer = ""

        return cls(
            answer=answer,
            reasoning=data.get("reasoning"),
            raw=json_str,
        )

    @classmethod
    def from_text(cls, text: str) -> "LLMResponse":
        """
        Parse LLM response from plain text (anthology style).
        Extracts the first letter (A, B, C, D, etc.) from the response.
        """
        import re
        text = text.strip()

        # Try to find answer letter at the start
        # Patterns: "A", "(A)", "A.", "A:", "A)", "Answer: A", etc.
        patterns = [
            r'^[\(\[]?([A-Za-z])[\)\]\.\:]',  # (A), [A], A., A:, A)
            r'^([A-Za-z])\b',  # Just "A" at start
            r'[Aa]nswer[:\s]+[\(\[]?([A-Za-z])',  # "Answer: A" or "answer: (A)"
            r'[\(\[]([A-Za-z])[\)\]]',  # (A) or [A] anywhere
        ]

        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                answer = match.group(1).upper()
                if answer in 'ABCDEFGHIJ':  # Valid MCQ options
                    return cls(answer=answer, raw=text)

        # Fallback: just return the first character if it's a letter
        if text and text[0].upper() in 'ABCDEFGHIJ':
            return cls(answer=text[0].upper(), raw=text)

        # If nothing works, return the raw text as answer
        return cls(answer=text[:100] if text else "", raw=text)


class BaseLLMClient(ABC):
    """Abstract base class for LLM clients."""

    @abstractmethod
    def complete(self, prompt: str, response_schema: dict) -> LLMResponse:
        """
        Get completion from LLM with structured output.

        Args:
            prompt: The input prompt
            response_schema: JSON schema for expected response format

        Returns:
            Parsed LLMResponse

        Raises:
            RetryableError: For transient failures (rate limits, server errors)
            NonRetryableError: For permanent failures (auth, bad request)
        """
        pass


class OpenRouterClient(BaseLLMClient):
    """Client for OpenRouter API (OpenAI-compatible)."""

    BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(
        self,
        api_key: str,
        model: str,
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 3,
        timeout: float = 60.0,
    ):
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_retries = max_retries
        self.timeout = timeout

    # JSON Schema for structured output
    ANSWER_SCHEMA = {
        "type": "object",
        "properties": {
            "answer": {
                "type": "string",
                "description": "The letter of the chosen option (A, B, C, D, etc.)"
            }
        },
        "required": ["answer"],
        "additionalProperties": False
    }

    def _make_request(self, prompt: str, response_schema: dict, max_tokens_override: Optional[int] = None) -> LLMResponse:
        """Make a single API request with structured output.

        Args:
            prompt: The input prompt
            response_schema: JSON schema for expected response format
            max_tokens_override: Override max_tokens for this request (used for retry)
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://virtual-personas-arena.vercel.app",
        }

        # Use provided schema or default
        schema = response_schema if response_schema else self.ANSWER_SCHEMA

        # Determine max_tokens: override > instance setting
        effective_max_tokens = max_tokens_override if max_tokens_override is not None else self.max_tokens

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "user", "content": prompt},
            ],
            "temperature": self.temperature,
            # OpenRouter structured outputs - proper format for GPT models
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "answer",
                    "strict": True,
                    "schema": schema
                }
            }
        }

        # Only add max_tokens if specified (None means no limit)
        if effective_max_tokens is not None:
            payload["max_tokens"] = effective_max_tokens

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(self.BASE_URL, headers=headers, json=payload)

            # Handle errors
            if response.status_code == 401:
                raise NonRetryableError(f"Authentication failed: {response.json()}")
            elif response.status_code == 400:
                raise NonRetryableError(f"Bad request: {response.json()}")
            elif response.status_code == 429:
                raise RetryableError(f"Rate limited: {response.json()}")
            elif response.status_code >= 500:
                raise RetryableError(f"Server error ({response.status_code}): {response.json()}")
            elif response.status_code != 200:
                raise LLMError(f"Unexpected status {response.status_code}: {response.json()}")

            # Parse response
            data = response.json()

            # Check for error response (OpenRouter returns error in body, not HTTP status)
            if "error" in data:
                error_msg = data["error"].get("message", str(data["error"])) if isinstance(data["error"], dict) else str(data["error"])
                error_code = data["error"].get("code", "") if isinstance(data["error"], dict) else ""
                # Rate limits and server errors are retryable
                if error_code in ("rate_limit_exceeded", "server_error", 429, 500, 502, 503):
                    raise RetryableError(f"OpenRouter error: {error_msg}")
                else:
                    raise NonRetryableError(f"OpenRouter error: {error_msg}")

            # Validate response structure
            if "choices" not in data or not data["choices"]:
                raise NonRetryableError(f"Invalid response structure (no choices): {str(data)[:500]}")

            content = data["choices"][0]["message"]["content"]
            return LLMResponse.from_json(content)

    def complete(self, prompt: str, response_schema: dict) -> LLMResponse:
        """Get completion with retry logic and truncation handling."""
        last_error = None
        truncation_retried = False

        for attempt in range(self.max_retries):
            try:
                return self._make_request(prompt, response_schema)
            except TruncationError as e:
                # Retry once without max_tokens limit (only if we haven't tried already)
                if not truncation_retried and self.max_tokens is not None:
                    truncation_retried = True
                    import logging
                    logging.getLogger(__name__).warning(
                        f"Response truncated, retrying without max_tokens limit: {e}"
                    )
                    try:
                        # Retry with no max_tokens (use a very large number instead of None
                        # since OpenRouter might still need a value)
                        return self._make_request(prompt, response_schema, max_tokens_override=16384)
                    except TruncationError as retry_e:
                        raise NonRetryableError(f"Response still truncated after retry: {retry_e}")
                else:
                    raise NonRetryableError(f"Response truncated: {e}")
            except NonRetryableError:
                raise
            except RetryableError as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    # Exponential backoff
                    wait_time = min(2 ** attempt, 30)
                    time.sleep(wait_time)
            except httpx.TimeoutException as e:
                last_error = RetryableError(f"Timeout: {e}")
                if attempt < self.max_retries - 1:
                    wait_time = min(2 ** attempt, 30)
                    time.sleep(wait_time)

        raise RetryableError(f"Max retries exceeded: {last_error}")


class VLLMClient(BaseLLMClient):
    """Client for vLLM server (local or remote with API key)."""

    # Schema for guided JSON (vLLM supports this natively)
    ANSWER_SCHEMA = {
        "type": "object",
        "properties": {
            "answer": {"type": "string"}
        },
        "required": ["answer"]
    }

    def __init__(
        self,
        endpoint: str,
        model: str,
        api_key: Optional[str] = None,
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 3,
        timeout: float = 120.0,
    ):
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_retries = max_retries
        self.timeout = timeout

    def _make_request(self, prompt: str, response_schema: dict, max_tokens_override: Optional[int] = None) -> LLMResponse:
        """Make a single API request to vLLM with structured output.

        Args:
            prompt: The input prompt
            response_schema: JSON schema for expected response format
            max_tokens_override: Override max_tokens for this request (used for retry)
        """
        url = f"{self.endpoint}/chat/completions"

        # Build headers (include auth if API key provided)
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        # Use provided schema or default to answer schema
        schema = response_schema if response_schema else self.ANSWER_SCHEMA

        # Determine max_tokens: override > instance setting
        effective_max_tokens = max_tokens_override if max_tokens_override is not None else self.max_tokens

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "user", "content": prompt},
            ],
            "temperature": self.temperature,
            # vLLM structured outputs - uses guided_json in extra_body
            # See: https://docs.vllm.ai/en/latest/features/structured_outputs/
            "extra_body": {
                "guided_json": schema
            }
        }

        # Only add max_tokens if specified (None means no limit)
        if effective_max_tokens is not None:
            payload["max_tokens"] = effective_max_tokens

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(url, headers=headers, json=payload)

            if response.status_code == 401:
                raise NonRetryableError(f"Authentication failed: {response.json()}")
            elif response.status_code == 400:
                raise NonRetryableError(f"Bad request: {response.json()}")
            elif response.status_code == 429:
                raise RetryableError(f"Rate limited: {response.json()}")
            elif response.status_code >= 500:
                raise RetryableError(f"Server error ({response.status_code})")
            elif response.status_code != 200:
                raise LLMError(f"Unexpected status {response.status_code}")

            # Parse response
            data = response.json()

            # Check for error response
            if "error" in data:
                error_msg = data["error"].get("message", str(data["error"])) if isinstance(data["error"], dict) else str(data["error"])
                raise NonRetryableError(f"vLLM error: {error_msg}")

            # Validate response structure
            if "choices" not in data or not data["choices"]:
                raise NonRetryableError(f"Invalid response structure (no choices): {str(data)[:500]}")

            content = data["choices"][0]["message"]["content"]
            return LLMResponse.from_json(content)

    def complete(self, prompt: str, response_schema: dict) -> LLMResponse:
        """Get completion with retry logic and truncation handling."""
        last_error = None
        truncation_retried = False

        for attempt in range(self.max_retries):
            try:
                return self._make_request(prompt, response_schema)
            except TruncationError as e:
                # Retry once without max_tokens limit (only if we haven't tried already)
                if not truncation_retried and self.max_tokens is not None:
                    truncation_retried = True
                    import logging
                    logging.getLogger(__name__).warning(
                        f"Response truncated, retrying without max_tokens limit: {e}"
                    )
                    try:
                        # Retry with a much larger max_tokens
                        return self._make_request(prompt, response_schema, max_tokens_override=16384)
                    except TruncationError as retry_e:
                        raise NonRetryableError(f"Response still truncated after retry: {retry_e}")
                else:
                    raise NonRetryableError(f"Response truncated: {e}")
            except NonRetryableError:
                raise
            except RetryableError as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    wait_time = min(2 ** attempt, 30)
                    time.sleep(wait_time)
            except httpx.TimeoutException as e:
                last_error = RetryableError(f"Timeout: {e}")
                if attempt < self.max_retries - 1:
                    wait_time = min(2 ** attempt, 30)
                    time.sleep(wait_time)

        raise RetryableError(f"Max retries exceeded: {last_error}")


class LLMClient:
    """Factory for creating LLM clients."""

    @staticmethod
    def create(
        provider: str,
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 3,
    ) -> BaseLLMClient:
        """
        Create an LLM client based on provider.

        Args:
            provider: "openrouter" or "vllm"
            api_key: API key (for openrouter)
            endpoint: Server endpoint (for vllm)
            model: Model name
            temperature: Sampling temperature
            max_tokens: Maximum tokens in response
            max_retries: Maximum retry attempts

        Returns:
            Configured LLM client
        """
        if provider == "openrouter":
            if not api_key:
                raise ValueError("api_key required for openrouter provider")
            return OpenRouterClient(
                api_key=api_key,
                model=model or "anthropic/claude-3-haiku",
                temperature=temperature,
                max_tokens=max_tokens,
                max_retries=max_retries,
            )
        elif provider == "vllm":
            if not endpoint:
                raise ValueError("endpoint required for vllm provider")
            return VLLMClient(
                endpoint=endpoint,
                model=model or "meta-llama/Llama-3-70b",
                api_key=api_key,  # Optional: for authenticated vLLM servers
                temperature=temperature,
                max_tokens=max_tokens,
                max_retries=max_retries,
            )
        else:
            raise ValueError(f"Unknown provider: {provider}. Supported: openrouter, vllm")
