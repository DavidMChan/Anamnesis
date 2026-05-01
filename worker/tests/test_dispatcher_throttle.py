"""
Tests for dispatcher throttled dispatch and DB helpers.

Covers:
- get_in_flight_count() returns correct count
- get_pending_tasks_for_dispatch() accepts optional limit
- dispatch_run() reads max_concurrent_tasks from run's llm_config
- dispatch_run() dispatches at most (max_concurrent - in_flight) tasks
- dispatch_run() defaults to 10 when max_concurrent_tasks is not in llm_config
- dispatch_run() dispatches 0 tasks when in_flight >= max_concurrent
"""
import uuid
from unittest.mock import Mock, MagicMock, patch, call

import pytest

from src.dispatcher import TaskDispatcher


def make_run(llm_config=None, status="pending"):
    """Create a mock survey run dict."""
    return {
        "id": str(uuid.uuid4()),
        "status": status,
        "llm_config": llm_config or {},
        "completed_tasks": 0,
        "total_tasks": 100,
    }


def make_task():
    """Create a mock task dict."""
    return {
        "id": str(uuid.uuid4()),
        "backstory_id": str(uuid.uuid4()),
    }


@pytest.fixture
def mock_db():
    """Mock database client."""
    db = Mock()
    db.get_in_flight_count.return_value = 0
    db.reset_stale_tasks.return_value = 0
    db.get_pending_tasks_for_dispatch.return_value = []
    db.mark_task_queued.return_value = None
    db.update_task_status.return_value = None
    db.update_run_status.return_value = None
    db.check_run_completion.return_value = None
    db.get_completed_results_for_run.return_value = []
    db.get_survey_questions.return_value = []
    db.complete_run_early.return_value = None
    return db


@pytest.fixture
def mock_publisher():
    """Mock queue publisher."""
    publisher = Mock()
    publisher.publish_task.return_value = None
    return publisher


@pytest.fixture
def dispatcher(mock_db, mock_publisher):
    """Create TaskDispatcher with mocked dependencies."""
    return TaskDispatcher(db=mock_db, publisher=mock_publisher)


