"""
Unified OpenAI SDK client for both OpenRouter and vLLM.
Provides both sync (complete) and async (async_complete) interfaces.
"""
import json
import logging
import re
from dataclasses import dataclass
from typing import Optional, List, TYPE_CHECKING

if TYPE_CHECKING:
    from .prompt import Question

import openai
from openai import AsyncOpenAI, OpenAI

logger = logging.getLogger(__name__)


# ─── Error classes ───────────────────────────────────────────────────────────

class LLMError(Exception):
    """Base exception for LLM errors."""

class RetryableError(LLMError):
    """Error that can be retried (rate limits, server errors)."""

class NonRetryableError(LLMError):
    """Error that should not be retried (auth, bad request)."""

class TruncationError(LLMError):
    """Response was truncated (likely exceeded max_tokens)."""

class StructuredOutputNotSupported(LLMError):
    """Model doesn't support structured output (json_schema)."""


# ─── LLMResponse ─────────────────────────────────────────────────────────────

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
            error_msg = str(e).lower()
            if "unterminated string" in error_msg or "expecting" in error_msg:
                raise TruncationError(f"Response appears truncated: {e}. Raw: {json_str[:200]}")
            raise NonRetryableError(f"Invalid JSON response from LLM: {e}. Raw: {json_str[:200]}")

        # Handle different response formats: answer, answers (multiple_select), ranking
        answer = data.get("answer")
        if answer is None:
            answers = data.get("answers")
            if answers is not None:
                answer = ",".join(answers) if isinstance(answers, list) else str(answers)
            else:
                ranking = data.get("ranking")
                if ranking is not None:
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
        options: Optional[List[str]] = None,
    ) -> "LLMResponse":
        """
        Parse comma-separated letters from various formats.

        Handles: "A, C, D", "(A), (B), (D)", "[A], [B]", mixed formats,
        and option text fallback.

        Args:
            text: Raw response text
            num_options: Number of valid options (determines valid letter range)
            require_all: If True, all letters must be present (for ranking)
            options: Optional list of option texts for text-matching fallback
        """
        valid = {chr(65 + i) for i in range(num_options)}

        segments = [s.strip() for s in text.split(",")]
        letters = []
        for seg in segments:
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
                        break

        if require_all and set(result) != valid:
            return cls(answer="", raw=text)
        if result:
            return cls(answer=",".join(result), raw=text)
        return cls(answer="", raw=text)

    @classmethod
    def from_text(cls, text: str) -> "LLMResponse":
        """
        Parse LLM response from plain text (anthology style).
        Extracts the first letter (A, B, C, D, etc.) from the response.
        """
        text = text.strip()

        # Try to find answer letter at the start
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
                if answer in 'ABCDEFGHIJ':
                    return cls(answer=answer, raw=text)

        # Stricter fallback: anthology-style pattern
        anthology_pattern = r"(?:^|[\[\(\"\' ])([A-Z])(?=$|[\]\)\"., ])(?!'m)(?!'d)(?!'ll)(?!'ve)(?!'re)(?! think)(?! am)(?! have)(?! would)(?! was)(?! great)(?! lot)(?! little)(?! good)(?! bad)(?! don)"
        match = re.search(anthology_pattern, text)
        if match:
            answer = match.group(1).upper()
            if answer in 'ABCDEFGH':
                return cls(answer=answer, raw=text)

        logger.warning(f"Failed to parse MCQ answer from: {repr(text[:100])}")
        return cls(answer="", raw=text)


# ─── UnifiedLLMClient ────────────────────────────────────────────────────────


