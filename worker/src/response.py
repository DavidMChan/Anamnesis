"""
LLM response dataclass and error hierarchy.

Extracted from llm.py to break circular imports (parser.py → llm.py)
and separate concerns: response parsing ≠ API client.
"""
import logging
import re
from dataclasses import dataclass
from typing import Optional, List

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

class MultimodalNotSupportedError(NonRetryableError):
    """Model doesn't support multimodal input (images/audio)."""


# ─── LLMResponse ─────────────────────────────────────────────────────────────

@dataclass
class LLMResponse:
    """Parsed LLM response."""
    answer: str
    reasoning: Optional[str] = None
    raw: Optional[str] = None

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
