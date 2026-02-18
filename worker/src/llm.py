"""
LLM client module supporting OpenRouter and vLLM.
Uses structured outputs for reliable response parsing.
"""
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Dict, Any, List, TYPE_CHECKING

if TYPE_CHECKING:
    from .prompt import Question

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


class StructuredOutputNotSupported(LLMError):
    """Model doesn't support structured output (json_schema)."""
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
    def from_comma_separated(
        cls,
        text: str,
        num_options: int,
        require_all: bool = False,
        options: "Optional[List[str]]" = None,
    ) -> "LLMResponse":
        """
        Parse comma-separated letters from various formats.

        Handles:
        - Clean: "A, C, D"
        - Parenthesized: "(A), (B), (D)"
        - Bracketed: "[A], [B]"
        - Mixed: "A, (C), D"
        - Option text: "Software engineer/ML, Data scientist" (matched against options)

        Args:
            text: Raw response text
            num_options: Number of valid options (determines valid letter range)
            require_all: If True, all letters must be present (for ranking)
            options: Optional list of option texts for text-matching fallback

        Returns:
            LLMResponse with comma-separated answer or empty if invalid
        """
        import re
        valid = {chr(65 + i) for i in range(num_options)}

        # Extract letters from each comma-separated segment
        # Strip parentheses, brackets, periods, spaces
        segments = [s.strip() for s in text.split(",")]
        letters = []
        for seg in segments:
            # Strip wrapping punctuation: (A) → A, [B] → B, "C" → C
            cleaned = re.sub(r'^[\(\[\"\' ]+|[\)\]\"\' .]+$', '', seg).strip().upper()
            if cleaned in valid:
                letters.append(cleaned)

        # Deduplicate while preserving order
        seen = set()
        result = []
        for letter in letters:
            if letter not in seen:
                seen.add(letter)
                result.append(letter)

        # If no letters found, try matching option text
        if not result and options:
            for seg in segments:
                seg_lower = seg.strip().lower()
                for idx, opt in enumerate(options):
                    if opt.lower() in seg_lower or seg_lower in opt.lower():
                        letter = chr(65 + idx)
                        if letter not in seen:
                            seen.add(letter)
                            result.append(letter)
                        break  # one match per segment

        if require_all and set(result) != valid:
            return cls(answer="", raw=text)  # Incomplete → retry
        if result:
            return cls(answer=",".join(result), raw=text)
        return cls(answer="", raw=text)

    @classmethod
    def from_text(cls, text: str) -> "LLMResponse":
        """
        Parse LLM response from plain text (anthology style).
        Extracts the first letter (A, B, C, D, etc.) from the response.
        """
        import re
        text = text.strip()

        # Try to find answer letter at the start
        # Patterns: "(A)", "[A]", "A.", "A:", "A)" - letter in brackets or with punctuation
        patterns = [
            r'^[\(\[]([A-Za-z])[\)\]]',  # (A) or [A] at start
            r'^([A-Za-z])[\.\:\)]',  # A. A: A) at start
            r'[Aa]nswer[:\s]+[\(\[]?([A-Za-z])[\)\]]?',  # "Answer: A" or "Answer: (A)"
            r'[\(\[]([A-Za-z])[\)\]]',  # (A) or [A] anywhere
        ]

        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                answer = match.group(1).upper()
                if answer in 'ABCDEFGHIJ':  # Valid MCQ options
                    return cls(answer=answer, raw=text)

        # Stricter fallback: only accept standalone letter followed by valid delimiter
        # Use anthology-style pattern with negative lookahead to exclude common words
        # Including contractions like "I'm", "I'd", "I'll"
        anthology_pattern = r"(?:^|[\[\(\"\' ])([A-Z])(?=$|[\]\)\"., ])(?!'m)(?!'d)(?!'ll)(?!'ve)(?!'re)(?! think)(?! am)(?! have)(?! would)(?! was)(?! great)(?! lot)(?! little)(?! good)(?! bad)(?! don)"
        match = re.search(anthology_pattern, text)
        if match:
            answer = match.group(1).upper()
            # Only accept A-E for typical MCQ (not I, which is often "I think...")
            if answer in 'ABCDEFGH':
                return cls(answer=answer, raw=text)

        # If nothing works, return empty string (not raw text) to keep context clean
        # The raw text is still available in the raw field for debugging
        import logging
        logging.getLogger(__name__).warning(f"Failed to parse MCQ answer from: {repr(text[:100])}")
        return cls(answer="", raw=text)


