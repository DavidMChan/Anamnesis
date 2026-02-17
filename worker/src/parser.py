"""
Parser LLM module — Tier 2 fallback for MCQ response parsing.

Uses a cheap instruction-tuned model (e.g. Gemini Flash) to extract
the answer letter from verbose/ambiguous base model responses.

Follows Alterity's approach: send the question + raw response to a
parser model with strict instructions to output only a single letter.
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

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    def _build_prompt(self, raw_response: str, question: Question) -> str:
        options_str = "\n".join(
            f"({chr(65 + i)}) {opt}" for i, opt in enumerate(question.options or [])
        )
        return PARSER_PROMPT_TEMPLATE.format(
            question_text=question.text,
            options=options_str,
            raw_response=raw_response,
        )

    def parse(self, raw_response: str, question: Question) -> str:
        """
        Parse a verbose LLM response into a single answer letter.

        Args:
            raw_response: The raw text output from the base model
            question: The question being answered

        Returns:
            Single letter (A, B, C, ...) if extracted, empty string otherwise
        """
        if not self.is_configured:
            return ""

        prompt = self._build_prompt(raw_response, question)

        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
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

            # Extract the letter from "Answer: B" or just "B"
            if "Answer:" in content:
                letter = content.split("Answer:")[1].strip().upper()
            else:
                letter = content.strip().upper()

            # "X" means no match — return empty
            if letter == "X":
                return ""

            # Validate it's a single valid letter
            if len(letter) == 1 and letter.isalpha() and ord(letter) - ord("A") < len(question.options or []):
                return letter

            return ""

        except Exception as e:
            logger.warning(f"Parser LLM error: {e}")
            return ""
