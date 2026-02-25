"""
Unit tests for logprobs parsing utilities.
"""
import pytest
from math import exp

from src.logprobs import parse_logprobs_to_distribution


class TestParseLogprobsToDistribution:
    """Tests for parse_logprobs_to_distribution()."""

    def test_basic_distribution(self):
        """Given plain letter tokens, returns correct normalized distribution."""
        top_logprobs = {"A": -0.33, "B": -2.10, "C": -3.00}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=3)

        assert set(result.keys()) == {"A", "B", "C"}
        assert result["A"] > result["B"] > result["C"]
        # Verify normalization
        assert abs(sum(result.values()) - 1.0) < 1e-3

    def test_paren_token_handling(self):
        """Given parenthesized tokens like '(A', strips paren and maps to correct letter."""
        top_logprobs = {"(A": -0.5, "(B": -2.0}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=2)

        assert set(result.keys()) == {"A", "B"}
        assert result["A"] > result["B"]
        assert abs(sum(result.values()) - 1.0) < 1e-3

    def test_space_prefixed_tokens(self):
        """Given space-prefixed tokens like ' A', strips space and maps to correct letter."""
        top_logprobs = {" A": -0.5, " B": -2.0}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=2)

        assert set(result.keys()) == {"A", "B"}
        assert result["A"] > result["B"]
        assert abs(sum(result.values()) - 1.0) < 1e-3

    def test_accumulates_variants(self):
        """Both 'A' and '(A' tokens accumulate into A's probability."""
        top_logprobs = {"A": -1.0, "(A": -1.5}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=2)

        # A's probability should be sum of both exp values
        expected_a_raw = exp(-1.0) + exp(-1.5)
        total = expected_a_raw  # B is 0
        expected_a = expected_a_raw / total

        assert result["A"] == pytest.approx(expected_a, abs=1e-3)
        assert result["B"] == pytest.approx(0.0, abs=1e-3)

    def test_missing_options(self):
        """For 4 options, if only A and B appear in logprobs, C and D get 0.0."""
        top_logprobs = {"A": -0.5, "B": -1.0}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=4)

        assert set(result.keys()) == {"A", "B", "C", "D"}
        assert result["C"] == pytest.approx(0.0)
        assert result["D"] == pytest.approx(0.0)
        assert abs(sum(result.values()) - 1.0) < 1e-3

    def test_no_matching_tokens(self):
        """If no matching option tokens found, returns uniform distribution with warning."""
        top_logprobs = {"the": -0.5, "answer": -1.0, "is": -1.5}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=4)

        assert set(result.keys()) == {"A", "B", "C", "D"}
        # Should be uniform: each ~0.25
        for prob in result.values():
            assert prob == pytest.approx(0.25, abs=1e-3)

    def test_normalization(self):
        """Output probabilities sum to 1.0 within floating point tolerance."""
        top_logprobs = {"A": -0.1, "B": -0.5, "C": -1.0, "D": -2.0, "E": -3.0}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=5)

        assert abs(sum(result.values()) - 1.0) < 1e-3

    def test_irrelevant_tokens_ignored(self):
        """Tokens like 'the', 'answer', 'is' don't affect distribution."""
        # With irrelevant tokens mixed in
        top_logprobs = {"A": -0.5, "B": -1.5, "the": -2.0, "answer": -2.5, "is": -3.0}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=2)

        # Should only have A and B
        assert set(result.keys()) == {"A", "B"}
        # Irrelevant tokens should not have contributed
        expected_a_raw = exp(-0.5)
        expected_b_raw = exp(-1.5)
        total = expected_a_raw + expected_b_raw
        assert result["A"] == pytest.approx(expected_a_raw / total, abs=1e-3)
        assert result["B"] == pytest.approx(expected_b_raw / total, abs=1e-3)

    def test_lowercase_tokens_handled(self):
        """Lowercase letters like 'a', 'b' are normalized to uppercase."""
        top_logprobs = {"a": -0.5, "b": -1.5}
        result = parse_logprobs_to_distribution(top_logprobs, num_options=2)

        assert set(result.keys()) == {"A", "B"}
        assert result["A"] > result["B"]
