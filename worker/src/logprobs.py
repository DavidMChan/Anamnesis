"""
Logprobs parsing utilities for demographic survey logprobs mode.

Instead of sampling N times (n_sample mode), logprobs mode asks once with
logprobs=True and computes the probability distribution directly from the
LLM's token log-probabilities. Follows Anthology's demographic_logprob_parser().
"""
import logging
from dataclasses import dataclass
from math import exp
from typing import Dict

logger = logging.getLogger(__name__)


@dataclass
class LogprobsResult:
    """Result of a logprobs LLM call."""
    generated_token: str
    top_logprobs: Dict[str, float]  # token -> log-probability


def parse_logprobs_to_distribution(
    top_logprobs: Dict[str, float],
    num_options: int,
) -> Dict[str, float]:
    """
    Convert raw top-logprobs dict into a normalized probability distribution
    over option letters A, B, C, ... following Anthology's approach.

    Handles token variants:
    - "A"   — plain letter
    - "(A"  — parenthesized (common in BPE tokenizers)
    - " A"  — space-prefixed (common in BPE tokenizers)

    Args:
        top_logprobs: token -> log-probability mapping from the LLM response
        num_options: number of MCQ options (determines valid letters A..Z)

    Returns:
        Letter-keyed normalized probability distribution, e.g. {"A": 0.72, "B": 0.25, "C": 0.03}
        Probabilities sum to 1.0 (rounded to 4 decimal places).
        If no matching tokens found, returns uniform distribution with a warning.
    """
    valid_letters = {chr(65 + i) for i in range(num_options)}
    result: Dict[str, float] = {chr(65 + i): 0.0 for i in range(num_options)}

    for token, logprob in top_logprobs.items():
        # Normalize token: strip leading whitespace (common in BPE tokenizers)
        t = token.strip()
        # Handle parenthesized tokens like "(A": take the last character
        if t.startswith("("):
            t = t[-1] if len(t) > 1 else ""
        # Only accept single-character tokens (not multi-char like "answer")
        if len(t) != 1:
            continue
        letter = t.upper()
        if letter in valid_letters:
            result[letter] += exp(logprob)

    total = sum(result.values())

    if total == 0.0:
        logger.warning(
            f"parse_logprobs_to_distribution: no matching tokens found in top_logprobs "
            f"(tokens={list(top_logprobs.keys())[:10]}). Returning uniform distribution."
        )
        uniform = round(1.0 / num_options, 4)
        return {chr(65 + i): uniform for i in range(num_options)}

    # Normalize and round
    return {letter: round(prob / total, 4) for letter, prob in result.items()}
