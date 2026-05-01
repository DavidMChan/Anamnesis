"""Bayesian stopping utilities for adaptive survey sampling."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class RankingState:
    counts: List[int]
    beta: List[float]
    posterior_means: List[float]
    ranking: List[int]
    adjacent_probs: List[float]
    error_bound: float
    confidence_lower_bound: float
    should_stop: bool


@dataclass
class AdaptiveSamplingState:
    sample_count: int
    eligible_questions: int
    confidence_lower_bound: float
    should_stop: bool
    question_states: Dict[str, RankingState]


def _beta_continued_fraction(a: float, b: float, x: float) -> float:
    max_iterations = 200
    fp_min = 1e-30
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < fp_min:
        d = fp_min
    d = 1.0 / d
    h = d

    for m in range(1, max_iterations + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < fp_min:
            d = fp_min
        c = 1.0 + aa / c
        if abs(c) < fp_min:
            c = fp_min
        d = 1.0 / d
        h *= d * c

        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < fp_min:
            d = fp_min
        c = 1.0 + aa / c
        if abs(c) < fp_min:
            c = fp_min
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 3e-14:
            break

    return h


def regularized_incomplete_beta(a: float, b: float, x: float) -> float:
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0

    bt = math.exp(
        math.lgamma(a + b)
        - math.lgamma(a)
        - math.lgamma(b)
        + a * math.log(x)
        + b * math.log(1.0 - x)
    )

    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _beta_continued_fraction(a, b, x) / a
    return 1.0 - bt * _beta_continued_fraction(b, a, 1.0 - x) / b


def pairwise_prob_greater(a: float, b: float) -> float:
    return 1.0 - regularized_incomplete_beta(a, b, 0.5)


def compute_ranking_stability(counts: List[int], epsilon: float) -> RankingState:
    beta = [count + 1.0 for count in counts]
    total = sum(beta)
    posterior_means = [value / total for value in beta]
    ranking = sorted(range(len(posterior_means)), key=lambda i: (-posterior_means[i], i))

    adjacent_probs = []
    for pos in range(len(ranking) - 1):
        adjacent_probs.append(pairwise_prob_greater(beta[ranking[pos]], beta[ranking[pos + 1]]))

    error_bound = sum(1.0 - q for q in adjacent_probs)
    confidence_lower_bound = max(0.0, 1.0 - error_bound)

    return RankingState(
        counts=counts,
        beta=beta,
        posterior_means=posterior_means,
        ranking=ranking,
        adjacent_probs=adjacent_probs,
        error_bound=error_bound,
        confidence_lower_bound=confidence_lower_bound,
        should_stop=error_bound < epsilon,
    )


def _answer_to_index(answer: Any, option_count: int) -> Optional[int]:
    if not isinstance(answer, str) or not answer:
        return None
    index = ord(answer.strip().upper()[0]) - ord("A")
    if 0 <= index < option_count:
        return index
    return None


def compute_adaptive_sampling_state(
    questions: List[Dict[str, Any]],
    results: List[Dict[str, Any]],
    epsilon: float,
    min_samples: int,
) -> Optional[AdaptiveSamplingState]:
    question_states: Dict[str, RankingState] = {}
    sample_count = len(results)

    for question in questions:
        if question.get("type") != "mcq":
            continue
        options = question.get("options") or []
        if len(options) < 2:
            continue

        qkey = question.get("qkey")
        if not qkey:
            continue

        counts = [0 for _ in options]
        for result in results:
            index = _answer_to_index(result.get(qkey), len(options))
            if index is not None:
                counts[index] += 1

        question_states[qkey] = compute_ranking_stability(counts, epsilon)

    if not question_states:
        return None

    states = list(question_states.values())
    confidence_lower_bound = min(state.confidence_lower_bound for state in states)
    return AdaptiveSamplingState(
        sample_count=sample_count,
        eligible_questions=len(states),
        confidence_lower_bound=confidence_lower_bound,
        should_stop=sample_count >= min_samples and all(state.should_stop for state in states),
        question_states=question_states,
    )
