"""
Tests for distribution-based backstory scoring and Hungarian matching.

Mirrors TypeScript tests in frontend/tests/backstoryScoring.test.ts
and frontend/tests/hungarianMatching.test.ts.
"""
import pytest
from src.scoring import (
    score_backstory,
    rank_and_select_backstories,
    compute_cross_product,
    uniform_slot_allocation,
    expand_slots,
    build_cost_matrix,
    hungarian_match,
    serialize_group,
    default_slot_allocation,
    select_backstory_ids,
)

# ---------- Test data ----------

DEMO_A = {
    "c_age": {"value": "18-24", "distribution": {"18-24": 0.8, "25-34": 0.15, "35-44": 0.05}},
    "c_gender": {"value": "male", "distribution": {"male": 0.9, "female": 0.1}},
    "c_region": {"value": "NE", "distribution": {"NE": 0.7, "MW": 0.2, "S": 0.05, "W": 0.05}},
}

DEMO_B = {
    "c_age": {"value": "25-34", "distribution": {"18-24": 0.1, "25-34": 0.7, "35-44": 0.2}},
    "c_gender": {"value": "male", "distribution": {"male": 0.8, "female": 0.2}},
    "c_region": {"value": "MW", "distribution": {"NE": 0.1, "MW": 0.6, "S": 0.2, "W": 0.1}},
}

DEMO_C = {
    "c_age": {"value": "35-44", "distribution": {"18-24": 0.0, "25-34": 0.3, "35-44": 0.7}},
    "c_gender": {"value": "female", "distribution": {"male": 0.4, "female": 0.6}},
}

BACKSTORIES = [
    {"id": "a", "demographics": DEMO_A},
    {"id": "b", "demographics": DEMO_B},
    {"id": "c", "demographics": DEMO_C},
]


def _make_backstory(bid, demos):
    demographics = {}
    for key, dist in demos.items():
        top = max(dist.items(), key=lambda x: x[1])
        demographics[key] = {"value": top[0], "distribution": dist}
    return {"id": bid, "demographics": demographics}


BACKSTORIES_6 = [
    _make_backstory("a", {"c_age": {"18-24": 0.8, "25-34": 0.15, "35-44": 0.05}, "c_gender": {"male": 0.9, "female": 0.1}}),
    _make_backstory("b", {"c_age": {"18-24": 0.1, "25-34": 0.7, "35-44": 0.2}, "c_gender": {"male": 0.8, "female": 0.2}}),
    _make_backstory("c", {"c_age": {"18-24": 0.05, "25-34": 0.25, "35-44": 0.7}, "c_gender": {"male": 0.3, "female": 0.7}}),
    _make_backstory("d", {"c_age": {"18-24": 0.7, "25-34": 0.2, "35-44": 0.1}, "c_gender": {"male": 0.15, "female": 0.85}}),
    _make_backstory("e", {"c_age": {"18-24": 0.6, "25-34": 0.3, "35-44": 0.1}, "c_gender": {"male": 0.95, "female": 0.05}}),
    _make_backstory("f", {"c_age": {"18-24": 0.05, "25-34": 0.8, "35-44": 0.15}, "c_gender": {"male": 0.1, "female": 0.9}}),
]


# ---------- score_backstory ----------

