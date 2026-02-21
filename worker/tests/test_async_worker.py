"""
Tests for the async worker functionality.

Covers:
- Metrics tracker (p50/p95/p99, status detection)
- Async LLM clients (OpenRouter, vLLM)
- Async worker (sequential questions, concurrent tasks)
- Async queue consumer
- Graceful shutdown
- Error handling in async flow
- Config (MAX_CONCURRENT_TASKS)
"""
import asyncio
import json
import time
import uuid
from unittest.mock import Mock, MagicMock, AsyncMock, patch

import pytest

from src.config import WorkerConfig
from src.llm import (
    LLMResponse,
    OpenRouterClient,
    VLLMClient,
    RetryableError,
    NonRetryableError,
)
from src.metrics import (
    LatencyTracker,
    MetricsLogger,
    classify_status,
    detect_throughput_plateau,
    format_duration,
)
from src.prompt import Question
from src.worker import TaskProcessor


# ==================== Metrics Tests ====================


class TestLatencyTracker:
    """Tests for LatencyTracker p50/p95/p99 calculation."""

    def test_empty_tracker_returns_zero(self):
        tracker = LatencyTracker()
        assert tracker.p50 == 0.0
        assert tracker.p95 == 0.0
        assert tracker.p99 == 0.0

    def test_single_entry(self):
        tracker = LatencyTracker()
        tracker.record(100.0)
        assert tracker.p50 == 100.0
        assert tracker.p99 == 100.0

    def test_percentile_calculation(self):
        """p50/p95/p99 correctly calculated from recorded durations."""
        tracker = LatencyTracker(window_seconds=60)
        # Record 100 values: 1ms, 2ms, ..., 100ms
        for i in range(1, 101):
            tracker.record(float(i))

        assert tracker.p50 == pytest.approx(50.0, abs=2)
        assert tracker.p95 == pytest.approx(95.0, abs=2)
        assert tracker.p99 == pytest.approx(99.0, abs=2)

    def test_count_reflects_window(self):
        tracker = LatencyTracker(window_seconds=60)
        tracker.record(10.0)
        tracker.record(20.0)
        assert tracker.count == 2

    def test_throughput_calculation(self):
        tracker = LatencyTracker(window_seconds=10)
        for _ in range(50):
            tracker.record(1.0)
        assert tracker.throughput == pytest.approx(5.0, abs=1)

    def test_summary_snapshot(self):
        tracker = LatencyTracker(window_seconds=60)
        tracker.record(100.0)
        tracker.record(200.0)

        summary = tracker.summary(in_flight=5, max_concurrent=10)
        assert summary.count == 2
        assert summary.in_flight == 5
        assert summary.max_concurrent == 10
        assert summary.p50 > 0

    def test_reset_clears_data(self):
        tracker = LatencyTracker()
        tracker.record(100.0)
        tracker.reset()
        assert tracker.count == 0
        assert tracker.p50 == 0.0


class TestStatusDetection:
    """Tests for classify_status OK/WARN/OVERLOAD detection."""

    def test_ok_within_threshold(self):
        assert classify_status(p99=100, baseline_p99=100) == "OK"
        assert classify_status(p99=190, baseline_p99=100) == "OK"

    def test_warn_above_2x(self):
        assert classify_status(p99=200, baseline_p99=100) == "WARN"
        assert classify_status(p99=400, baseline_p99=100) == "WARN"

    def test_overload_above_5x(self):
        assert classify_status(p99=500, baseline_p99=100) == "OVERLOAD"
        assert classify_status(p99=1000, baseline_p99=100) == "OVERLOAD"

    def test_zero_baseline_returns_ok(self):
        assert classify_status(p99=100, baseline_p99=0) == "OK"

    def test_throughput_plateau_detection(self):
        assert detect_throughput_plateau(10.0, 10.0) is True  # No increase
        assert detect_throughput_plateau(10.5, 10.0) is True  # 5% < 10%
        assert detect_throughput_plateau(12.0, 10.0) is False  # 20% increase

    def test_throughput_plateau_zero_previous(self):
        assert detect_throughput_plateau(10.0, 0.0) is False


class TestFormatDuration:

    def test_milliseconds(self):
        assert format_duration(500) == "500ms"

    def test_seconds(self):
        assert format_duration(1500) == "1.5s"


class TestMetricsLogger:

    def test_logs_at_interval(self):
        tracker = LatencyTracker(window_seconds=60)
        tracker.record(100.0)
        logger = MetricsLogger(tracker, interval_seconds=0)  # Always log

        result = logger.maybe_log(in_flight=5, max_concurrent=10)
        assert result is not None
        assert result.count == 1

    def test_skips_before_interval(self):
        tracker = LatencyTracker(window_seconds=60)
        tracker.record(100.0)
        logger = MetricsLogger(tracker, interval_seconds=9999)

        # First call logs
        logger.maybe_log()
        # Second call should skip
        result = logger.maybe_log()
        assert result is None