class UnifiedLLMClient:
    """
    Single LLM client for both OpenRouter and vLLM via OpenAI SDK.

    Both OpenRouter and vLLM expose OpenAI-compatible APIs.
    Uses openai.OpenAI/AsyncOpenAI(base_url=...) for both.

    Structured output:
      - vLLM: extra_body={"structured_outputs": {"choice": [...]}} or {"regex": "..."}
      - OpenRouter: response_format={"type": "json_schema", ...}
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        provider: str,
        temperature: float = 0.0,
        max_tokens: Optional[int] = 512,
        max_retries: int = 3,
        use_guided_decoding: bool = True,
    ):
        self.model = model
        self.provider = provider
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.use_guided_decoding = use_guided_decoding

        self._sync_client = OpenAI(
            base_url=base_url, api_key=api_key, max_retries=max_retries,
        )
        self._async_client = AsyncOpenAI(
            base_url=base_url, api_key=api_key, max_retries=max_retries,
        )

    def _build_create_params(self, question: "Optional[Question]") -> dict:
        """
        Build extra kwargs for chat.completions.create() based on provider + question type.

        For vLLM: returns extra_body with structured_outputs (choice/regex)
        For OpenRouter: returns response_format with json_schema
        """
        if not self.use_guided_decoding or not question or not question.options:
            return {}

        n = len(question.options)
        letters = [chr(65 + i) for i in range(n)]
        last = letters[-1]

        if self.provider == "vllm":
            if question.type == "mcq":
                return {"extra_body": {"structured_outputs": {"choice": letters}}}
            elif question.type == "multiple_select":
                return {"extra_body": {"structured_outputs": {"regex": f"[A-{last}](, [A-{last}])*"}}}
            elif question.type == "ranking":
                return {"extra_body": {"structured_outputs": {"regex": f"[A-{last}](, [A-{last}]){{{n-1}}}"}}}
        elif self.provider == "openrouter":
            from .prompt import get_response_schema
            schema = get_response_schema(question)
            return {
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "answer", "strict": True, "schema": schema}
                }
            }

        return {}

    def _effective_max_tokens(self, question: "Optional[Question]") -> Optional[int]:
        """Determine max_tokens based on question type and guided decoding."""
        if not question:
            return self.max_tokens
        if self.provider == "vllm" and self.use_guided_decoding and question.options:
            if question.type == "mcq":
                return 1
            elif question.type in ("multiple_select", "ranking"):
                return 3 * len(question.options)
        return self.max_tokens

    def _parse_response(self, content: str, question: "Optional[Question]") -> LLMResponse:
        """Parse response based on provider and question type."""
        if not content:
            return LLMResponse(answer="", raw="")

        # OpenRouter with json_schema returns JSON
        if self.provider == "openrouter" and self.use_guided_decoding and question and question.options:
            return LLMResponse.from_json(content)

        # vLLM with guided decoding
        if self.provider == "vllm" and self.use_guided_decoding and question and question.options:
            if question.type == "mcq":
                letter = content.strip().upper()
                valid = {chr(65 + i) for i in range(len(question.options))}
                if letter in valid:
                    return LLMResponse(answer=letter, raw=content)
            elif question.type in ("multiple_select", "ranking"):
                require_all = question.type == "ranking"
                return LLMResponse.from_comma_separated(
                    content, len(question.options),
                    require_all=require_all, options=question.options,
                )

        # Open response: use raw text directly
        if question and question.type == "open_response":
            return LLMResponse(answer=content.strip(), raw=content)

        # Multiple select / ranking without guided decoding
        if question and question.type == "multiple_select" and question.options:
            return LLMResponse.from_comma_separated(
                content, len(question.options), require_all=False, options=question.options,
            )
        if question and question.type == "ranking" and question.options:
            return LLMResponse.from_comma_separated(
                content, len(question.options), require_all=True, options=question.options,
            )

        # Fallback: text parsing
        return LLMResponse.from_text(content)

    def complete(self, prompt: str, *, question: "Optional[Question]" = None) -> LLMResponse:
        """Get completion from LLM (sync)."""
        params = self._build_create_params(question)
        messages = [{"role": "user", "content": prompt}]

        try:
            response = self._sync_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=self._effective_max_tokens(question),
                **params,
            )
            content = response.choices[0].message.content or ""
            return self._parse_response(content, question)
        except openai.BadRequestError as e:
            error_str = str(e).lower()
            if "json" in error_str or "schema" in error_str or "chat_template" in error_str:
                if self.provider == "openrouter":
                    logger.warning(f"Structured output not supported, falling back to text mode: {e}")
                    return self._complete_text_fallback(prompt, question)
                raise StructuredOutputNotSupported(str(e))
            raise NonRetryableError(str(e))
        except openai.AuthenticationError as e:
            raise NonRetryableError(str(e))
        except openai.RateLimitError as e:
            raise RetryableError(str(e))
        except openai.APIStatusError as e:
            if e.status_code >= 500:
                raise RetryableError(str(e))
            raise NonRetryableError(str(e))

    def _complete_text_fallback(self, prompt: str, question: "Optional[Question]") -> LLMResponse:
        """Retry without structured output (text mode for OpenRouter)."""
        text_prompt = prompt + "\n\nRespond with ONLY the letter of your answer (A, B, C, D, etc.) and nothing else."
        messages = [{"role": "user", "content": text_prompt}]
        try:
            response = self._sync_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=self._effective_max_tokens(question),
            )
            content = response.choices[0].message.content or ""
            return LLMResponse.from_text(content)
        except Exception as e:
            raise NonRetryableError(f"Text fallback also failed: {e}")

    async def async_complete(self, prompt: str, *, question: "Optional[Question]" = None) -> LLMResponse:
        """Get completion from LLM (async)."""
        params = self._build_create_params(question)
        messages = [{"role": "user", "content": prompt}]

        try:
            response = await self._async_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=self._effective_max_tokens(question),
                **params,
            )
            content = response.choices[0].message.content or ""
            return self._parse_response(content, question)
        except openai.BadRequestError as e:
            error_str = str(e).lower()
            if "json" in error_str or "schema" in error_str or "chat_template" in error_str:
                if self.provider == "openrouter":
                    logger.warning(f"Structured output not supported, falling back to text mode: {e}")
                    return await self._async_complete_text_fallback(prompt, question)
                raise StructuredOutputNotSupported(str(e))
            raise NonRetryableError(str(e))
        except openai.AuthenticationError as e:
            raise NonRetryableError(str(e))
        except openai.RateLimitError as e:
            raise RetryableError(str(e))
        except openai.APIStatusError as e:
            if e.status_code >= 500:
                raise RetryableError(str(e))
            raise NonRetryableError(str(e))

    async def _async_complete_text_fallback(self, prompt: str, question: "Optional[Question]") -> LLMResponse:
        """Retry without structured output (text mode for OpenRouter, async)."""
        text_prompt = prompt + "\n\nRespond with ONLY the letter of your answer (A, B, C, D, etc.) and nothing else."
        messages = [{"role": "user", "content": text_prompt}]
        try:
            response = await self._async_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=self._effective_max_tokens(question),
            )
            content = response.choices[0].message.content or ""
            return LLMResponse.from_text(content)
        except Exception as e:
            raise NonRetryableError(f"Text fallback also failed: {e}")

    async def close(self):
        """Close the async client."""
        await self._async_client.close()
