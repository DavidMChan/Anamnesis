"""Tests for src.matcher (Ground Truth matching)."""
import pytest

from src.matcher import (
    _build_edge_weight,
    expand_aggregate_respondents,
    run_matching,
)


def _bs(bid, dist_a, dist_g):
    return {
        "id": bid,
        "demographics": {
            "c_age": {"distribution": dist_a},
            "c_gender": {"distribution": dist_g},
        },
    }


def _r(rid, age, gender):
    demo = {}
    if age is not None:
        demo["c_age"] = age
    if gender is not None:
        demo["c_gender"] = gender
    return {"_id": rid, "demographics": demo}


def test_edge_weight_product_across_traits():
    bs = [
        _bs("b1", {"18-24": 0.8, "25-34": 0.2}, {"male": 0.9, "female": 0.1}),
        _bs("b2", {"18-24": 0.1, "25-34": 0.9}, {"male": 0.3, "female": 0.7}),
    ]
    resp = [_r("r1", "18-24", "male")]
    edge = _build_edge_weight(resp, bs)
    # b1: 0.8 * 0.9 = 0.72;  b2: 0.1 * 0.3 = 0.03
    assert edge[0, 0] == pytest.approx(0.72)
    assert edge[0, 1] == pytest.approx(0.03)


def test_dropped_dimension_treated_as_factor_one():
    bs = [
        _bs("b1", {"18-24": 0.8}, {"male": 0.9, "female": 0.1}),
        _bs("b2", {"18-24": 0.1}, {"male": 0.3, "female": 0.7}),
    ]
    # Refused age -> only gender contributes
    resp = [_r("r1", None, "male")]
    edge = _build_edge_weight(resp, bs)
    assert edge[0, 0] == pytest.approx(0.9)
    assert edge[0, 1] == pytest.approx(0.3)


def test_missing_category_yields_zero():
    bs = [_bs("b1", {"25-34": 0.8}, {"male": 0.9})]
    # respondent says age "18-24" but backstory has no probability for that
    resp = [_r("r1", "18-24", "male")]
    edge = _build_edge_weight(resp, bs)
    assert edge[0, 0] == 0.0


def test_hungarian_assigns_best_distinct_pairs():
    bs = [
        _bs("b1", {"18-24": 0.9, "25-34": 0.05}, {"male": 0.9, "female": 0.1}),
        _bs("b2", {"18-24": 0.05, "25-34": 0.9}, {"male": 0.1, "female": 0.9}),
    ]
    resp = [_r("r1", "18-24", "male"), _r("r2", "25-34", "female")]
    out = run_matching(resp, bs, method="hungarian")
    matches = {m["_id"]: m["backstory_id"] for m in out["matches"]}
    assert matches["r1"] == "b1"
    assert matches["r2"] == "b2"
    assert out["stats"]["matched"] == 2


def test_hungarian_avoids_double_assignment_even_when_greedy_would_collide():
    # Both respondents prefer b1, but Hungarian forces distinct assignments.
    bs = [
        _bs("b1", {"18-24": 0.9, "25-34": 0.85}, {"male": 0.9, "female": 0.85}),
        _bs("b2", {"18-24": 0.05, "25-34": 0.05}, {"male": 0.05, "female": 0.05}),
    ]
    resp = [_r("r1", "18-24", "male"), _r("r2", "25-34", "female")]
    out = run_matching(resp, bs, method="hungarian")
    backstory_ids = {m["backstory_id"] for m in out["matches"]}
    assert backstory_ids == {"b1", "b2"}


def test_greedy_can_assign_same_backstory_to_multiple_humans():
    bs = [
        _bs("b1", {"18-24": 0.9, "25-34": 0.85}, {"male": 0.9, "female": 0.85}),
        _bs("b2", {"18-24": 0.05, "25-34": 0.05}, {"male": 0.05, "female": 0.05}),
    ]
    resp = [_r("r1", "18-24", "male"), _r("r2", "25-34", "female")]
    out = run_matching(resp, bs, method="greedy")
    backstory_ids = [m["backstory_id"] for m in out["matches"]]
    assert backstory_ids == ["b1", "b1"]


def test_random_seed_reproducible():
    bs = [_bs(f"b{i}", {"a": 1.0}, {"x": 1.0}) for i in range(5)]
    resp = [_r(f"r{i}", "a", "x") for i in range(3)]
    a = run_matching(resp, bs, method="random", seed=42)
    b = run_matching(resp, bs, method="random", seed=42)
    assert [m["backstory_id"] for m in a["matches"]] == [m["backstory_id"] for m in b["matches"]]


def test_random_distinct_assignments():
    bs = [_bs(f"b{i}", {"a": 1.0}, {"x": 1.0}) for i in range(5)]
    resp = [_r(f"r{i}", "a", "x") for i in range(3)]
    out = run_matching(resp, bs, method="random", seed=1)
    backstory_ids = [m["backstory_id"] for m in out["matches"]]
    assert len(set(backstory_ids)) == len(backstory_ids)


def test_stats_populated():
    bs = [
        _bs("b1", {"18-24": 0.9}, {"male": 0.9}),
        _bs("b2", {"18-24": 0.1}, {"male": 0.1}),
    ]
    resp = [_r("r1", "18-24", "male"), _r("r2", "18-24", "male")]
    out = run_matching(resp, bs, method="hungarian")
    stats = out["stats"]
    assert stats["n_respondents"] == 2
    assert stats["pool_size"] == 2
    assert stats["max_score"] >= stats["min_score"]
    assert 0.0 <= stats["mean_score"] <= 1.0


def test_expand_aggregate_respondents():
    rows = [
        {"_id": "g1", "_count": 3, "demographics": {"c_age": "18-24"}},
        {"_id": "g2", "_count": 1, "demographics": {"c_age": "25-34"}},
    ]
    expanded = expand_aggregate_respondents(rows)
    ids = [r["_id"] for r in expanded]
    assert ids == ["g1::0", "g1::1", "g1::2", "g2"]


def test_empty_respondents_raises():
    with pytest.raises(ValueError):
        run_matching([], [_bs("b1", {"a": 1.0}, {"x": 1.0})], method="hungarian")


def test_empty_backstories_raises():
    with pytest.raises(ValueError):
        run_matching([_r("r1", "a", "x")], [], method="hungarian")