# ==================== Async LLM Tests ====================


class TestAsyncOpenRouterClient:
    """Tests for async OpenRouter LLM client."""

    @pytest.mark.asyncio
    async def test_async_complete_makes_correct_request(self):
        """AsyncClient makes correct HTTP request and parses response."""
        client = OpenRouterClient(
            api_key="test-key",
            model="test-model",
            max_retries=1,
        )

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": '{"answer": "A"}'}}]
        }

        with patch.object(client, "_get_async_client") as mock_get_client:
            mock_async_client = AsyncMock()
            mock_async_client.post.return_value = mock_response
            mock_get_client.return_value = mock_async_client

            result = await client.async_complete("Test prompt")

            assert result.answer == "A"
            mock_async_client.post.assert_called_once()
            call_args = mock_async_client.post.call_args
            assert call_args.args[0] == OpenRouterClient.BASE_URL
            payload = call_args.kwargs["json"]
            assert payload["model"] == "test-model"

        await client.close()

    @pytest.mark.asyncio
    async def test_async_complete_retries_on_rate_limit(self):
        """Async client retries on 429 with async sleep."""
        client = OpenRouterClient(
            api_key="test-key",
            model="test-model",
            max_retries=3,
        )

        fail_response = Mock()
        fail_response.status_code = 429
        fail_response.json.return_value = {"error": {"message": "Rate limited"}}

        success_response = Mock()
        success_response.status_code = 200
        success_response.json.return_value = {
            "choices": [{"message": {"content": '{"answer": "B"}'}}]
        }

        with patch.object(client, "_get_async_client") as mock_get_client:
            mock_async_client = AsyncMock()
            mock_async_client.post.side_effect = [fail_response, success_response]
            mock_get_client.return_value = mock_async_client

            with patch("src.llm.asyncio.sleep", new_callable=AsyncMock):
                result = await client.async_complete("Test")

        assert result.answer == "B"
        await client.close()


class TestAsyncVLLMClient:
    """Tests for async vLLM client."""

    @pytest.mark.asyncio
    async def test_async_complete_makes_correct_request(self):
        """AsyncClient makes correct request with guided decoding params."""
        client = VLLMClient(
            endpoint="http://localhost:8000/v1",
            model="test-model",
            max_retries=1,
        )

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"text": "A", "finish_reason": "stop"}]
        }

        question = Question(qkey="q1", type="mcq", text="Test?", options=["Yes", "No"])

        with patch.object(client, "_get_async_client") as mock_get_client:
            mock_async_client = AsyncMock()
            mock_async_client.post.return_value = mock_response
            mock_get_client.return_value = mock_async_client

            result = await client.async_complete("Test prompt", question=question)

            assert result.answer == "A"
            call_args = mock_async_client.post.call_args
            url = call_args.args[0]
            assert "/completions" in url
            payload = call_args.kwargs["json"]
            assert "structured_outputs" in payload

        await client.close()

    @pytest.mark.asyncio
    async def test_async_complete_retries_on_server_error(self):
        """Async vLLM client retries on 500."""
        client = VLLMClient(
            endpoint="http://localhost:8000/v1",
            model="test-model",
            max_retries=3,
        )

        fail_response = Mock()
        fail_response.status_code = 500

        success_response = Mock()
        success_response.status_code = 200
        success_response.json.return_value = {
            "choices": [{"text": "(B)", "finish_reason": "stop"}]
        }

        with patch.object(client, "_get_async_client") as mock_get_client:
            mock_async_client = AsyncMock()
            mock_async_client.post.side_effect = [fail_response, success_response]
            mock_get_client.return_value = mock_async_client

            with patch("src.llm.asyncio.sleep", new_callable=AsyncMock):
                result = await client.async_complete("Test")

        assert result.answer == "B"
        await client.close()


# ==================== Async Worker Tests ====================


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
def mock_async_llm():
    """Mock LLM client with async methods."""
    llm = AsyncMock()
    llm.async_complete.return_value = LLMResponse(answer="A", reasoning=None, raw='{"answer": "A"}')
    llm.complete.return_value = LLMResponse(answer="A", reasoning=None, raw='{"answer": "A"}')
    llm.close = AsyncMock()
    return llm


@pytest.fixture
def async_processor(mock_db, mock_async_llm):
    """Create TaskProcessor with async-capable mocked dependencies."""
    return TaskProcessor(db=mock_db, llm=mock_async_llm, max_retries=3)