class TestScoreBackstory:
    def test_returns_1_for_empty_filter(self):
        assert score_backstory(DEMO_A, {}) == 1.0

    def test_single_dim_single_cat(self):
        assert score_backstory(DEMO_A, {"c_age": ["18-24"]}) == pytest.approx(0.8)

    def test_single_dim_multiple_cats(self):
        # 0.8 + 0.15 = 0.95
        assert score_backstory(DEMO_A, {"c_age": ["18-24", "25-34"]}) == pytest.approx(0.95)

    def test_multiple_dims(self):
        # 0.8 * 0.9 = 0.72
        assert score_backstory(DEMO_A, {"c_age": ["18-24"], "c_gender": ["male"]}) == pytest.approx(0.72)

    def test_zero_probability_category(self):
        # DEMO_C has 18-24 = 0.0
        assert score_backstory(DEMO_C, {"c_age": ["18-24"]}) == 0.0

    def test_missing_dimension(self):
        # DEMO_C has no c_region
        assert score_backstory(DEMO_C, {"c_region": ["NE"]}) == 0.0

    def test_ignores_sample_size(self):
        assert score_backstory(DEMO_A, {"_sample_size": [10], "c_age": ["18-24"]}) == pytest.approx(0.8)

    def test_ignores_empty_and_undefined(self):
        # Only c_region matters
        assert score_backstory(DEMO_A, {"c_age": [], "c_gender": None, "c_region": ["NE"]}) == pytest.approx(0.7)


# ---------- rank_and_select_backstories ----------

class TestRankAndSelect:
    def test_sorted_descending(self):
        result = rank_and_select_backstories(BACKSTORIES, {"c_age": ["18-24"]})
        # a: 0.8, b: 0.1, c: 0.0 (excluded)
        assert len(result) == 2
        assert result[0]["id"] == "a"
        assert result[1]["id"] == "b"
        assert result[0]["score"] > result[1]["score"]

    def test_respects_top_k(self):
        result = rank_and_select_backstories(BACKSTORIES, {"c_age": ["18-24", "25-34"]}, top_k=1)
        assert len(result) == 1
        assert result[0]["id"] == "a"

    def test_excludes_zero_score(self):
        result = rank_and_select_backstories(BACKSTORIES, {"c_age": ["18-24"]})
        ids = [r["id"] for r in result]
        assert "c" not in ids


# ---------- compute_cross_product ----------

class TestComputeCrossProduct:
    def test_two_dim_cross_product(self):
        dims, groups = compute_cross_product({"c_age": ["18-24", "25-34"], "c_gender": ["male"]})
        assert dims == ["c_age", "c_gender"]
        assert len(groups) == 2
        assert {"c_age": "18-24", "c_gender": "male"} in groups
        assert {"c_age": "25-34", "c_gender": "male"} in groups

    def test_larger_cross_product(self):
        dims, groups = compute_cross_product({"c_age": ["18-24", "25-34"], "c_region": ["NE", "MW"]})
        assert len(groups) == 4

    def test_skips_special_keys(self):
        dims, groups = compute_cross_product({
            "_sample_size": [10],
            "custom_occupation": ["engineer"],
            "c_age": ["18-24"],
        })
        assert dims == ["c_age"]
        assert len(groups) == 1


# ---------- uniform_slot_allocation ----------

class TestUniformSlotAllocation:
    def test_10_across_3(self):
        assert uniform_slot_allocation(10, 3) == [4, 3, 3]

    def test_10_across_4(self):
        assert uniform_slot_allocation(10, 4) == [3, 3, 2, 2]

    def test_even_distribution(self):
        assert uniform_slot_allocation(6, 3) == [2, 2, 2]

    def test_zero_groups(self):
        assert uniform_slot_allocation(10, 0) == []


# ---------- expand_slots ----------

class TestExpandSlots:
    def test_correct_target_vectors(self):
        targets = expand_slots({"18-24|male": 2, "25-34|male": 1}, ["c_age", "c_gender"])
        assert len(targets) == 3
        group1 = [t for t in targets if t["c_age"] == "18-24" and t["c_gender"] == "male"]
        group2 = [t for t in targets if t["c_age"] == "25-34" and t["c_gender"] == "male"]
        assert len(group1) == 2
        assert len(group2) == 1


# ---------- build_cost_matrix ----------

class TestBuildCostMatrix:
    def test_correct_values(self):
        targets = expand_slots({"18-24|male": 1}, ["c_age", "c_gender"])
        matrix = build_cost_matrix(targets, BACKSTORIES_6[:2])
        assert len(matrix) == 1
        assert len(matrix[0]) == 2
        # a: 0.8 * 0.9 = 0.72
        assert matrix[0][0] == pytest.approx(0.72)
        # b: 0.1 * 0.8 = 0.08
        assert matrix[0][1] == pytest.approx(0.08)


