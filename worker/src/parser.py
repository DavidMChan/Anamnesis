"""
Parser LLM module — Tier 2 fallback for MCQ response parsing.

Uses a cheap instruction-tuned model (e.g. Gemini Flash) via OpenRouter
to extract the answer letter from verbose/ambiguous base model responses.

Uses the OpenAI SDK (OpenRouter is OpenAI-compatible).

Provides both sync (parse) and async (async_parse) interfaces.
"""
import logging
from typing import Optional

from openai import OpenAI, AsyncOpenAI

from .prompt import Question
from .response import LLMResponse, LLMUsage

logger = logging.getLogger(__name__)

PARSER_PROMPT_TEMPLATE = """You are given a question and a response to that question.
Please select the option specified in the question that strictly matches the response.

Requirements:
Answer ONLY as a single upper-case character.
DO NOT infer what option matches the response: if there is no strict match, answer 'X'.

Question: {question_text}
{options}

Response: {raw_response}

Answer:"""

PARSER_PROMPT_MULTIPLE_SELECT = """You are given a question and a response to that question.
Extract which options the response selects.

Requirements:
Answer as comma-separated uppercase letters (e.g., A, C, D).
Only include options that are clearly selected in the response.
If no match, answer 'X'.

Question: {question_text}
{options}

Response: {raw_response}

Answer:"""

PARSER_PROMPT_RANKING = """You are given a question and a response to that question.
Extract the ranking order from the response.

Requirements:
Answer as ordered comma-separated uppercase letters from most to least preferred, including ALL options (e.g., B, A, C, D).
If the response does not contain a clear ranking of all options, answer 'X'.

Question: {question_text}
{options}

Response: {raw_response}

Answer:"""

BASE_URL = "https://openrouter.ai/api/v1"


class ParserLLM:
    """
    Tier 2 parser that uses an instruction-tuned LLM to extract
    MCQ answer letters from verbose base model responses.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "google/gemini-2.0-flash-001",
        max_tokens: int = 4,
        temperature: float = 0.0,
        timeout: float = 30.0,
    ):
        self.api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature

        if api_key:
            self._sync_client = OpenAI(
                base_url=BASE_URL, api_key=api_key, timeout=timeout, max_retries=2,
            )
            self._async_client = AsyncOpenAI(
                base_url=BASE_URL, api_key=api_key, timeout=timeout, max_retries=2,
            )
        else:
            self._sync_client = None
            self._async_client = None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    def _build_prompt(self, raw_response: str, question: Question) -> str:
        options_str = "\n".join(
            f"({chr(65 + i)}) {opt}" for i, opt in enumerate(question.options or [])
        )
        if question.type == "multiple_select":
            template = PARSER_PROMPT_MULTIPLE_SELECT
        elif question.type == "ranking":
            template = PARSER_PROMPT_RANKING
        else:
            template = PARSER_PROMPT_TEMPLATE
        return template.format(
            question_text=question.text,
            options=options_str,
            raw_response=raw_response,
        )

    def _effective_max_tokens(self, question: Question) -> int:
        if question.type in ("multiple_select", "ranking") and question.options:
            return 3 * len(question.options)
        return self.max_tokens

    def _extract_answer(self, content: str, question: Question) -> str:
        """Extract and validate answer from parser response."""
        # Extract content after "Answer:" if present
        if "Answer:" in content:
            content = content.split("Answer:")[1].strip().upper()
        else:
            content = content.strip().upper()

        # "X" means no match
        if content == "X":
            return ""

        if question.type in ("multiple_select", "ranking"):
            return self._parse_comma_separated(content, question)
        else:
            return self._parse_single_letter(content, question)

    @staticmethod
    def _extract_usage(response) -> Optional[LLMUsage]:
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

    def parse_response(self, raw_response: str, question: Question) -> LLMResponse:
        """Parse a verbose LLM response into an answer plus usage metadata (sync)."""
        if not self.is_configured:
            return LLMResponse(answer="")

        prompt = self._build_prompt(raw_response, question)

        try:
            response = self._sync_client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=self._effective_max_tokens(question),
            )
            content = response.choices[0].message.content or ""
            return LLMResponse(
                answer=self._extract_answer(content, question),
                raw=content,
                usage=self._extract_usage(response),
            )
        except Exception as e:
            logger.warning(f"Parser LLM error: {e}")
            return LLMResponse(answer="")

    def parse(self, raw_response: str, question: Question) -> str:
        """
        Parse a verbose LLM response into an answer (sync).

        For MCQ: returns single letter (A, B, C, ...)
        For multiple_select: returns comma-separated letters (A,C,D)
        For ranking: returns comma-separated letters in order (B,A,C,D)
        """
        return self.parse_response(raw_response, question).answer

    async def async_parse_response(self, raw_response: str, question: Question) -> LLMResponse:
        """Async version of parse_response()."""
        if not self.is_configured:
            return LLMResponse(answer="")

        prompt = self._build_prompt(raw_response, question)

        try:
            response = await self._async_client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=self.temperature,
                max_tokens=self._effective_max_tokens(question),
            )
            content = response.choices[0].message.content or ""
            return LLMResponse(
                answer=self._extract_answer(content, question),
                raw=content,
                usage=self._extract_usage(response),
            )
        except Exception as e:
            logger.warning(f"Parser LLM error: {e}")
            return LLMResponse(answer="")

    async def async_parse(self, raw_response: str, question: Question) -> str:
        """Async version of parse()."""
        return (await self.async_parse_response(raw_response, question)).answer

    def _parse_single_letter(self, content: str, question: Question) -> str:
        """Parse a single letter answer for MCQ."""
        if len(content) == 1 and content.isalpha() and ord(content) - ord("A") < len(question.options or []):
            return content
        return ""

    def _parse_comma_separated(self, content: str, question: Question) -> str:
        """Parse comma-separated letters for multiple_select/ranking."""
        num_options = len(question.options or [])
        require_all = question.type == "ranking"
        result = LLMResponse.from_comma_separated(content, num_options, require_all=require_all)
        return result.answer

    async def close(self) -> None:
        """Close the async client."""
        if self._async_client:
            await self._async_client.close()
