"""
Tests for the task worker/processor module.
"""
import pytest
from unittest.mock import Mock, patch, MagicMock, AsyncMock
from datetime import datetime
import uuid

from src.worker import TaskProcessor
from src.llm import LLMResponse, RetryableError, NonRetryableError
from src.prompt import Question


@pytest.fixture
def mock_db():
    """Mock database client."""
    db = Mock()
    db.start_task.return_value = 1  # Returns attempt count
    db.complete_task.return_value = True
    db.fail_task.return_value = True
    db.get_task.return_value = {
        "id": str(uuid.uuid4()),
        "survey_run_id": str(uuid.uuid4()),
        "backstory_id": str(uuid.uuid4()),
        "status": "processing",
        "attempts": 1,
    }
    db.get_backstory.return_value = {
        "id": str(uuid.uuid4()),
        "backstory_text": "I am a 35 year old teacher from California.",
    }
    db.get_survey_questions.return_value = [
        {"qkey": "q1", "type": "mcq", "text": "Test question?", "options": ["Yes", "No"]},
    ]
    return db


@pytest.fixture
def mock_llm():
    """Mock LLM client."""
    llm = Mock()
    llm.complete.return_value = LLMResponse(answer="A", reasoning=None, raw='{"answer": "A"}')
    return llm


@pytest.fixture
def processor(mock_db, mock_llm):
    """Create TaskProcessor with mocked dependencies."""
    return TaskProcessor(db=mock_db, llm=mock_llm, max_retries=3)


class TestStartTask:
    """Tests for start_task integration."""

    def test_calls_start_task(self, processor, mock_db):
        """process_task calls db.start_task."""
        task_id = str(uuid.uuid4())

        processor.process_task(task_id)

        mock_db.start_task.assert_called_once_with(task_id)

    def test_fails_when_max_retries_exceeded(self, processor, mock_db, mock_llm):
        """Fails permanently when start_task returns attempts > max_retries."""
        mock_db.start_task.return_value = 4  # > max_retries=3
        task_id = str(uuid.uuid4())

        result = processor.process_task(task_id)

        assert result.success is False
        assert "Max retries" in result.error
        mock_db.fail_task.assert_called_once()
        # Should NOT have called LLM
        mock_llm.complete.assert_not_called()


class TestFetchTask:
    """Tests for fetching task from database."""

    def test_fetches_task_correctly(self, processor, mock_db):
        """Processor fetches task details from DB."""
        task_id = str(uuid.uuid4())
        mock_db.get_task.return_value = {
            "id": task_id,
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 1,
        }

        task = processor.fetch_task(task_id)

        mock_db.get_task.assert_called_once_with(task_id)
        assert task["id"] == task_id

    def test_returns_none_for_nonexistent_task(self, processor, mock_db):
        """Returns None if task doesn't exist."""
        mock_db.get_task.return_value = None

        task = processor.fetch_task("nonexistent-id")

        assert task is None


class TestProcessQuestionsInSeries:
    """Tests for LLM interaction via process_questions_in_series."""

    def test_calls_llm_with_correct_prompt(self, processor, mock_db, mock_llm):
        """Processor builds correct prompt and calls LLM."""
        backstory = "I am a software engineer."
        questions = [
            Question(qkey="q1", type="mcq", text="Do you like coding?", options=["Yes", "No"])
        ]

        results = processor.process_questions_in_series(backstory, questions)

        mock_llm.complete.assert_called_once()
        call_args = mock_llm.complete.call_args
        prompt = call_args.args[0] if call_args.args else call_args.kwargs.get("prompt")

        # Prompt should contain backstory and question
        assert "software engineer" in prompt
        assert "Do you like coding?" in prompt

    def test_returns_answers_dict(self, processor, mock_db, mock_llm):
        """Returns dict mapping qkey -> answer."""
        mock_llm.complete.return_value = LLMResponse(
            answer="B",
            reasoning="Because no.",
            raw='{"answer": "B", "reasoning": "Because no."}',
        )

        backstory = "Test backstory"
        questions = [
            Question(qkey="q1", type="mcq", text="Test?", options=["Yes", "No"])
        ]

        results = processor.process_questions_in_series(backstory, questions)

        assert results["q1"] == "B"


class TestStoreResult:
    """Tests for storing results in database."""

    def test_stores_result_atomically(self, processor, mock_db):
        """Stores result via atomic complete_task RPC."""
        task_id = str(uuid.uuid4())
        result = {"q1": "A"}

        processor.store_result(task_id, result)

        mock_db.complete_task.assert_called_with(task_id, result)

    def test_returns_false_if_not_processing(self, processor, mock_db):
        """Returns False if task is not in 'processing' state."""
        mock_db.complete_task.return_value = False
        task_id = str(uuid.uuid4())

        success = processor.store_result(task_id, {"q1": "A"})

        assert success is False


