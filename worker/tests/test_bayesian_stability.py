"""
Unit tests for adaptive sampling Bayesian stability utilities.
"""
import pytest

from src.bayesian_stability import (
    compute_adaptive_sampling_state,
    compute_ranking_stability,
    pairwise_prob_greater,
    regularized_incomplete_beta,
)


class TestBayesianStability:
    def test_symmetric_beta_values(self):
        assert regularized_incomplete_beta(2, 2, 0.5) == pytest.approx(0.5)
        assert pairwise_prob_greater(4, 4) == pytest.approx(0.5)

    def test_stops_for_clear_ranking(self):
        state = compute_ranking_stability([1, 100], 0.05)

        assert state.ranking == [1, 0]
        assert state.should_stop is True
        assert state.confidence_lower_bound > 0.95

    def test_adaptive_state_counts_one_result_per_task(self):
        questions = [
            {"qkey": "q1", "type": "mcq", "options": ["A option", "B option"]},
        ]
        results = [{"q1": "B"} for _ in range(100)] + [{"q1": "A"}]

        state = compute_adaptive_sampling_state(questions, results, epsilon=0.05, min_samples=30)

        assert state is not None
        assert state.sample_count == 101
        assert state.should_stop is True