class BaseLLMClient(ABC):
    """Abstract base class for LLM clients."""

    @abstractmethod
    def complete(self, prompt: str, response_schema: dict = None, *, question: "Optional[Question]" = None) -> LLMResponse:
        """
        Get completion from LLM with structured output.

        Args:
            prompt: The input prompt
            response_schema: JSON schema for expected response format
            question: Optional question metadata (enables guided decoding for MCQ on vLLM)

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

    def _make_request(self, prompt: str, response_schema: dict, max_tokens_override: Optional[int] = None, use_structured: bool = True) -> LLMResponse:
        """Make a single API request.

        Args:
            prompt: The input prompt
            response_schema: JSON schema for expected response format
            max_tokens_override: Override max_tokens for this request (used for retry)
            use_structured: Whether to use structured output (json_schema) or plain text
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

        # Build prompt - add JSON instruction if using text mode
        if use_structured:
            messages = [{"role": "user", "content": prompt}]
        else:
            # For text mode, append instruction to respond with just the answer letter
            text_prompt = prompt + "\n\nRespond with ONLY the letter of your answer (A, B, C, D, etc.) and nothing else."
            messages = [{"role": "user", "content": text_prompt}]

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
        }

        # Only add structured output format if requested
        if use_structured:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "answer",
                    "strict": True,
                    "schema": schema
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
                error_data = response.json()
                error_msg = str(error_data)
                # Check if this is a structured output not supported error
                if "chat_template" in error_msg.lower() or "json" in error_msg.lower() or "schema" in error_msg.lower():
                    raise StructuredOutputNotSupported(f"Model doesn't support structured output: {error_msg}")
                raise NonRetryableError(f"Bad request: {error_data}")
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

                # Check if this is a structured output not supported error
                if "chat_template" in error_msg.lower() or "json" in error_msg.lower() or "schema" in error_msg.lower() or "Hyperbolic" in error_msg:
                    raise StructuredOutputNotSupported(f"Model doesn't support structured output: {error_msg}")

                # Rate limits and server errors are retryable
                if error_code in ("rate_limit_exceeded", "server_error", 429, 500, 502, 503):
                    raise RetryableError(f"OpenRouter error: {error_msg}")
                else:
                    raise NonRetryableError(f"OpenRouter error: {error_msg}")

            # Validate response structure
            if "choices" not in data or not data["choices"]:
                raise NonRetryableError(f"Invalid response structure (no choices): {str(data)[:500]}")

            content = data["choices"][0]["message"]["content"]

            # Parse based on mode
            if use_structured:
                return LLMResponse.from_json(content)
            else:
                return LLMResponse.from_text(content)

    def complete(self, prompt: str, response_schema: dict = None, *, question: "Optional[Question]" = None) -> LLMResponse:
        """Get completion with retry logic, truncation handling, and text fallback."""
        import logging
        logger = logging.getLogger(__name__)

        last_error = None
        truncation_retried = False
        text_fallback_used = False

        for attempt in range(self.max_retries):
            try:
                return self._make_request(prompt, response_schema, use_structured=not text_fallback_used)
            except StructuredOutputNotSupported as e:
                # Fall back to text mode
                if not text_fallback_used:
                    text_fallback_used = True
                    logger.warning(f"Structured output not supported, falling back to text mode: {e}")
                    continue  # Retry immediately with text mode
                else:
                    raise NonRetryableError(f"Text fallback also failed: {e}")
            except TruncationError as e:
                # Retry once without max_tokens limit (only if we haven't tried already)
                if not truncation_retried and self.max_tokens is not None:
                    truncation_retried = True
                    logger.warning(f"Response truncated, retrying without max_tokens limit: {e}")
                    try:
                        return self._make_request(prompt, response_schema, max_tokens_override=16384, use_structured=not text_fallback_used)
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
    """
    Client for vLLM server using Completions API.

    Designed for base models (not instruction-tuned) following anthology approach.
    Uses /v1/completions endpoint which doesn't require chat templates.

    Supports guided decoding via structured_outputs.choice for MCQ questions,
    which constrains generation to valid option letters at the token level.
    """

    def __init__(
        self,
        endpoint: str,
        model: str,
        api_key: Optional[str] = None,
        temperature: float = 1.0,  # Default 1.0 like anthology
        max_tokens: int = 128,  # Default 128 like anthology (never None to avoid infinite generation)
        max_retries: int = 3,
        timeout: float = 120.0,
        top_p: float = 1.0,
        use_guided_decoding: bool = True,
    ):
        self.endpoint = endpoint.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_retries = max_retries
        self.timeout = timeout
        self.top_p = top_p
        self.use_guided_decoding = use_guided_decoding

    def _make_request(
        self,
        prompt: str,
        max_tokens_override: Optional[int] = None,
        guided_params: Optional[tuple] = None,
        question: "Optional[Question]" = None,
    ) -> LLMResponse:
        """
        Make a request using the Completions API.

        Args:
            prompt: The full prompt (backstory + questions + "Answer:")
            max_tokens_override: Override max_tokens for this request
            guided_params: Tuple of (type, value) for structured_outputs.
                           ("choice", ["A","B","C","D"]) or ("regex", "[A-D](, [A-D])*")
            question: Question metadata for response dispatch
        """
        url = f"{self.endpoint}/completions"

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        effective_max_tokens = max_tokens_override if max_tokens_override is not None else self.max_tokens

        # Determine stop sequences based on question type
        question_type = question.type if question else None
        if question_type == "open_response":
            stop_sequences = ["Question:"]
        else:
            stop_sequences = ["\n", ".", "Question:"]

        payload: Dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "temperature": self.temperature,
            "max_tokens": effective_max_tokens,
            "top_p": self.top_p,
            "stop": stop_sequences,
        }

        # Add guided decoding constraint
        if guided_params:
            param_type, param_value = guided_params
            payload["structured_outputs"] = {param_type: param_value}
            # Remove stop sequences — guided decoding handles termination
            payload.pop("stop", None)
            if param_type == "choice":
                payload["max_tokens"] = 1  # Only need single letter for MCQ
            elif param_type == "regex":
                num_options = len(question.options) if question and question.options else 4
                payload["max_tokens"] = 3 * num_options  # Enough for all letters + separators

        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"vLLM prompt (last 500 chars): {repr(prompt[-500:])}")
        if guided_params:
            logger.info(f"vLLM guided_params: {guided_params}")

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
                raise LLMError(f"Unexpected status {response.status_code}: {response.text}")

            data = response.json()

            if "error" in data:
                error_msg = data["error"].get("message", str(data["error"])) if isinstance(data["error"], dict) else str(data["error"])
                raise NonRetryableError(f"vLLM error: {error_msg}")

            if "choices" not in data or not data["choices"]:
                raise NonRetryableError(f"Invalid response structure: {str(data)[:500]}")

            # Completions API returns 'text' field
            content = data["choices"][0].get("text", "").strip()

            logging.getLogger(__name__).info(f"vLLM raw response: {repr(content[:200] if len(content) > 200 else content)}")

            # Dispatch response parsing based on guided decoding type
            if guided_params:
                param_type, param_value = guided_params
                if param_type == "choice":
                    # MCQ: existing logic
                    if content and content.upper() in param_value:
                        return LLMResponse(answer=content.upper(), raw=content)
                elif param_type == "regex":
                    num_options = len(question.options) if question and question.options else 0
                    opts = question.options if question else None
                    if question and question.type == "multiple_select":
                        return LLMResponse.from_comma_separated(content, num_options, require_all=False, options=opts)
                    elif question and question.type == "ranking":
                        return LLMResponse.from_comma_separated(content, num_options, require_all=True, options=opts)

            # Open response: use raw text directly
            if question_type == "open_response":
                text = content.strip()
                return LLMResponse(answer=text if text else "", raw=content)

            # Multiple select: parse comma-separated letters from natural response
            if question_type == "multiple_select" and question and question.options:
                return LLMResponse.from_comma_separated(content, len(question.options), require_all=False, options=question.options)

            return LLMResponse.from_text(content)

    def complete(self, prompt: str, response_schema: dict = None, *, question: "Optional[Question]" = None) -> LLMResponse:
        """
        Get completion from vLLM using Completions API.

        Args:
            prompt: The full prompt (should end with "Answer:")
            response_schema: Ignored for vLLM (kept for interface compatibility)
            question: Optional question metadata. Enables type-appropriate
                      guided decoding (choice for MCQ, regex for multiple_select/ranking).
        """
        import logging
        logger = logging.getLogger(__name__)

        # Determine guided decoding params based on question type
        guided_params = None
        if self.use_guided_decoding and question is not None and question.options:
            n = len(question.options)
            last = chr(64 + n)  # 'D' for 4 options
            if question.type == "mcq":
                guided_params = ("choice", [chr(65 + i) for i in range(n)])
            elif question.type == "ranking":
                guided_params = ("regex", f"[A-{last}](, [A-{last}]){{{n-1}}}")
            # multiple_select: no guided decoding — regex forces model to
            # fill all slots instead of choosing a subset. Let it respond
            # naturally and parse the comma-separated letters.
            # open_response: no guided decoding

        last_error = None

        for attempt in range(self.max_retries):
            try:
                return self._make_request(prompt, guided_params=guided_params, question=question)
            except NonRetryableError:
                raise
            except RetryableError as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    wait_time = min(2 ** attempt, 30)
                    logger.warning(f"Retrying in {wait_time}s after error: {e}")
                    time.sleep(wait_time)
            except httpx.TimeoutException as e:
                last_error = RetryableError(f"Timeout: {e}")
                if attempt < self.max_retries - 1:
                    wait_time = min(2 ** attempt, 30)
                    logger.warning(f"Retrying in {wait_time}s after timeout")
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
                max_tokens=max_tokens if max_tokens is not None else 128,  # Default 128 like anthology
                max_retries=max_retries,
            )
        else:
            raise ValueError(f"Unknown provider: {provider}. Supported: openrouter, vllm")