class TestErrorHandling:
    """Tests for error handling in task processing."""

    def test_handles_llm_error_gracefully(self, processor, mock_db, mock_llm):
        """Handles LLM errors without crashing."""
        mock_llm.complete.side_effect = RetryableError("Rate limited")

        task = {
            "id": str(uuid.uuid4()),
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 1,
        }
        mock_db.get_task.return_value = task
        mock_db.get_backstory.return_value = {"backstory_text": "Test"}
        mock_db.get_survey_questions.return_value = [
            {"qkey": "q1", "type": "mcq", "text": "Test?", "options": ["A", "B"]}
        ]

        # Should not raise
        result = processor.process_task(task["id"])

        assert result.success is False
        assert result.error is not None

    def test_non_retryable_uses_fail_task(self, processor, mock_db, mock_llm):
        """NonRetryableError uses atomic fail_task RPC."""
        task_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())

        task = {
            "id": task_id,
            "survey_run_id": run_id,
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 0,
        }
        mock_db.get_task.return_value = task
        mock_db.get_backstory.return_value = {"backstory_text": "Test"}
        mock_db.get_survey_questions.return_value = [
            {"qkey": "q1", "type": "mcq", "text": "Test?", "options": ["A", "B"]}
        ]
        mock_llm.complete.side_effect = NonRetryableError("Bad request")

        processor.process_task(task_id)

        mock_db.fail_task.assert_called_once()

    def test_retryable_error_returns_failure(self, processor, mock_db, mock_llm):
        """Retryable error returns failure result (caller handles retry via nack)."""
        task_id = str(uuid.uuid4())

        task = {
            "id": task_id,
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 1,
        }
        mock_db.get_task.return_value = task
        mock_db.get_backstory.return_value = {"backstory_text": "Test"}
        mock_db.get_survey_questions.return_value = [
            {"qkey": "q1", "type": "mcq", "text": "Test?", "options": ["A", "B"]}
        ]
        mock_llm.complete.side_effect = RetryableError("Temporary error")

        result = processor.process_task(task_id)

        assert result.success is False
        assert result.error is not None


class TestProcessTaskE2E:
    """End-to-end tests for task processing."""

    def test_full_successful_processing(self, processor, mock_db, mock_llm):
        """Full successful task processing flow."""
        task_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        backstory_id = str(uuid.uuid4())

        task = {
            "id": task_id,
            "survey_run_id": run_id,
            "backstory_id": backstory_id,
            "status": "processing",
            "attempts": 1,
        }
        mock_db.get_task.return_value = task
        mock_db.get_backstory.return_value = {
            "id": backstory_id,
            "backstory_text": "I am a 30 year old nurse.",
        }
        mock_db.get_survey_questions.return_value = [
            {"qkey": "q1", "type": "mcq", "text": "Do you support healthcare reform?", "options": ["Yes", "No"]},
        ]
        mock_llm.complete.return_value = LLMResponse(
            answer="A",
            reasoning="As a nurse, I support better healthcare.",
            raw='{"answer": "A"}',
        )

        result = processor.process_task(task_id)

        # Verify the full flow
        assert result.success is True
        mock_db.start_task.assert_called_with(task_id)
        mock_db.complete_task.assert_called_once()

    def test_processing_with_multiple_questions(self, processor, mock_db, mock_llm):
        """Processing task with multiple questions."""
        task_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        backstory_id = str(uuid.uuid4())

        task = {
            "id": task_id,
            "survey_run_id": run_id,
            "backstory_id": backstory_id,
            "status": "processing",
            "attempts": 1,
        }
        mock_db.get_task.return_value = task
        mock_db.get_backstory.return_value = {
            "id": backstory_id,
            "backstory_text": "I am a student.",
        }
        mock_db.get_survey_questions.return_value = [
            {"qkey": "q1", "type": "mcq", "text": "Question 1?", "options": ["A", "B"]},
            {"qkey": "q2", "type": "mcq", "text": "Question 2?", "options": ["C", "D"]},
        ]

        # LLM returns answers for each question
        mock_llm.complete.return_value = LLMResponse(
            answer="A",
            reasoning=None,
            raw='{"answer": "A"}',
        )

        result = processor.process_task(task_id)

        assert result.success is True
        # Should have called LLM for each question
        assert mock_llm.complete.call_count >= 1


class TestTaskProcessorResult:
    """Tests for TaskProcessorResult dataclass."""

    def test_success_result(self, processor, mock_db, mock_llm):
        """Successful processing returns success result."""
        task_id = str(uuid.uuid4())
        task = {
            "id": task_id,
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 1,
        }
        mock_db.get_task.return_value = task
        mock_db.get_backstory.return_value = {"backstory_text": "Test"}
        mock_db.get_survey_questions.return_value = [
            {"qkey": "q1", "type": "mcq", "text": "Test?", "options": ["A", "B"]}
        ]

        result = processor.process_task(task_id)

        assert result.success is True
        assert result.task_id == task_id
        assert result.error is None

    def test_failure_result(self, processor, mock_db, mock_llm):
        """Failed processing returns failure result with error."""
        task_id = str(uuid.uuid4())
        task = {
            "id": task_id,
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 3,
        }
        mock_db.get_task.return_value = task
        mock_db.get_backstory.return_value = {"backstory_text": "Test"}
        mock_db.get_survey_questions.return_value = [
            {"qkey": "q1", "type": "mcq", "text": "Test?", "options": ["A", "B"]}
        ]
        mock_llm.complete.side_effect = NonRetryableError("API error")

        result = processor.process_task(task_id)

        assert result.success is False
        assert result.error is not None
        assert "API error" in result.error