class TestAsyncProcessTask:
    """Tests for async process_task flow."""

    @pytest.mark.asyncio
    async def test_async_process_task_process_and_complete(self, async_processor, mock_db, mock_async_llm):
        """Async process_task processes questions and completes task."""
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

        result = await async_processor.async_process_task(task)

        assert result.success is True
        mock_db.complete_task.assert_called_once()


class TestAsyncSequentialQuestions:
    """Tests for sequential question processing within a single task."""

    @pytest.mark.asyncio
    async def test_questions_processed_sequentially(self, async_processor, mock_async_llm):
        """Questions within a task are processed sequentially (not parallel)."""
        call_order = []

        async def track_calls(*args, **kwargs):
            call_order.append(len(call_order))
            return LLMResponse(answer="A", raw='{"answer": "A"}')

        mock_async_llm.async_complete.side_effect = track_calls

        backstory = "Test backstory"
        questions = [
            Question(qkey="q1", type="mcq", text="Q1?", options=["Yes", "No"]),
            Question(qkey="q2", type="mcq", text="Q2?", options=["A", "B"]),
            Question(qkey="q3", type="mcq", text="Q3?", options=["X", "Y"]),
        ]

        results = await async_processor.async_process_questions_in_series(backstory, questions)

        # All questions answered
        assert len(results) == 3
        assert results["q1"] == "A"
        assert results["q2"] == "A"
        assert results["q3"] == "A"
        # Called sequentially (3 questions, 3 calls)
        assert mock_async_llm.async_complete.call_count == 3
        assert call_order == [0, 1, 2]

    @pytest.mark.asyncio
    async def test_context_accumulates(self, async_processor, mock_async_llm):
        """Later questions see previous Q&A context in their prompts."""
        prompts_received = []

        async def capture_prompt(prompt, *args, **kwargs):
            prompts_received.append(prompt)
            return LLMResponse(answer="A", raw="A")

        mock_async_llm.async_complete.side_effect = capture_prompt

        backstory = "Test backstory"
        questions = [
            Question(qkey="q1", type="mcq", text="Q1?", options=["Yes", "No"]),
            Question(qkey="q2", type="mcq", text="Q2?", options=["A", "B"]),
        ]

        await async_processor.async_process_questions_in_series(backstory, questions)

        # First prompt has backstory + Q1
        assert "Test backstory" in prompts_received[0]
        assert "Q1?" in prompts_received[0]
        # Second prompt has Q1 answer + consistency prompt + Q2
        assert "Q1?" in prompts_received[1]  # Previous question context
        assert "Q2?" in prompts_received[1]
        assert "previous answers" in prompts_received[1].lower()


class TestAsyncConcurrentTasks:
    """Tests for concurrent task processing."""

    @pytest.mark.asyncio
    async def test_multiple_tasks_run_concurrently(self, mock_db):
        """Multiple tasks run concurrently via asyncio (semaphore-gated)."""
        concurrent_count = 0
        max_concurrent = 0
        lock = asyncio.Lock()

        async def slow_complete(*args, **kwargs):
            nonlocal concurrent_count, max_concurrent
            async with lock:
                concurrent_count += 1
                max_concurrent = max(max_concurrent, concurrent_count)
            await asyncio.sleep(0.05)  # Simulate LLM call
            async with lock:
                concurrent_count -= 1
            return LLMResponse(answer="A", raw='{"answer": "A"}')

        llm = AsyncMock()
        llm.async_complete.side_effect = slow_complete

        semaphore = asyncio.Semaphore(5)
        tasks = []

        for i in range(10):
            task_id = str(uuid.uuid4())
            run_id = str(uuid.uuid4())
            backstory_id = str(uuid.uuid4())

            task_dict = {
                "id": task_id,
                "survey_run_id": run_id,
                "backstory_id": backstory_id,
                "status": "processing",
                "attempts": 1,
            }

            # Each task gets its own mock DB with unique IDs
            task_db = Mock()
            task_db.complete_task.return_value = True
            task_db.get_backstory.return_value = {
                "backstory_text": "Test backstory",
            }
            task_db.get_survey_questions.return_value = [
                {"qkey": "q1", "type": "mcq", "text": "Test?", "options": ["Y", "N"]},
            ]

            processor = TaskProcessor(db=task_db, llm=llm, max_retries=3)

            async def run_with_semaphore(proc, td):
                async with semaphore:
                    return await proc.async_process_task(td)

            tasks.append(asyncio.create_task(run_with_semaphore(processor, task_dict)))

        results = await asyncio.gather(*tasks)

        # All tasks completed
        assert all(r.success for r in results)
        # Multiple ran concurrently (max > 1)
        assert max_concurrent > 1
        # But not more than semaphore limit
        assert max_concurrent <= 5


