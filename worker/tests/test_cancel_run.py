"""
Tests for cancel run support in the worker.

Covers:
- get_run_status() returns correct status
- handle_message() skips tasks for cancelled/completed/failed runs
- Worker semaphore is removed (process_with_semaphore no longer exists)
- Messages go directly to handle_message() via asyncio.create_task()
- max_concurrent_tasks and prefetch_count are removed from WorkerConfig
"""
import ast
import os
import uuid
from unittest.mock import Mock, patch

import pytest

from src.config import WorkerConfig
from src.db import DatabaseClient


# ==================== Config Tests ====================


class TestWorkerConfigNoConcurrency:
    """Tests that max_concurrent_tasks and prefetch_count are removed from WorkerConfig."""

    def test_max_concurrent_tasks_removed(self):
        """max_concurrent_tasks field no longer exists on WorkerConfig."""
        config = WorkerConfig()
        assert not hasattr(config, "max_concurrent_tasks")

    def test_prefetch_count_removed(self):
        """prefetch_count field no longer exists on WorkerConfig."""
        config = WorkerConfig()
        assert not hasattr(config, "prefetch_count")


# ==================== DB Tests ====================


class TestGetRunStatus:
    """Tests for DatabaseClient.get_run_status()."""

    def test_returns_status_string(self):
        """get_run_status returns the status string from DB."""
        db = DatabaseClient.__new__(DatabaseClient)
        db.client = Mock()

        # Mock the full chain: table().select().eq().single().execute()
        mock_execute_result = Mock()
        mock_execute_result.data = {"status": "cancelled"}

        mock_single = Mock()
        mock_single.execute.return_value = mock_execute_result

        mock_eq = Mock()
        mock_eq.single.return_value = mock_single

        mock_select = Mock()
        mock_select.eq.return_value = mock_eq

        mock_table = Mock()
        mock_table.select.return_value = mock_select
        db.client.table.return_value = mock_table

        result = db.get_run_status("some-run-id")
        assert result == "cancelled"
        db.client.table.assert_called_with("survey_runs")

    def test_returns_none_when_not_found(self):
        """get_run_status returns None when run not found."""
        from postgrest.exceptions import APIError

        db = DatabaseClient.__new__(DatabaseClient)
        db.client = Mock()

        # Simulate PGRST116 error (0 rows)
        mock_single = Mock()
        mock_single.execute.side_effect = APIError({"code": "PGRST116", "message": "0 rows"})

        mock_eq = Mock()
        mock_eq.single.return_value = mock_single

        mock_select = Mock()
        mock_select.eq.return_value = mock_eq

        mock_table = Mock()
        mock_table.select.return_value = mock_select
        db.client.table.return_value = mock_table

        result = db.get_run_status("nonexistent-run-id")
        assert result is None


# ==================== Semaphore Removal Tests ====================


class TestSemaphoreRemoved:
    """Tests that verify process_with_semaphore was removed from main.py."""

    def test_process_with_semaphore_not_in_source(self):
        """process_with_semaphore function no longer exists in main.py."""
        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            source = f.read()

        assert "process_with_semaphore" not in source

    def test_semaphore_not_in_source(self):
        """asyncio.Semaphore is no longer used in main.py."""
        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            source = f.read()

        assert "Semaphore" not in source

    def test_handle_message_used_directly(self):
        """handle_message is called directly via asyncio.create_task."""
        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            source = f.read()

        assert "asyncio.create_task(handle_message(message))" in source

    def test_cancelled_run_check_in_handle_message(self):
        """handle_message checks run status before processing."""
        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            source = f.read()

        assert "get_run_status" in source
        assert '"cancelled"' in source or "'cancelled'" in source


# ==================== DB get_in_flight_count Tests ====================


class TestGetInFlightCount:
    """Tests for DatabaseClient.get_in_flight_count()."""

    def test_returns_count_of_queued_and_processing(self):
        """get_in_flight_count returns count of queued + processing tasks."""
        db = DatabaseClient.__new__(DatabaseClient)
        db.client = Mock()

        mock_result = Mock()
        mock_result.count = 15
        mock_result.data = []

        mock_query = Mock()
        mock_query.execute.return_value = mock_result

        mock_table = Mock()
        mock_table.select.return_value = Mock(
            eq=Mock(return_value=Mock(
                in_=Mock(return_value=mock_query)
            ))
        )
        db.client.table.return_value = mock_table

        result = db.get_in_flight_count("run-123")
        assert result == 15

    def test_returns_zero_when_no_in_flight(self):
        """get_in_flight_count returns 0 when no tasks are queued/processing."""
        db = DatabaseClient.__new__(DatabaseClient)
        db.client = Mock()

        mock_result = Mock()
        mock_result.count = 0
        mock_result.data = []

        mock_query = Mock()
        mock_query.execute.return_value = mock_result

        mock_table = Mock()
        mock_table.select.return_value = Mock(
            eq=Mock(return_value=Mock(
                in_=Mock(return_value=mock_query)
            ))
        )
        db.client.table.return_value = mock_table

        result = db.get_in_flight_count("run-123")
        assert result == 0
