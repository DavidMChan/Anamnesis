"""
Tests for dispatcher Ground Truth matching path (process_matching_runs).
"""
from unittest.mock import Mock

import pytest

from src.dispatcher import TaskDispatcher


def _backstory(bid, age_dist, gender_dist):
    return {
        "id": bid,
        "demographics": {
            "c_age": {"distribution": age_dist},
            "c_gender": {"distribution": gender_dist},
        },
    }


@pytest.fixture
def db():
    return Mock()


@pytest.fixture
def publisher():
    return Mock()


def test_process_matching_runs_runs_matching_and_finalizes(db, publisher):
    run_id = "run-1"
    db.get_matching_runs.return_value = [{
        "id": run_id,
        "ground_truth": {
            "mode": "per_respondent",
            "match_method": "hungarian",
            "demographic_keys": ["c_age", "c_gender"],
            "respondents": [
                {"_id": "r1", "demographics": {"c_age": "18-24", "c_gender": "male"}},
                {"_id": "r2", "demographics": {"c_age": "25-34", "c_gender": "female"}},
            ],
        },
        "created_at": "2026-05-13T00:00:00Z",
    }]
    db.fetch_backstory_pool.return_value = [
        _backstory("b1", {"18-24": 0.9, "25-34": 0.05}, {"male": 0.9, "female": 0.1}),
        _backstory("b2", {"18-24": 0.05, "25-34": 0.9}, {"male": 0.1, "female": 0.9}),
    ]

    dispatcher = TaskDispatcher(db=db, publisher=publisher)
    processed = dispatcher.process_matching_runs()

    assert processed == 1
    db.fetch_backstory_pool.assert_called_once_with(["c_age", "c_gender"])
    db.finalize_matching.assert_called_once()

    args, _ = db.finalize_matching.call_args
    finalized_run_id, ground_truth, backstory_ids = args
    assert finalized_run_id == run_id
    assert set(backstory_ids) == {"b1", "b2"}
    assert ground_truth["matches"]
    assert ground_truth["stats"]["matched"] == 2
    # Best score should be > 0
    assert ground_truth["stats"]["max_score"] > 0


def test_process_matching_runs_fails_run_on_empty_pool(db, publisher):
    run_id = "run-2"
    db.get_matching_runs.return_value = [{
        "id": run_id,
        "ground_truth": {
            "mode": "per_respondent",
            "match_method": "hungarian",
            "demographic_keys": ["c_age"],
            "respondents": [
                {"_id": "r1", "demographics": {"c_age": "18-24"}},
            ],
        },
    }]
    db.fetch_backstory_pool.return_value = []

    dispatcher = TaskDispatcher(db=db, publisher=publisher)
    processed = dispatcher.process_matching_runs()

    assert processed == 1
    db.finalize_matching.assert_not_called()
    db.fail_matching.assert_called_once()
    args, _ = db.fail_matching.call_args
    assert args[0] == run_id
    assert "pool" in args[1].lower()


def test_process_matching_runs_expands_aggregate_mode(db, publisher):
    run_id = "run-3"
    db.get_matching_runs.return_value = [{
        "id": run_id,
        "ground_truth": {
            "mode": "aggregate",
            "match_method": "hungarian",
            "demographic_keys": ["c_age", "c_gender"],
            "respondents": [
                {"_id": "g1", "_count": 2,
                 "demographics": {"c_age": "18-24", "c_gender": "male"}},
            ],
        },
    }]
    db.fetch_backstory_pool.return_value = [
        _backstory("b1", {"18-24": 0.9}, {"male": 0.9}),
        _backstory("b2", {"18-24": 0.5}, {"male": 0.5}),
    ]

    dispatcher = TaskDispatcher(db=db, publisher=publisher)
    dispatcher.process_matching_runs()

    args, _ = db.finalize_matching.call_args
    _, ground_truth, backstory_ids = args
    assert len(backstory_ids) == 2  # expanded from _count=2
    assert {m["_id"] for m in ground_truth["matches"]} == {"g1::0", "g1::1"}


def test_process_matching_runs_returns_zero_when_no_matching_runs(db, publisher):
    db.get_matching_runs.return_value = []
    dispatcher = TaskDispatcher(db=db, publisher=publisher)
    assert dispatcher.process_matching_runs() == 0


def test_poll_and_dispatch_invokes_matching_then_pending(db, publisher):
    db.get_matching_runs.return_value = []
    db.get_runs_needing_dispatch.return_value = []

    dispatcher = TaskDispatcher(db=db, publisher=publisher)
    dispatcher.poll_and_dispatch()
    db.get_matching_runs.assert_called_once()
    db.get_runs_needing_dispatch.assert_called_once()
