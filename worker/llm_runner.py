"""
LLM Runner for Virtual Personas Arena

This module handles running survey questions against backstories using various LLM providers.
It reuses concepts from the Alterity/Anthology codebases.
"""

import json
import re
from typing import Any
from dataclasses import dataclass
from tenacity import retry, stop_after_attempt, wait_exponential

import openai
import anthropic


@dataclass
class Question:
    qkey: str
    type: str  # 'mcq', 'multiple_select', 'open_response', 'ranking'
    text: str
    options: list[str] | None = None


@dataclass
class LLMConfig:
    provider: str  # 'openai', 'anthropic', 'together', 'vllm'
    api_key: str | None = None
    model: str = "gpt-4"
    vllm_endpoint: str | None = None


class LLMRunner:
    """Runs survey questions against backstories using LLMs."""

    def __init__(self, config: LLMConfig):
        self.config = config
        self._setup_client()

    def _setup_client(self):
        """Initialize the appropriate LLM client based on provider."""
        if self.config.provider == "openai":
            self.client = openai.OpenAI(api_key=self.config.api_key)
        elif self.config.provider == "anthropic":
            self.client = anthropic.Anthropic(api_key=self.config.api_key)
        elif self.config.provider == "together":
            self.client = openai.OpenAI(
                api_key=self.config.api_key,
                base_url="https://api.together.xyz/v1"
            )
        elif self.config.provider == "vllm":
            self.client = openai.OpenAI(
                api_key="EMPTY",
                base_url=self.config.vllm_endpoint
            )
        else:
            raise ValueError(f"Unknown provider: {self.config.provider}")

    def format_question_prompt(self, question: Question, backstory: str) -> str:
        """Format a question as a prompt for the LLM."""
        prompt = f"""You are a person with the following background and life story:

{backstory}

Based on your experiences, values, and perspectives described above, please answer the following question as this person would.

Question: {question.text}
"""

        if question.type == "mcq" and question.options:
            prompt += "\nChoose exactly ONE of the following options:\n"
            for i, opt in enumerate(question.options):
                prompt += f"  {chr(65 + i)}. {opt}\n"
            prompt += "\nRespond with ONLY the letter of your choice (A, B, C, etc.)."

        elif question.type == "multiple_select" and question.options:
            prompt += "\nSelect ALL options that apply (you may choose multiple):\n"
            for i, opt in enumerate(question.options):
                prompt += f"  {chr(65 + i)}. {opt}\n"
            prompt += "\nRespond with the letters of your choices separated by commas (e.g., 'A, C, D')."

        elif question.type == "ranking" and question.options:
            prompt += "\nRank the following options from most to least important/preferred:\n"
            for i, opt in enumerate(question.options):
                prompt += f"  {chr(65 + i)}. {opt}\n"
            prompt += "\nRespond with the letters in order of preference (e.g., 'C, A, B, D' if C is most preferred)."

        elif question.type == "open_response":
            prompt += "\nProvide your answer in 2-4 sentences."

        return prompt

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def query_llm(self, prompt: str) -> str:
        """Send a prompt to the LLM and get a response."""
        if self.config.provider == "anthropic":
            response = self.client.messages.create(
                model=self.config.model,
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )
            return response.content[0].text
        else:
            # OpenAI-compatible API (OpenAI, Together, vLLM)
            response = self.client.chat.completions.create(
                model=self.config.model,
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )
            return response.choices[0].message.content or ""

    def parse_response(self, response: str, question: Question) -> str | list[str]:
        """Parse the LLM response based on question type."""
        response = response.strip()

        if question.type == "mcq":
            # Extract single letter response
            match = re.search(r'^([A-Z])', response.upper())
            if match and question.options:
                idx = ord(match.group(1)) - ord('A')
                if 0 <= idx < len(question.options):
                    return question.options[idx]
            return response  # Fallback to raw response

        elif question.type == "multiple_select":
            # Extract multiple letters
            letters = re.findall(r'[A-Z]', response.upper())
            if letters and question.options:
                selected = []
                for letter in letters:
                    idx = ord(letter) - ord('A')
                    if 0 <= idx < len(question.options):
                        selected.append(question.options[idx])
                return selected if selected else [response]
            return [response]

        elif question.type == "ranking":
            # Extract ordered letters
            letters = re.findall(r'[A-Z]', response.upper())
            if letters and question.options:
                ranked = []
                for letter in letters:
                    idx = ord(letter) - ord('A')
                    if 0 <= idx < len(question.options):
                        ranked.append(question.options[idx])
                return ranked if ranked else [response]
            return [response]

        else:  # open_response
            return response

    def run_question(self, question: Question, backstory: str) -> str | list[str]:
        """Run a single question against a backstory."""
        prompt = self.format_question_prompt(question, backstory)
        response = self.query_llm(prompt)
        return self.parse_response(response, question)

    def run_survey(
        self,
        questions: list[dict[str, Any]],
        backstory: str
    ) -> dict[str, str | list[str]]:
        """Run all survey questions against a single backstory."""
        results: dict[str, str | list[str]] = {}

        for q_data in questions:
            question = Question(
                qkey=q_data["qkey"],
                type=q_data["type"],
                text=q_data["text"],
                options=q_data.get("options")
            )
            results[question.qkey] = self.run_question(question, backstory)

        return results
