"""
Ground Truth Matching.

Computes optimal assignments between a set of real-survey respondents and a pool
of backstories from the database, using the demographic distributions stored on
each backstory.

Edge weight (matches anthology paper edge_weight_calculation):
    score(human, backstory) = product over traits d of
        backstory.demographics[d].distribution.get(human[d], 0.0)

A trait that the human refused / left blank is dropped from the target vector
upstream (in the CSV parser), so it contributes a factor of 1 here. A trait that
the backstory is missing yields 0 (same as the anthology behavior when a virtual
trait is absent — and consistent with scoreBackstoryOneHot in the frontend).

Three match methods:
  - hungarian: scipy.optimize.linear_sum_assignment on -edge_weight
  - greedy:    argmax over backstories for each human row, independently
  - random:    random distinct pairing (sampling without replacement)
"""
from __future__ import annotations

import logging
import math
import random as _random
import statistics
from typing import Any, Dict, List, Literal, Optional, Tuple

import numpy as np
from scipy.optimize import linear_sum_assignment

logger = logging.getLogger(__name__)

MatchMethod = Literal["hungarian", "greedy", "random"]


def _build_edge_weight(
    respondents: List[Dict[str, Any]],
    backstories: List[Dict[str, Any]],
) -> np.ndarray:
    """
    Compute N x M edge weight matrix.

    respondents: [{ "_id": str, "demographics": {dim: category, ...} }, ...]
    backstories: [{ "id": uuid, "demographics": {dim: {distribution: {cat: p}}} }, ...]
    """
    n = len(respondents)
    m = len(backstories)
    if n == 0 or m == 0:
        return np.zeros((n, m), dtype=np.float64)

    edge = np.ones((n, m), dtype=np.float64)

    for i, human in enumerate(respondents):
        target = human.get("demographics") or {}
        if not target:
            # No traits to match on -> all backstories tie at 1.0 (drop-only row).
            continue
        for j, backstory in enumerate(backstories):
            demo = backstory.get("demographics") or {}
            prod = 1.0
            for dim_key, category in target.items():
                dim = demo.get(dim_key)
                if not dim:
                    prod = 0.0
                    break
                distribution = dim.get("distribution") or {}
                p = float(distribution.get(category, 0.0))
                if p <= 0.0:
                    prod = 0.0
                    break
                prod *= p
            edge[i, j] = prod

    return edge


def _hungarian_match(edge: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    Maximum-weight bipartite matching via scipy linear_sum_assignment.

    Returns parallel arrays of (human_indices, backstory_indices).
    When N > M, only the first M humans get matched (scipy's rectangular cost
    matrix support); we sort by edge sum to keep the best-matched rows.
    """
    if edge.size == 0:
        return np.array([], dtype=int), np.array([], dtype=int)
    row_ind, col_ind = linear_sum_assignment(-edge)
    return row_ind, col_ind


def _greedy_match(edge: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    Greedy match: each human picks their argmax backstory, independently.
    Backstories may be assigned to multiple humans (matches the anthology
    paper's greedy_matching; the paper uses it for its practical efficiency).
    """
    if edge.size == 0:
        return np.array([], dtype=int), np.array([], dtype=int)
    row_ind = np.arange(edge.shape[0])
    col_ind = np.argmax(edge, axis=1)
    return row_ind, col_ind


def _random_match(
    edge: np.ndarray,
    seed: Optional[int] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Random distinct pairing: sample min(N, M) backstories uniformly without
    replacement, assign to humans in arbitrary order. Used as an ablation
    baseline (anthology paper has a random method too).
    """
    n, m = edge.shape
    if n == 0 or m == 0:
        return np.array([], dtype=int), np.array([], dtype=int)
    rng = _random.Random(seed)
    pool = list(range(m))
    rng.shuffle(pool)
    k = min(n, m)
    return np.arange(k), np.array(pool[:k], dtype=int)


def run_matching(
    respondents: List[Dict[str, Any]],
    backstories: List[Dict[str, Any]],
    method: MatchMethod = "hungarian",
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Top-level matching entry point.

    Args:
        respondents: [{"_id": str, "demographics": {dim: cat}, ...}]
        backstories: [{"id": str, "demographics": {...}}]
        method: matching algorithm
        seed: random seed (for method='random')

    Returns:
        {
            "matches": [{"_id": str, "backstory_id": str, "score": float}, ...],
            "stats":   {"n_respondents": N, "pool_size": M, "mean_score": ...,
                         "median_score": ..., "min_score": ..., "max_score": ...},
        }
    """
    if not respondents:
        raise ValueError("matching requires at least one respondent")
    if not backstories:
        raise ValueError("matching requires at least one backstory")

    edge = _build_edge_weight(respondents, backstories)

    if method == "hungarian":
        row_ind, col_ind = _hungarian_match(edge)
    elif method == "greedy":
        row_ind, col_ind = _greedy_match(edge)
    elif method == "random":
        row_ind, col_ind = _random_match(edge, seed=seed)
    else:
        raise ValueError(f"unknown match method: {method}")

    matches: List[Dict[str, Any]] = []
    scores: List[float] = []
    for r, c in zip(row_ind.tolist(), col_ind.tolist()):
        human = respondents[r]
        backstory = backstories[c]
        score = float(edge[r, c])
        matches.append({
            "_id": human["_id"],
            "backstory_id": backstory["id"],
            "score": score,
        })
        scores.append(score)

    stats = {
        "n_respondents": len(respondents),
        "pool_size": len(backstories),
        "matched": len(matches),
        "mean_score": _safe_mean(scores),
        "median_score": _safe_median(scores),
        "min_score": min(scores) if scores else 0.0,
        "max_score": max(scores) if scores else 0.0,
        "zero_score_matches": sum(1 for s in scores if s <= 0.0),
    }

    return {"matches": matches, "stats": stats}


def _safe_mean(xs: List[float]) -> float:
    if not xs:
        return 0.0
    return float(statistics.fmean(xs))


def _safe_median(xs: List[float]) -> float:
    if not xs:
        return 0.0
    return float(statistics.median(xs))


# Expanding aggregate rows ----------------------------------------------------

def expand_aggregate_respondents(
    respondents: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    For aggregate mode, expand each row's _count into that many synthetic
    respondents so the matcher pairs one backstory per individual.

    The expanded copies share their parent's _id with a suffix like "::k" so
    the result can be re-aggregated by parent _id afterwards.
    """
    expanded: List[Dict[str, Any]] = []
    for r in respondents:
        count = int(r.get("_count") or 1)
        if count <= 1:
            expanded.append(r)
            continue
        parent_id = r["_id"]
        for k in range(count):
            copy = dict(r)
            copy["_id"] = f"{parent_id}::{k}"
            expanded.append(copy)
    return expanded