# ---------- hungarian_match ----------

class TestHungarianMatch:
    def test_no_duplicates(self):
        dims, groups = compute_cross_product({"c_age": ["18-24", "25-34"], "c_gender": ["male"]})
        alloc = default_slot_allocation(groups, dims, 4)
        results = hungarian_match(alloc, dims, BACKSTORIES_6)
        ids = [r["backstory_id"] for r in results]
        assert len(set(ids)) == len(ids)

    def test_balanced_result(self):
        dims, groups = compute_cross_product({"c_age": ["18-24", "25-34"], "c_gender": ["male"]})
        alloc = default_slot_allocation(groups, dims, 4)
        results = hungarian_match(alloc, dims, BACKSTORIES_6)
        assert len(results) == 4
        g1 = [r for r in results if r["group"] == "18-24|male"]
        g2 = [r for r in results if r["group"] == "25-34|male"]
        assert len(g1) == 2
        assert len(g2) == 2
        # No overlap
        ids1 = set(r["backstory_id"] for r in g1)
        ids2 = set(r["backstory_id"] for r in g2)
        assert ids1.isdisjoint(ids2)

    def test_k_greater_than_m(self):
        results = hungarian_match({"18-24": 10}, ["c_age"], BACKSTORIES_6)
        assert len(results) <= 6
        ids = [r["backstory_id"] for r in results]
        assert len(set(ids)) == len(ids)

    def test_single_group_top_k(self):
        results = hungarian_match({"18-24": 3}, ["c_age"], BACKSTORIES_6)
        assert len(results) == 3
        ids = set(r["backstory_id"] for r in results)
        # a: 0.8, d: 0.7, e: 0.6 — top 3
        assert "a" in ids
        assert "d" in ids
        assert "e" in ids


# ---------- Python matches TypeScript ----------

class TestPythonMatchesTypeScript:
    """Verify Python scoring produces identical results to TypeScript for same inputs."""

    def test_score_matches_ts(self):
        """score_backstory returns same values as TypeScript scoreBackstory."""
        # Single dim, single cat
        assert score_backstory(DEMO_A, {"c_age": ["18-24"]}) == pytest.approx(0.8)
        # Multi dim
        assert score_backstory(DEMO_A, {"c_age": ["18-24"], "c_gender": ["male"]}) == pytest.approx(0.72)
        # Multi cat
        assert score_backstory(DEMO_A, {"c_age": ["18-24", "25-34"]}) == pytest.approx(0.95)
        # Zero
        assert score_backstory(DEMO_C, {"c_age": ["18-24"]}) == 0.0

    def test_hungarian_matches_ts(self):
        """Hungarian matching produces same assignments as TypeScript."""
        # Single group, 3 slots — should pick top 3 by probability
        results = hungarian_match({"18-24": 3}, ["c_age"], BACKSTORIES_6)
        ids = set(r["backstory_id"] for r in results)
        assert ids == {"a", "d", "e"}


# ---------- select_backstory_ids ----------

class TestSelectBackstoryIds:
    def test_top_k_mode(self):
        config = {
            "mode": "top_k",
            "sample_size": 2,
            "filters": {"c_age": ["18-24"]},
        }
        ids = select_backstory_ids(config, BACKSTORIES)
        assert len(ids) == 2
        assert ids[0] == "a"  # highest score

    def test_balanced_mode(self):
        config = {
            "mode": "balanced",
            "sample_size": 4,
            "filters": {"c_age": ["18-24", "25-34"], "c_gender": ["male"]},
        }
        ids = select_backstory_ids(config, BACKSTORIES_6)
        assert len(ids) == 4
        assert len(set(ids)) == 4  # no duplicates