class TestDispatchRunThrottling:
    """Tests for throttled dispatch_run() behavior."""

    def test_reads_max_concurrent_from_llm_config(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run reads max_concurrent_tasks from run's llm_config."""
        run = make_run(llm_config={"max_concurrent_tasks": 5})
        tasks = [make_task() for _ in range(5)]
        mock_db.get_in_flight_count.return_value = 0
        mock_db.get_pending_tasks_for_dispatch.return_value = tasks

        dispatched = dispatcher.dispatch_run(run)

        assert dispatched == 5
        # Should have been called with limit=5
        mock_db.get_pending_tasks_for_dispatch.assert_called_once_with(
            run["id"], limit=5
        )

    def test_defaults_to_10_when_not_in_llm_config(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run defaults to max_concurrent=10 when not in llm_config."""
        run = make_run(llm_config={})
        tasks = [make_task() for _ in range(10)]
        mock_db.get_in_flight_count.return_value = 0
        mock_db.get_pending_tasks_for_dispatch.return_value = tasks

        dispatched = dispatcher.dispatch_run(run)

        assert dispatched == 10
        mock_db.get_pending_tasks_for_dispatch.assert_called_once_with(
            run["id"], limit=10
        )

    def test_defaults_to_10_when_llm_config_is_none(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run defaults to 10 even when llm_config is None."""
        run = make_run()
        run["llm_config"] = None
        mock_db.get_in_flight_count.return_value = 0
        mock_db.get_pending_tasks_for_dispatch.return_value = [make_task()]

        dispatched = dispatcher.dispatch_run(run)

        assert dispatched == 1
        mock_db.get_pending_tasks_for_dispatch.assert_called_once_with(
            run["id"], limit=10
        )

    def test_dispatches_max_concurrent_minus_in_flight(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run dispatches at most (max_concurrent - in_flight) tasks."""
        run = make_run(llm_config={"max_concurrent_tasks": 20})
        mock_db.get_in_flight_count.return_value = 15  # 15 already in-flight
        tasks = [make_task() for _ in range(5)]  # 5 slots available
        mock_db.get_pending_tasks_for_dispatch.return_value = tasks

        dispatched = dispatcher.dispatch_run(run)

        assert dispatched == 5
        # Should request only 5 tasks (20 - 15)
        mock_db.get_pending_tasks_for_dispatch.assert_called_once_with(
            run["id"], limit=5
        )

    def test_dispatches_zero_when_in_flight_at_max(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run dispatches 0 tasks when in_flight >= max_concurrent."""
        run = make_run(llm_config={"max_concurrent_tasks": 10})
        mock_db.get_in_flight_count.return_value = 10

        dispatched = dispatcher.dispatch_run(run)

        assert dispatched == 0
        # Should not even query for pending tasks
        mock_db.get_pending_tasks_for_dispatch.assert_not_called()

    def test_dispatches_zero_when_in_flight_exceeds_max(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run dispatches 0 tasks when in_flight > max_concurrent (edge case)."""
        run = make_run(llm_config={"max_concurrent_tasks": 10})
        mock_db.get_in_flight_count.return_value = 15  # Exceeded (tasks may have been queued before config change)

        dispatched = dispatcher.dispatch_run(run)

        assert dispatched == 0
        mock_db.get_pending_tasks_for_dispatch.assert_not_called()

    def test_updates_run_status_to_running_for_pending_run(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run updates status to 'running' when dispatching for a pending run."""
        run = make_run(status="pending", llm_config={"max_concurrent_tasks": 5})
        tasks = [make_task()]
        mock_db.get_in_flight_count.return_value = 0
        mock_db.get_pending_tasks_for_dispatch.return_value = tasks

        dispatcher.dispatch_run(run)

        mock_db.update_run_status.assert_called_once_with(run["id"], "running")

    def test_does_not_update_status_for_already_running_run(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run does not call update_run_status for already-running runs."""
        run = make_run(status="running", llm_config={"max_concurrent_tasks": 5})
        tasks = [make_task()]
        mock_db.get_in_flight_count.return_value = 0
        mock_db.get_pending_tasks_for_dispatch.return_value = tasks

        dispatcher.dispatch_run(run)

        mock_db.update_run_status.assert_not_called()

    def test_marks_tasks_queued_and_publishes(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run marks tasks as queued and publishes to queue."""
        run = make_run(llm_config={"max_concurrent_tasks": 5})
        task = make_task()
        mock_db.get_in_flight_count.return_value = 0
        mock_db.get_pending_tasks_for_dispatch.return_value = [task]

        dispatched = dispatcher.dispatch_run(run)

        assert dispatched == 1
        mock_db.mark_tasks_queued.assert_called_once_with([task["id"]])
        mock_publisher.publish_task.assert_called_once_with(run["id"], task["id"])

    def test_reverts_to_pending_on_publish_failure(self, dispatcher, mock_db, mock_publisher):
        """dispatch_run reverts task to pending if publish fails."""
        run = make_run(llm_config={"max_concurrent_tasks": 5})
        task = make_task()
        mock_db.get_in_flight_count.return_value = 0
        mock_db.get_pending_tasks_for_dispatch.return_value = [task]
        mock_publisher.publish_task.side_effect = Exception("Connection lost")

        dispatched = dispatcher.dispatch_run(run)

        assert dispatched == 0
        mock_db.update_task_status.assert_called_once_with(task["id"], "pending")


class TestPollAndDispatch:
    """Tests for poll_and_dispatch with throttling."""

    def test_checks_completion_when_no_tasks_dispatched_for_running_run(
        self, dispatcher, mock_db, mock_publisher
    ):
        """When a running run has no pending tasks, check_run_completion is called."""
        run = make_run(status="running", llm_config={"max_concurrent_tasks": 10})
        mock_db.get_runs_needing_dispatch.return_value = [run]
        mock_db.get_in_flight_count.return_value = 0
        mock_db.get_pending_tasks_for_dispatch.return_value = []

        dispatcher.poll_and_dispatch()

        mock_db.check_run_completion.assert_called_once_with(run["id"])


class TestAdaptiveSampling:
    def test_skips_demographic_distribution_runs(self, dispatcher, mock_db):
        run = make_run(
            llm_config={
                "distribution_mode": "n_sample",
                "adaptive_sampling": {"enabled": True, "epsilon": 0.01, "min_samples": 2},
            },
            status="running",
        )
        run["completed_tasks"] = 50

        assert dispatcher.maybe_complete_adaptive_run(run) is False
        mock_db.get_completed_results_for_run.assert_not_called()

    def test_clamps_malformed_min_samples(self, dispatcher, mock_db):
        run = make_run(
            llm_config={
                "adaptive_sampling": {"enabled": True, "epsilon": 0.99, "min_samples": -5},
            },
            status="running",
        )
        run["completed_tasks"] = 1

        assert dispatcher.maybe_complete_adaptive_run(run) is False
        mock_db.get_completed_results_for_run.assert_not_called()

    def test_completes_stable_run(self, dispatcher, mock_db):
        run = make_run(
            llm_config={
                "adaptive_sampling": {"enabled": True, "epsilon": 0.05, "min_samples": 30},
            },
            status="running",
        )
        run["completed_tasks"] = 101
        mock_db.get_completed_results_for_run.return_value = [{"q1": "B"} for _ in range(100)] + [{"q1": "A"}]
        mock_db.get_survey_questions.return_value = [
            {"qkey": "q1", "type": "mcq", "options": ["A option", "B option"]},
        ]

        assert dispatcher.maybe_complete_adaptive_run(run) is True
        mock_db.complete_run_early.assert_called_once()
        args = mock_db.complete_run_early.call_args.args
        assert args[0] == run["id"]
        assert args[1]["sample_count"] == 101
