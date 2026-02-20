"""
Parser LLM module — Tier 2 fallback for MCQ response parsing.

Uses a cheap instruction-tuned model (e.g. Gemini Flash) to extract
the answer letter from verbose/ambiguous base model responses.

Follows Alterity's approach: send the question + raw response to a
parser model with strict instructions to output only a single letter.

Provides both sync (parse) and async (async_parse) interfaces.
"""
import logging
from typing import Optional

import httpx

from .prompt import Question

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


class ParserLLM:
    """
    Tier 2 parser that uses an instruction-tuned LLM to extract
    MCQ answer letters from verbose base model responses.
    """

    BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

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
        self.timeout = timeout
        self._async_client: Optional[httpx.AsyncClient] = None

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

    def parse(self, raw_response: str, question: Question) -> str:
        """
        Parse a verbose LLM response into an answer.

        For MCQ: returns single letter (A, B, C, ...)
        For multiple_select: returns comma-separated letters (A,C,D)
        For ranking: returns comma-separated letters in order (B,A,C,D)

        Args:
            raw_response: The raw text output from the base model
            question: The question being answered

        Returns:
            Parsed answer string, or empty string on failure
        """
        if not self.is_configured:
            return ""

        prompt = self._build_prompt(raw_response, question)

        # Adjust max_tokens for multi-letter responses
        effective_max_tokens = self.max_tokens
        if question.type in ("multiple_select", "ranking") and question.options:
            effective_max_tokens = 3 * len(question.options)

        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": self.temperature,
                "max_tokens": effective_max_tokens,
            }

            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(self.BASE_URL, headers=headers, json=payload)

            if response.status_code != 200:
                logger.warning(f"Parser LLM request failed: {response.status_code}")
                return ""

            data = response.json()
            if "choices" not in data or not data["choices"]:
                return ""

            content = data["choices"][0]["message"]["content"].strip()

            # Extract content after "Answer:" if present
            if "Answer:" in content:
                content = content.split("Answer:")[1].strip().upper()
            else:
                content = content.strip().upper()

            # "X" means no match — return empty
            if content == "X":
                return ""

            # Dispatch parsing based on question type
            if question.type in ("multiple_select", "ranking"):
                return self._parse_comma_separated(content, question)
            else:
                return self._parse_single_letter(content, question)

        except Exception as e:
            logger.warning(f"Parser LLM error: {e}")
            return ""

    def _parse_single_letter(self, content: str, question: Question) -> str:
        """Parse a single letter answer for MCQ."""
        if len(content) == 1 and content.isalpha() and ord(content) - ord("A") < len(question.options or []):
            return content
        return ""

    def _parse_comma_separated(self, content: str, question: Question) -> str:
        """Parse comma-separated letters for multiple_select/ranking."""
        from .llm import LLMResponse
        num_options = len(question.options or [])
        require_all = question.type == "ranking"
        result = LLMResponse.from_comma_separated(content, num_options, require_all=require_all)
        return result.answer

    def _get_async_client(self) -> httpx.AsyncClient:
        """Get or create shared async HTTP client."""
        if self._async_client is None or self._async_client.is_closed:
            self._async_client = httpx.AsyncClient(timeout=self.timeout)
        return self._async_client

    async def async_parse(self, raw_response: str, question: Question) -> str:
        """
        Async version of parse().

        Same interface but uses async HTTP client.
        """
        if not self.is_configured:
            return ""

        prompt = self._build_prompt(raw_response, question)

        effective_max_tokens = self.max_tokens
        if question.type in ("multiple_select", "ranking") and question.options:
            effective_max_tokens = 3 * len(question.options)

        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": self.temperature,
                "max_tokens": effective_max_tokens,
            }

            client = self._get_async_client()
            response = await client.post(self.BASE_URL, headers=headers, json=payload)

            if response.status_code != 200:
                logger.warning(f"Parser LLM request failed: {response.status_code}")
                return ""

            data = response.json()
            if "choices" not in data or not data["choices"]:
                return ""

            content = data["choices"][0]["message"]["content"].strip()

            if "Answer:" in content:
                content = content.split("Answer:")[1].strip().upper()
            else:
                content = content.strip().upper()

            if content == "X":
                return ""

            if question.type in ("multiple_select", "ranking"):
                return self._parse_comma_separated(content, question)
            else:
                return self._parse_single_letter(content, question)

        except Exception as e:
            logger.warning(f"Parser LLM error: {e}")
            return ""

    async def close(self) -> None:
        """Close the shared async HTTP client."""
        if self._async_client and not self._async_client.is_closed:
            await self._async_client.aclose()
            self._async_client = None