class TestAsyncErrorHandling:
    """Tests for error handling in async flow.

    async_process_task now lets errors propagate to handle_message,
    which decides whether to nack (retry) or fail permanently.
    """

    @pytest.mark.asyncio
    async def test_retryable_error_propagates(self, async_processor, mock_db, mock_async_llm):
        """RetryableError propagates to caller for nack handling."""
        mock_async_llm.async_complete.side_effect = RetryableError("Rate limited")

        task = {
            "id": str(uuid.uuid4()),
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 1,
        }

        with pytest.raises(RetryableError, match="Rate limited"):
            await async_processor.async_process_task(task)

    @pytest.mark.asyncio
    async def test_non_retryable_error_propagates(self, async_processor, mock_db, mock_async_llm):
        """NonRetryableError propagates to caller for fail_task handling."""
        mock_async_llm.async_complete.side_effect = NonRetryableError("Bad request")

        task = {
            "id": str(uuid.uuid4()),
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 0,
        }

        with pytest.raises(NonRetryableError, match="Bad request"):
            await async_processor.async_process_task(task)

    @pytest.mark.asyncio
    async def test_missing_backstory_raises_non_retryable(self, async_processor, mock_db, mock_async_llm):
        """Missing backstory raises NonRetryableError."""
        mock_db.get_backstory.return_value = None

        task = {
            "id": str(uuid.uuid4()),
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
            "status": "processing",
            "attempts": 1,
        }

        with pytest.raises(NonRetryableError, match="not found"):
            await async_processor.async_process_task(task)


# ==================== Async Queue Consumer Tests ====================


class TestAsyncQueueConsumer:
    """Tests for aio-pika async consumer."""

    @pytest.mark.asyncio
    async def test_consumer_parses_message(self):
        """Consumer correctly parses JSON message body."""
        from src.queue import AsyncQueueConsumer

        mock_message = Mock()
        mock_message.body = json.dumps({"task_id": "abc-123"}).encode("utf-8")

        parsed = AsyncQueueConsumer.parse_message(mock_message)
        assert parsed["task_id"] == "abc-123"

    @pytest.mark.asyncio
    async def test_consumer_respects_prefetch(self):
        """Consumer sets prefetch_count to control message flow."""
        from src.queue import AsyncQueueConsumer

        consumer = AsyncQueueConsumer(prefetch_count=20)
        assert consumer.prefetch_count == 20


# ==================== Graceful Shutdown Tests ====================


class TestAsyncGracefulShutdown:
    """Tests for graceful shutdown behavior."""

    @pytest.mark.asyncio
    async def test_in_flight_tasks_complete_before_shutdown(self):
        """In-flight tasks are awaited during shutdown."""
        completed = []

        async def slow_task(task_id):
            await asyncio.sleep(0.05)
            completed.append(task_id)

        in_flight = set()
        tasks = []
        for i in range(3):
            t = asyncio.create_task(slow_task(f"task-{i}"))
            in_flight.add(t)
            t.add_done_callback(in_flight.discard)
            tasks.append(t)

        # Wait for all tasks (simulating shutdown wait)
        await asyncio.wait(in_flight, timeout=5)

        assert len(completed) == 3
        assert "task-0" in completed
        assert "task-1" in completed
        assert "task-2" in completed


# ==================== Config Tests ====================


class TestConfigMaxConcurrent:
    """Tests for MAX_CONCURRENT_TASKS config."""

    def test_default_value(self):
        """Default MAX_CONCURRENT_TASKS is 10."""
        with patch.dict("os.environ", {}, clear=False):
            # Remove the var if it exists
            import os
            env_copy = os.environ.copy()
            os.environ.pop("MAX_CONCURRENT_TASKS", None)
            try:
                config = WorkerConfig()
                assert config.max_concurrent_tasks == 10
            finally:
                os.environ.update(env_copy)

    def test_loaded_from_env(self):
        """MAX_CONCURRENT_TASKS loaded from environment."""
        with patch.dict("os.environ", {"MAX_CONCURRENT_TASKS": "25"}):
            config = WorkerConfig()
            assert config.max_concurrent_tasks == 25

    def test_metrics_log_interval_default(self):
        """METRICS_LOG_INTERVAL defaults to 30."""
        import os
        env_copy = os.environ.copy()
        os.environ.pop("METRICS_LOG_INTERVAL", None)
        try:
            config = WorkerConfig()
            assert config.metrics_log_interval == 30.0
        finally:
            os.environ.update(env_copy)
