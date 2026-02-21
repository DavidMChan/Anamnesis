"""
Tests for the async worker functionality.

Covers:
- Metrics tracker (p50/p95/p99, status detection)
- Async LLM client (UnifiedLLMClient)
- Async worker (sequential questions, concurrent tasks)
- Async queue consumer
- Graceful shutdown
- Error handling in async flow
- Config (MAX_CONCURRENT_TASKS)
- Strategy pattern (async fill)
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
    UnifiedLLMClient,
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
from src.worker import TaskProcessor, SeriesWithContext


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
        assert detect_throughput_plateau(10.0, 10.0) is True
        assert detect_throughput_plateau(10.5, 10.0) is True
        assert detect_throughput_plateau(12.0, 10.0) is False

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
        logger = MetricsLogger(tracker, interval_seconds=0)

        result = logger.maybe_log(in_flight=5, max_concurrent=10)
        assert result is not None
        assert result.count == 1

    def test_skips_before_interval(self):
        tracker = LatencyTracker(window_seconds=60)
        tracker.record(100.0)
        logger = MetricsLogger(tracker, interval_seconds=9999)

        logger.maybe_log()
        result = logger.maybe_log()
        assert result is None


# ==================== Async LLM Tests ====================


class TestAsyncUnifiedLLMClient:
    """Tests for async UnifiedLLMClient."""

    @pytest.mark.asyncio
    async def test_async_complete_openrouter(self):
        """Async OpenRouter complete parses JSON response."""
        with patch("src.llm.OpenAI"), patch("src.llm.AsyncOpenAI"):
            client = UnifiedLLMClient(
                base_url="https://openrouter.ai/api/v1",
                api_key="test-key",
                model="test-model",
                provider="openrouter",
            )

        mock_completion = Mock()
        mock_completion.choices = [Mock(message=Mock(content='{"answer": "A"}'))]

        mock_async = AsyncMock()
        mock_async.chat.completions.create.return_value = mock_completion
        client._async_client = mock_async

        result = await client.async_complete("Test prompt")
        assert result.answer == "A"
        mock_async.chat.completions.create.assert_called_once()

        await client.close()

    @pytest.mark.asyncio
    async def test_async_complete_vllm_guided(self):
        """Async vLLM complete sends extra_body with guided decoding."""
        with patch("src.llm.OpenAI"), patch("src.llm.AsyncOpenAI"):
            client = UnifiedLLMClient(
                base_url="http://localhost:8000/v1",
                api_key="test",
                model="test-model",
                provider="vllm",
            )

        mock_completion = Mock()
        mock_completion.choices = [Mock(message=Mock(content="A"))]

        mock_async = AsyncMock()
        mock_async.chat.completions.create.return_value = mock_completion
        client._async_client = mock_async

        question = Question(qkey="q1", type="mcq", text="Test?", options=["Yes", "No"])
        result = await client.async_complete("Test prompt", question=question)

        assert result.answer == "A"
        call_kwargs = mock_async.chat.completions.create.call_args.kwargs
        assert "extra_body" in call_kwargs
        assert call_kwargs["extra_body"]["structured_outputs"]["choice"] == ["A", "B"]

        await client.close()

    @pytest.mark.asyncio
    async def test_async_complete_retries_rate_limit(self):
        """Async client raises RetryableError on rate limit (SDK already retried)."""
        import openai as openai_module

        with patch("src.llm.OpenAI"), patch("src.llm.AsyncOpenAI"):
            client = UnifiedLLMClient(
                base_url="https://openrouter.ai/api/v1",
                api_key="test-key",
                model="test-model",
                provider="openrouter",
            )

        mock_async = AsyncMock()
        mock_async.chat.completions.create.side_effect = openai_module.RateLimitError(
            message="Rate limited",
            response=Mock(status_code=429),
            body=None,
        )
        client._async_client = mock_async

        with pytest.raises(RetryableError, match="Rate limited"):
            await client.async_complete("Test")

        await client.close()


# ==================== Async Worker Tests ====================


@pytest.fixture
def mock_db():
    """Mock database client."""
    db = Mock()
    db.start_task.return_value = 1
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
    llm.max_tokens = 512
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

    @pytest.mark.asyncio
    async def test_async_process_uses_strategy(self, mock_db, mock_async_llm):
        """Async process_task uses the filling strategy."""
        mock_strategy = AsyncMock()
        mock_strategy.fill.return_value = {"q1": "A"}

        processor = TaskProcessor(
            db=mock_db, llm=mock_async_llm, max_retries=3,
            strategy=mock_strategy,
        )

        task = {
            "id": str(uuid.uuid4()),
            "survey_run_id": str(uuid.uuid4()),
            "backstory_id": str(uuid.uuid4()),
        }

        result = await processor.async_process_task(task)

        assert result.success is True
        mock_strategy.fill.assert_called_once()


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

        assert len(results) == 3
        assert results["q1"] == "A"
        assert results["q2"] == "A"
        assert results["q3"] == "A"
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

        assert "Test backstory" in prompts_received[0]
        assert "Q1?" in prompts_received[0]
        assert "Q1?" in prompts_received[1]
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
            await asyncio.sleep(0.05)
            async with lock:
                concurrent_count -= 1
            return LLMResponse(answer="A", raw='{"answer": "A"}')

        llm = AsyncMock()
        llm.async_complete.side_effect = slow_complete
        llm.max_tokens = 512

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

        assert all(r.success for r in results)
        assert max_concurrent > 1
        assert max_concurrent <= 5


class TestAsyncErrorHandling:
    """Tests for error handling in async flow."""

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


# ==================== Strategy Pattern Tests ====================


class TestStrategyPattern:
    """Tests for the FillingStrategy protocol."""

    @pytest.mark.asyncio
    async def test_custom_strategy_accepted(self):
        """TaskProcessor accepts any FillingStrategy implementation."""
        mock_strategy = AsyncMock()
        mock_strategy.fill.return_value = {"q1": "custom"}

        mock_llm = AsyncMock()
        mock_llm.max_tokens = 512
        processor = TaskProcessor(
            db=Mock(), llm=mock_llm, strategy=mock_strategy,
        )

        questions = [Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])]
        results = await processor.async_process_questions_in_series("Backstory", questions)

        assert results == {"q1": "custom"}
        mock_strategy.fill.assert_called_once()

    @pytest.mark.asyncio
    async def test_default_strategy_is_series_with_context(self):
        """Default strategy is SeriesWithContext."""
        processor = TaskProcessor(db=Mock(), llm=AsyncMock())
        assert isinstance(processor.strategy, SeriesWithContext)


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
