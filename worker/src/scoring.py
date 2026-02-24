"""
Distribution-based backstory scoring and Hungarian matching.

Mirrors the TypeScript implementation in frontend/src/lib/backstoryScoring.ts
and frontend/src/lib/hungarianMatching.ts.
"""
from typing import Dict, List, Optional, Tuple
from itertools import product as cartesian_product
import math
import random

try:
    from scipy.optimize import linear_sum_assignment
except ImportError:
    linear_sum_assignment = None  # type: ignore[assignment]

# Type aliases
Demographics = Dict[str, Dict]  # { "c_age": { "value": "18-24", "distribution": {...} }, ... }
DemographicFilter = Dict[str, list]  # { "c_age": ["18-24", "25-34"], ... }


# ---------- Scoring ----------

def score_backstory(
    demographics: Demographics,
    filters: DemographicFilter,
) -> float:
    """
    Score a backstory against a demographic filter using joint probability.

    For each dimension, sums the distribution probabilities for selected categories.
    Multiplies across dimensions. Returns 1.0 for empty filters, 0 if any dimension
    is missing or has zero summed probability.
    """
    score = 1.0

    for key, filter_value in filters.items():
        if key == "_sample_size":
            continue
        if not filter_value or not isinstance(filter_value, list) or len(filter_value) == 0:
            continue
        if key.startswith("custom_"):
            continue

        dim = demographics.get(key)
        if not dim or not isinstance(dim, dict) or "distribution" not in dim:
            return 0.0

        dist = dim["distribution"]
        dim_score = sum(dist.get(cat, 0.0) for cat in filter_value)
        score *= dim_score

    return score


def score_backstory_one_hot(
    demographics: Demographics,
    target: Dict[str, str],
) -> float:
    """
    Score a backstory against a one-hot target (single category per dimension).
    """
    score = 1.0
    for key, category in target.items():
        dim = demographics.get(key)
        if not dim or not isinstance(dim, dict) or "distribution" not in dim:
            return 0.0
        score *= dim["distribution"].get(category, 0.0)
    return score


def rank_and_select_backstories(
    backstories: List[Dict],
    filters: DemographicFilter,
    top_k: Optional[int] = None,
) -> List[Dict]:
    """
    Score backstories, exclude zeros, sort descending, return top K.

    Returns list of {"id": str, "score": float}.
    """
    scored = []
    for b in backstories:
        s = score_backstory(b.get("demographics", {}), filters)
        if s > 0:
            scored.append({"id": b["id"], "score": s})

    scored.sort(key=lambda x: x["score"], reverse=True)

    if top_k is not None and top_k > 0:
        scored = scored[:top_k]

    return scored


# ---------- Cross-product & slot allocation ----------

def compute_cross_product(
    filters: DemographicFilter,
) -> Tuple[List[str], List[Dict[str, str]]]:
    """
    Compute the cross-product of selected categories across dimensions.

    Returns (dimensions, groups) where each group is {dim_key: category}.
    """
    dimensions: List[str] = []
    value_arrays: List[List[str]] = []

    for key, val in filters.items():
        if key == "_sample_size":
            continue
        if key.startswith("custom_"):
            continue
        if not val or not isinstance(val, list) or len(val) == 0:
            continue
        dimensions.append(key)
        value_arrays.append(val)

    if not dimensions:
        return [], []

    groups = []
    for combo in cartesian_product(*value_arrays):
        group = {dimensions[i]: combo[i] for i in range(len(dimensions))}
        groups.append(group)

    return dimensions, groups


def serialize_group(group: Dict[str, str], dimensions: List[str]) -> str:
    """Serialize a group to a pipe-delimited key."""
    return "|".join(group[d] for d in dimensions)


def deserialize_group(key: str, dimensions: List[str]) -> Dict[str, str]:
    """Deserialize a pipe-delimited group key."""
    values = key.split("|")
    return {dimensions[i]: values[i] for i in range(len(dimensions))}


def uniform_slot_allocation(k: int, num_groups: int) -> List[int]:
    """
    Distribute K slots uniformly across num_groups groups.
    Remainder goes to first groups.
    """
    if num_groups == 0:
        return []
    base = k // num_groups
    remainder = k % num_groups
    return [base + 1 if i < remainder else base for i in range(num_groups)]


def default_slot_allocation(
    groups: List[Dict[str, str]],
    dimensions: List[str],
    k: int,
) -> Dict[str, int]:
    """Create a default (uniform) slot allocation map."""
    counts = uniform_slot_allocation(k, len(groups))
    return {
        serialize_group(groups[i], dimensions): counts[i]
        for i in range(len(groups))
    }


