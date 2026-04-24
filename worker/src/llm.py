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

from .logprobs import LogprobsResult
from .response import (
    LLMResponse,
    LLMUsage,
    RetryableError,
    NonRetryableError,
    TruncationError,
    StructuredOutputNotSupported,
    MultimodalNotSupportedError,
    clean_open_response,
)

logger = logging.getLogger(__name__)


# ─── UnifiedLLMClient ────────────────────────────────────────────────────────


class UnifiedLLMClient:
    """
    Single LLM client for both OpenRouter and vLLM via OpenAI SDK.

    Both OpenRouter and vLLM expose OpenAI-compatible APIs.
    Uses openai.OpenAI/AsyncOpenAI(base_url=...) for both.

    API modes:
      - use_chat_template=False (default): /v1/completions (text completions)
      - use_chat_template=True: /v1/chat/completions (chat format)

    Structured output:
      - vLLM MCQ: extra_body={"structured_outputs": {"choice": [...]}} (both modes)
      - JSON schema: response_format={"type": "json_schema", ...} (chat mode only)
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
        use_chat_template: bool = False,
    ):
        self.model = model
        self.provider = provider
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.use_guided_decoding = use_guided_decoding
        self.use_chat_template = use_chat_template

        self._sync_client = OpenAI(
            base_url=base_url, api_key=api_key, max_retries=max_retries,
        )
        self._async_client = AsyncOpenAI(
            base_url=base_url, api_key=api_key, max_retries=max_retries,
        )

    def _build_create_params(self, question: "Optional[Question]") -> dict:
        """
        Build extra kwargs for completions.create() or chat.completions.create().

        For vLLM: extra_body with structured_outputs (MCQ choice) or
                  response_format with json_schema (multiple_select/ranking).
                  Both work in /v1/completions and /v1/chat/completions.
        For OpenRouter: response_format with json_schema (chat mode only,
                        not supported in /v1/completions).
        """
        if not self.use_guided_decoding or not question or not question.options:
            return {}

        letters = [chr(65 + i) for i in range(len(question.options))]

        # vLLM MCQ: constrained sampling to a single letter (both API modes)
        if self.provider == "vllm" and question.type == "mcq":
            return {"extra_body": {"structured_outputs": {"choice": letters}}}

        # JSON schema for non-MCQ structured output
        from .prompt import get_response_schema
        schema = get_response_schema(question)
        rf = {
            "type": "json_schema",
            "json_schema": {"name": "answer", "strict": True, "schema": schema}
        }

        if self.use_chat_template:
            # Chat Completions API accepts response_format as a top-level param
            return {"response_format": rf}

        # Legacy Completions API: the OpenAI SDK rejects response_format as a
        # top-level kwarg, so pass it via extra_body instead.
        return {"extra_body": {"response_format": rf}}

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
            # Truncated JSON (max_tokens hit mid-generation, often due to
            # base models wasting tokens on whitespace).  Return empty answer
            # so the compliance retry loop handles it per-question, rather
            # than blowing up the entire task.
            logger.warning(f"Structured output truncated (len={len(content)}). "
                           f"Raw: {content[:200]!r}")
            return LLMResponse(answer="", raw=content)

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

        # JSON schema response — parse when structured output was actually sent.
        # We send JSON schema for any question with options, EXCEPT vLLM MCQ
        # (which uses extra_body.structured_outputs choice constraint instead).
        if self.use_guided_decoding and question and question.options:
            sent_json_schema = (
                question.type != "mcq" or self.provider == "openrouter"
            )
            if sent_json_schema:
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

        # Open response: clean up raw text, preserve original in raw field
        if question and question.type == "open_response":
            return LLMResponse(answer=clean_open_response(content), raw=content)

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

    @staticmethod
    def _extract_usage(response) -> Optional[LLMUsage]:
        """Normalize usage details from OpenAI-compatible responses."""
        usage = getattr(response, "usage", None)
        if not usage:
            return None

        prompt_details = getattr(usage, "prompt_tokens_details", None)
        completion_details = getattr(usage, "completion_tokens_details", None)

        return LLMUsage(
            prompt_tokens=getattr(usage, "prompt_tokens", None),
            completion_tokens=getattr(usage, "completion_tokens", None),
            total_tokens=getattr(usage, "total_tokens", None),
            cost=getattr(usage, "cost", None),
            reasoning_tokens=getattr(completion_details, "reasoning_tokens", None) if completion_details else None,
            cached_tokens=getattr(prompt_details, "cached_tokens", None) if prompt_details else None,
            cache_write_tokens=getattr(prompt_details, "cache_write_tokens", None) if prompt_details else None,
            audio_tokens=getattr(prompt_details, "audio_tokens", None) if prompt_details else None,
        )

    @staticmethod
    def _attach_usage(parsed: LLMResponse, response) -> LLMResponse:
        parsed.usage = UnifiedLLMClient._extract_usage(response)
        return parsed

    @staticmethod
    def _is_multimodal_error(error_str: str) -> bool:
        """Check if an error is about unsupported multimodal content."""
        keywords = ("content type", "image", "multimodal", "vision", "audio", "media")
        return any(kw in error_str for kw in keywords)

    def complete(self, prompt, *, question: "Optional[Question]" = None) -> LLMResponse:
        """Get completion from LLM (sync). Prompt can be str or list of content parts."""
        params = self._build_create_params(question)
        is_multimodal = isinstance(prompt, list)

        try:
            if self.use_chat_template or is_multimodal:
                messages = [{"role": "user", "content": prompt}]
                response = self._sync_client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=self.temperature,
                    max_tokens=self._effective_max_tokens(question),
                    **params,
                )
                choice = response.choices[0]
                content = choice.message.content or ""
                finish_reason = choice.finish_reason
            else:
                response = self._sync_client.completions.create(
                    model=self.model,
                    prompt=prompt,
                    temperature=self.temperature,
                    max_tokens=self._effective_max_tokens(question),
                    **params,
                )
                choice = response.choices[0]
                content = choice.text or ""
                finish_reason = choice.finish_reason
            is_open = question and question.type == "open_response"
            if finish_reason == "length" and self._effective_max_tokens(question) == self.max_tokens and not is_open:
                if params:
                    logger.warning(
                        f"Response truncated (finish_reason=length, max_tokens={self.max_tokens}), "
                        "falling back to text mode"
                    )
                    return self._complete_text_fallback(prompt, question, truncated=True)
                raise TruncationError(
                    f"Response truncated at max_tokens={self.max_tokens}. "
                    "Increase max_tokens in Settings (thinking models like Gemini 2.5 Pro need ≥1024)."
                )
            return self._attach_usage(self._parse_response(content, question), response)
        except openai.BadRequestError as e:
            error_str = str(e).lower()
            if is_multimodal and self._is_multimodal_error(error_str):
                raise MultimodalNotSupportedError(str(e))
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

    def _complete_text_fallback(self, prompt, question: "Optional[Question]", truncated: bool = False) -> LLMResponse:
        """Retry without structured output (text mode)."""
        suffix = "\n\nRespond with ONLY the letter of your answer (A, B, C, D, etc.) and nothing else."
        if isinstance(prompt, list):
            text_prompt = prompt + [{"type": "text", "text": suffix}]
        else:
            text_prompt = prompt + suffix
        try:
            if self.use_chat_template or isinstance(prompt, list):
                messages = [{"role": "user", "content": text_prompt}]
                response = self._sync_client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=self.temperature,
                    max_tokens=self._effective_max_tokens(question),
                )
                choice = response.choices[0]
                content = choice.message.content or ""
                finish_reason = choice.finish_reason
            else:
                response = self._sync_client.completions.create(
                    model=self.model,
                    prompt=text_prompt,
                    temperature=self.temperature,
                    max_tokens=self._effective_max_tokens(question),
                )
                choice = response.choices[0]
                content = choice.text or ""
                finish_reason = choice.finish_reason
            if finish_reason == "length":
                raise TruncationError(
                    f"Response truncated at max_tokens={self.max_tokens} even in text mode. "
                    "Increase max_tokens in Settings (thinking models like Gemini 2.5 Pro need ≥1024)."
                )
            return self._attach_usage(LLMResponse.from_text(content), response)
        except TruncationError:
            raise
        except Exception as e:
            raise NonRetryableError(f"Text fallback also failed: {e}")

    async def async_complete(self, prompt, *, question: "Optional[Question]" = None) -> LLMResponse:
        """Get completion from LLM (async). Prompt can be str or list of content parts."""
        params = self._build_create_params(question)
        is_multimodal = isinstance(prompt, list)

        try:
            if self.use_chat_template or is_multimodal:
                messages = [{"role": "user", "content": prompt}]
                response = await self._async_client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=self.temperature,
                    max_tokens=self._effective_max_tokens(question),
                    **params,
                )
                choice = response.choices[0]
                content = choice.message.content or ""
                finish_reason = choice.finish_reason
            else:
                response = await self._async_client.completions.create(
                    model=self.model,
                    prompt=prompt,
                    temperature=self.temperature,
                    max_tokens=self._effective_max_tokens(question),
                    **params,
                )
                choice = response.choices[0]
                content = choice.text or ""
                finish_reason = choice.finish_reason
            is_open = question and question.type == "open_response"
            if finish_reason == "length" and self._effective_max_tokens(question) == self.max_tokens and not is_open:
                if params:
                    logger.warning(
                        f"Response truncated (finish_reason=length, max_tokens={self.max_tokens}), "
                        "falling back to text mode"
                    )
                    return await self._async_complete_text_fallback(prompt, question, truncated=True)
                raise TruncationError(
                    f"Response truncated at max_tokens={self.max_tokens}. "
                    "Increase max_tokens in Settings (thinking models like Gemini 2.5 Pro need ≥1024)."
                )
            return self._attach_usage(self._parse_response(content, question), response)
        except openai.BadRequestError as e:
            error_str = str(e).lower()
            if is_multimodal and self._is_multimodal_error(error_str):
                raise MultimodalNotSupportedError(str(e))
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

    async def _async_complete_text_fallback(self, prompt, question: "Optional[Question]", truncated: bool = False) -> LLMResponse:
        """Retry without structured output (text mode, async)."""
        suffix = "\n\nRespond with ONLY the letter of your answer (A, B, C, D, etc.) and nothing else."
        if isinstance(prompt, list):
            text_prompt = prompt + [{"type": "text", "text": suffix}]
        else:
            text_prompt = prompt + suffix
        try:
            if self.use_chat_template or isinstance(prompt, list):
                messages = [{"role": "user", "content": text_prompt}]
                response = await self._async_client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=self.temperature,
                    max_tokens=self._effective_max_tokens(question),
                )
                choice = response.choices[0]
                content = choice.message.content or ""
                finish_reason = choice.finish_reason
            else:
                response = await self._async_client.completions.create(
                    model=self.model,
                    prompt=text_prompt,
                    temperature=self.temperature,
                    max_tokens=self._effective_max_tokens(question),
                )
                choice = response.choices[0]
                content = choice.text or ""
                finish_reason = choice.finish_reason
            if finish_reason == "length":
                raise TruncationError(
                    f"Response truncated at max_tokens={self.max_tokens} even in text mode. "
                    "Increase max_tokens in Settings (thinking models like Gemini 2.5 Pro need ≥1024)."
                )
            return self._attach_usage(LLMResponse.from_text(content), response)
        except TruncationError:
            raise
        except Exception as e:
            raise NonRetryableError(f"Text fallback also failed: {e}")

    async def async_complete_logprobs(self, prompt: str) -> LogprobsResult:
        """
        Get logprobs from LLM (async). Forces max_tokens=1, temperature=0.0.

        No structured output / guided decoding — logprobs require unconstrained
        generation to get the true model probability distribution.

        Handles both API modes:
          - Chat API (use_chat_template=True): logprobs=True, top_logprobs=20
          - Completion API (use_chat_template=False): logprobs=20

        Returns LogprobsResult with unified format regardless of API mode.
        """
        try:
            if self.use_chat_template:
                response = await self._async_client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                    max_tokens=1,
                    logprobs=True,
                    top_logprobs=20,
                )
                choice = response.choices[0]
                generated_token = choice.message.content or ""
                # Chat API: List[ChatCompletionTokenLogprob] with .token and .logprob
                raw_top = choice.logprobs.content[0].top_logprobs if (
                    choice.logprobs and choice.logprobs.content
                ) else []
                top_logprobs = {entry.token: entry.logprob for entry in raw_top}
            else:
                response = await self._async_client.completions.create(
                    model=self.model,
                    prompt=prompt,
                    temperature=0.0,
                    max_tokens=1,
                    logprobs=20,
                )
                choice = response.choices[0]
                generated_token = choice.text or ""
                # Completion API: Dict[str, float] directly
                raw_top = choice.logprobs.top_logprobs[0] if (
                    choice.logprobs and choice.logprobs.top_logprobs
                ) else {}
                top_logprobs = dict(raw_top) if raw_top else {}

            return LogprobsResult(
                generated_token=generated_token,
                top_logprobs=top_logprobs,
            )
        except openai.AuthenticationError as e:
            raise NonRetryableError(str(e))
        except openai.RateLimitError as e:
            raise RetryableError(str(e))
        except openai.APIStatusError as e:
            if e.status_code >= 500:
                raise RetryableError(str(e))
            raise NonRetryableError(str(e))

    async def close(self):
        """Close the async client."""
        await self._async_client.close()
