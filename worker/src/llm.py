"""
Unified OpenAI SDK client for both OpenRouter and vLLM.
Provides both sync (complete) and async (async_complete) interfaces.
"""
import json
import logging
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .prompt import Question

import openai
from openai import AsyncOpenAI, OpenAI

from .response import (
    LLMResponse,
    LLMError,
    RetryableError,
    NonRetryableError,
    TruncationError,
    StructuredOutputNotSupported,
)

logger = logging.getLogger(__name__)


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
            elif question.type in ("multiple_select", "ranking"):
                # Use JSON schema via response_format (same as OpenRouter)
                from .prompt import get_response_schema
                schema = get_response_schema(question)
                return {
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {"name": "answer", "strict": True, "schema": schema}
                    }
                }
            # OLD: regex guided decoding for multiple_select/ranking
            # elif question.type == "multiple_select":
            #     return {"extra_body": {"structured_outputs": {"regex": f"[A-{last}](, [A-{last}])*"}}}
            # elif question.type == "ranking":
            #     return {"extra_body": {"structured_outputs": {"regex": f"[A-{last}](, [A-{last}]){{{n-1}}}"}}}
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
            # multiple_select/ranking: JSON schema constrains output, use default max_tokens
        return self.max_tokens

    def _parse_structured_response(self, content: str, question: "Question") -> LLMResponse:
        """Parse a JSON structured output response.

        The server already enforces the json_schema, so we just json.loads()
        and extract the fields. Only thing that can go wrong is truncation
        (max_tokens hit mid-JSON).
        """
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            raise TruncationError(
                f"Response appears truncated. Raw: {content[:200]}"
            )

        if question.type == "mcq":
            return LLMResponse(answer=data.get("answer", ""), raw=content)

        elif question.type == "multiple_select":
            selected = sorted(
                k.split("_", 1)[1]
                for k, v in data.items()
                if k.startswith("choice_") and v
            )
            return LLMResponse(answer=",".join(selected), raw=content)

        elif question.type == "ranking":
            ranking = data.get("ranking", [])
            num_options = len(question.options)
            expected = {chr(65 + i) for i in range(num_options)}
            if set(ranking) != expected or len(ranking) != num_options:
                return LLMResponse(answer="", raw=content)
            return LLMResponse(answer=",".join(ranking), raw=content)

        else:
            return LLMResponse(answer=data.get("answer", ""), raw=content)

    def _parse_response(self, content: str, question: "Optional[Question]") -> LLMResponse:
        """Parse response based on provider and question type."""
        if not content:
            return LLMResponse(answer="", raw="")

        # JSON schema response (OpenRouter all types, vLLM multiple_select/ranking)
        if self.use_guided_decoding and question and question.options:
            if question.type in ("multiple_select", "ranking"):
                return self._parse_structured_response(content, question)
            elif self.provider == "openrouter":
                return self._parse_structured_response(content, question)

        # vLLM MCQ with guided decoding (extra_body choice, not JSON)
        if self.provider == "vllm" and self.use_guided_decoding and question and question.options:
            if question.type == "mcq":
                letter = content.strip().upper()
                valid = {chr(65 + i) for i in range(len(question.options))}
                if letter in valid:
                    return LLMResponse(answer=letter, raw=content)

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