# ---------- Hungarian matching ----------

def expand_slots(
    slot_allocation: Dict[str, int],
    dimensions: List[str],
) -> List[Dict[str, str]]:
    """Expand slot allocation into target vectors."""
    targets = []
    for key, count in slot_allocation.items():
        group = deserialize_group(key, dimensions)
        for _ in range(count):
            targets.append(dict(group))
    return targets


def build_cost_matrix(
    targets: List[Dict[str, str]],
    backstories: List[Dict],
) -> List[List[float]]:
    """Build K × M cost matrix."""
    return [
        [score_backstory_one_hot(b.get("demographics", {}), target) for b in backstories]
        for target in targets
    ]


def hungarian_match(
    slot_allocation: Dict[str, int],
    dimensions: List[str],
    backstories: List[Dict],
) -> List[Dict]:
    """
    Run Hungarian matching to assign backstories to slots optimally.

    Returns list of {"backstory_id": str, "group": str, "score": float}.
    Requires scipy for linear_sum_assignment.
    """
    if linear_sum_assignment is None:
        raise ImportError("scipy is required for Hungarian matching")

    targets = expand_slots(slot_allocation, dimensions)
    k = len(targets)
    m = len(backstories)

    if k == 0 or m == 0:
        return []

    cost_matrix = build_cost_matrix(targets, backstories)

    # scipy minimizes cost. We want to maximize score.
    # Negate the scores.
    max_val = max(max(row) for row in cost_matrix) if cost_matrix else 0
    negated = [
        [max_val - val for val in row]
        for row in cost_matrix
    ]

    # Pad if K > M (more slots than backstories)
    if k > m:
        for row in negated:
            row.extend([max_val] * (k - m))

    row_ind, col_ind = linear_sum_assignment(negated)

    results = []
    used = set()

    for slot_idx, backstory_idx in zip(row_ind, col_ind):
        if backstory_idx >= m:
            continue  # dummy column
        if slot_idx >= k:
            continue

        bid = backstories[backstory_idx]["id"]
        if bid in used:
            continue

        used.add(bid)
        target = targets[slot_idx]
        group_key = serialize_group(target, dimensions)

        results.append({
            "backstory_id": bid,
            "group": group_key,
            "score": cost_matrix[slot_idx][backstory_idx],
        })

    return results


# ---------- High-level selection ----------

def select_backstory_ids(
    config: Dict,
    backstories: List[Dict],
) -> List[str]:
    """
    Select backstory IDs based on a DemographicSelectionConfig.

    Args:
        config: {
            "mode": "top_k" | "balanced",
            "sample_size": int,
            "filters": DemographicFilter,
            "slot_allocation": optional dict,
            "dimensions": optional list,
        }
        backstories: List of {"id": str, "demographics": Demographics}

    Returns:
        List of selected backstory IDs.
    """
    mode = config.get("mode", "top_k")
    sample_size = config.get("sample_size", 0)
    filters = config.get("filters", {})

    # Apply custom_ filters first (exact match)
    custom_entries = {
        k: v for k, v in filters.items()
        if k.startswith("custom_") and isinstance(v, list) and len(v) > 0
    }

    if custom_entries:
        filtered = []
        for b in backstories:
            demos = b.get("demographics", {})
            match = True
            for key, vals in custom_entries.items():
                demo_key = key.replace("custom_", "")
                dim = demos.get(demo_key)
                if not dim or dim.get("value") not in vals:
                    match = False
                    break
            if match:
                filtered.append(b)
        backstories = filtered

    if mode == "top_k":
        if not filters:
            pool = backstories if sample_size <= 0 else random.sample(backstories, min(sample_size, len(backstories)))
            return [b["id"] for b in pool]
        scored = rank_and_select_backstories(backstories, filters, sample_size)
        return [s["id"] for s in scored]

    # Balanced matching
    dimensions, groups = compute_cross_product(filters)

    if not groups:
        pool = backstories if sample_size <= 0 else random.sample(backstories, min(sample_size, len(backstories)))
        return [b["id"] for b in pool]

    slot_allocation = config.get("slot_allocation")
    if not slot_allocation:
        slot_allocation = default_slot_allocation(groups, dimensions, sample_size)

    results = hungarian_match(slot_allocation, dimensions, backstories)
    return [r["backstory_id"] for r in results]
