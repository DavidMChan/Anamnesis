"""
Latency metrics tracker for LLM calls.

Provides:
- Sliding window latency recording
- Percentile calculations (p50, p95, p99)
- Periodic summary logging
- Status classification (OK/WARN/OVERLOAD) for benchmark use
"""
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class MetricsSummary:
    """Snapshot of current metrics."""
    count: int
    throughput: float  # requests per second
    p50: float  # milliseconds
    p95: float  # milliseconds
    p99: float  # milliseconds
    in_flight: int = 0
    max_concurrent: int = 0


class LatencyTracker:
    """
    Tracks LLM call latencies over a sliding window.

    Thread/async-safe for reads (percentile calculations), but callers
    should ensure record() is not called concurrently from multiple threads.
    In async context, this is naturally safe since the event loop is single-threaded.
    """

    def __init__(self, window_seconds: float = 60.0):
        """
        Args:
            window_seconds: Duration of the sliding window in seconds.
        """
        self.window_seconds = window_seconds
        self._latencies: deque[tuple[float, float]] = deque()  # (timestamp, duration_ms)
        self._total_count: int = 0

    def record(self, duration_ms: float) -> None:
        """Record a latency measurement."""
        now = time.monotonic()
        self._latencies.append((now, duration_ms))
        self._total_count += 1
        self._evict_old(now)

    def _evict_old(self, now: float) -> None:
        """Remove entries outside the sliding window."""
        cutoff = now - self.window_seconds
        while self._latencies and self._latencies[0][0] < cutoff:
            self._latencies.popleft()

    def _get_window_durations(self) -> list[float]:
        """Get all durations in the current window, sorted."""
        now = time.monotonic()
        self._evict_old(now)
        durations = [d for _, d in self._latencies]
        durations.sort()
        return durations

    def percentile(self, p: float) -> float:
        """
        Calculate the p-th percentile of latencies in the window.

        Args:
            p: Percentile (0-100)

        Returns:
            Latency in milliseconds, or 0.0 if no data.
        """
        durations = self._get_window_durations()
        if not durations:
            return 0.0
        idx = int(len(durations) * p / 100)
        idx = min(idx, len(durations) - 1)
        return durations[idx]

    @property
    def p50(self) -> float:
        return self.percentile(50)

    @property
    def p95(self) -> float:
        return self.percentile(95)

    @property
    def p99(self) -> float:
        return self.percentile(99)

    @property
    def count(self) -> int:
        """Total number of entries in the current window."""
        self._evict_old(time.monotonic())
        return len(self._latencies)

    @property
    def throughput(self) -> float:
        """Requests per second over the window."""
        self._evict_old(time.monotonic())
        n = len(self._latencies)
        if n == 0:
            return 0.0
        return n / self.window_seconds

    def summary(self, in_flight: int = 0, max_concurrent: int = 0) -> MetricsSummary:
        """Get a summary snapshot of current metrics."""
        return MetricsSummary(
            count=self.count,
            throughput=self.throughput,
            p50=self.p50,
            p95=self.p95,
            p99=self.p99,
            in_flight=in_flight,
            max_concurrent=max_concurrent,
        )

    def reset(self) -> None:
        """Clear all recorded latencies."""
        self._latencies.clear()
        self._total_count = 0


def classify_status(p99: float, baseline_p99: float) -> str:
    """
    Classify a concurrency level's health status.

    Args:
        p99: Current p99 latency in ms
        baseline_p99: Baseline p99 (at concurrency=1) in ms

    Returns:
        "OK", "WARN", or "OVERLOAD"
    """
    if baseline_p99 <= 0:
        return "OK"
    ratio = p99 / baseline_p99
    if ratio >= 5:
        return "OVERLOAD"
    if ratio >= 2:
        return "WARN"
    return "OK"


def detect_throughput_plateau(
    current_throughput: float,
    previous_throughput: float,
    threshold: float = 0.1,
) -> bool:
    """
    Detect if throughput has plateaued (stopped increasing).

    Args:
        current_throughput: Current level's throughput (req/s)
        previous_throughput: Previous level's throughput (req/s)
        threshold: Minimum relative increase to not be a plateau (default 10%)

    Returns:
        True if throughput plateaued
    """
    if previous_throughput <= 0:
        return False
    increase = (current_throughput - previous_throughput) / previous_throughput
    return increase < threshold


def format_duration(ms: float) -> str:
    """Format milliseconds as human-readable string."""
    if ms < 1000:
        return f"{ms:.0f}ms"
    return f"{ms / 1000:.1f}s"


class MetricsLogger:
    """Periodically logs metrics summaries."""

    def __init__(
        self,
        tracker: LatencyTracker,
        interval_seconds: float = 30.0,
    ):
        self.tracker = tracker
        self.interval_seconds = interval_seconds
        self._last_log_time: float = 0.0

    def maybe_log(self, in_flight: int = 0, max_concurrent: int = 0) -> Optional[MetricsSummary]:
        """
        Log metrics if the interval has elapsed.

        Returns the summary if logged, None otherwise.
        """
        now = time.monotonic()
        if now - self._last_log_time < self.interval_seconds:
            return None

        self._last_log_time = now
        s = self.tracker.summary(in_flight=in_flight, max_concurrent=max_concurrent)

        if s.count > 0:
            logger.info(
                f"[metrics] window={self.tracker.window_seconds:.0f}s | "
                f"processed={s.count} | throughput={s.throughput:.1f}/s | "
                f"p50={format_duration(s.p50)} | p95={format_duration(s.p95)} | "
                f"p99={format_duration(s.p99)} | in_flight={s.in_flight}"
            )

        return s
