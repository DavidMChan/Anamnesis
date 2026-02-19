#!/usr/bin/env python3
"""
LLM Backend Benchmark Script.

Measures throughput and latency at different concurrency levels to find
the optimal MAX_CONCURRENT_TASKS setting for the async worker.

Usage:
    python scripts/benchmark.py \
        --provider vllm \
        --endpoint http://gpu-server:8000/v1 \
        --model meta-llama/Llama-3-70b \
        --concurrency 1,5,10,20,50 \
        --requests-per-level 30

    python scripts/benchmark.py \
        --provider openrouter \
        --api-key $OPENROUTER_API_KEY \
        --model anthropic/claude-3-haiku \
        --concurrency 1,5,10,20,50 \
        --requests-per-level 30
"""
import argparse
import asyncio
import logging
import sys
import time
from dataclasses import dataclass
from typing import Optional

import httpx

# Add parent directory to path so we can import src modules
sys.path.insert(0, sys.path[0] + "/..")

from src.metrics import LatencyTracker, classify_status, detect_throughput_plateau, format_duration

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Realistic test prompt: short backstory + 1 MCQ question
BENCHMARK_BACKSTORY = (
    "My name is Sarah Chen. I'm 34 years old and work as a software engineer "
    "in San Francisco. I grew up in a small town in Oregon and moved to the Bay "
    "Area after college. I enjoy hiking, reading science fiction, and volunteering "
    "at the local food bank on weekends."
)

BENCHMARK_QUESTION = (
    "Question: How concerned are you about climate change?\n"
    "(A) Very concerned\n"
    "(B) Somewhat concerned\n"
    "(C) Not too concerned\n"
    "(D) Not at all concerned\n"
    "Answer with (A), (B), (C), or (D).\n"
    "Answer:"
)

BENCHMARK_PROMPT = f"{BENCHMARK_BACKSTORY}\n\n{BENCHMARK_QUESTION}"

BENCHMARK_CHAT_MESSAGES = [{"role": "user", "content": BENCHMARK_PROMPT}]


@dataclass
class LevelResult:
    """Results from benchmarking one concurrency level."""
    concurrency: int
    throughput: float
    p50: float
    p95: float
    p99: float
    errors: int
    status: str


async def benchmark_openrouter(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    semaphore: asyncio.Semaphore,
    tracker: LatencyTracker,
    error_count: list,
) -> None:
    """Send a single benchmark request to OpenRouter."""
    payload = {
        "model": model,
        "messages": BENCHMARK_CHAT_MESSAGES,
        "temperature": 0.0,
        "max_tokens": 4,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "answer",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "answer": {
                            "type": "string",
                            "enum": ["A", "B", "C", "D"],
                        }
                    },
                    "required": ["answer"],
                    "additionalProperties": False,
                },
            },
        },
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://anamnesis-rho.vercel.app",
    }

    async with semaphore:
        start = time.monotonic()
        try:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            if response.status_code != 200:
                error_count[0] += 1
                logger.warning(f"HTTP {response.status_code}: {response.text[:200]}")
                return
            duration_ms = (time.monotonic() - start) * 1000
            tracker.record(duration_ms)
        except Exception as e:
            error_count[0] += 1
            logger.warning(f"Request error: {e}")


async def benchmark_vllm(
    client: httpx.AsyncClient,
    endpoint: str,
    model: str,
    api_key: Optional[str],
    semaphore: asyncio.Semaphore,
    tracker: LatencyTracker,
    error_count: list,
) -> None:
    """Send a single benchmark request to vLLM."""
    url = f"{endpoint.rstrip('/')}/completions"
    payload = {
        "model": model,
        "prompt": BENCHMARK_PROMPT,
        "temperature": 0.0,
        "max_tokens": 1,
        "structured_outputs": {"choice": ["A", "B", "C", "D"]},
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    async with semaphore:
        start = time.monotonic()
        try:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                error_count[0] += 1
                logger.warning(f"HTTP {response.status_code}: {response.text[:200]}")
                return
            duration_ms = (time.monotonic() - start) * 1000
            tracker.record(duration_ms)
        except Exception as e:
            error_count[0] += 1
            logger.warning(f"Request error: {e}")


async def run_level(
    provider: str,
    concurrency: int,
    num_requests: int,
    api_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    model: str = "",
) -> tuple[LatencyTracker, int]:
    """
    Run benchmark at a single concurrency level.

    Returns (tracker, error_count).
    """
    tracker = LatencyTracker(window_seconds=600)  # Large window to capture all
    error_count = [0]
    semaphore = asyncio.Semaphore(concurrency)

    timeout = httpx.Timeout(120.0, connect=30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "openrouter":
            tasks = [
                benchmark_openrouter(client, api_key, model, semaphore, tracker, error_count)
                for _ in range(num_requests)
            ]
        elif provider == "vllm":
            tasks = [
                benchmark_vllm(client, endpoint, model, api_key, semaphore, tracker, error_count)
                for _ in range(num_requests)
            ]
        else:
            raise ValueError(f"Unknown provider: {provider}")

        start = time.monotonic()
        await asyncio.gather(*tasks)
        elapsed = time.monotonic() - start

    # Override throughput calculation using wall-clock time
    successful = num_requests - error_count[0]
    actual_throughput = successful / elapsed if elapsed > 0 else 0

    return tracker, error_count[0], actual_throughput


def print_results(results: list[LevelResult], recommended: Optional[int]) -> None:
    """Print results table."""
    header = f"{'Concurrency':>11} | {'Throughput':>10} | {'p50':>7} | {'p95':>7} | {'p99':>7} | {'Errors':>6} | Status"
    separator = "-" * len(header)

    print()
    print(header)
    print(separator)

    for r in results:
        status_suffix = ""
        if r.status == "WARN":
            status_suffix = " <- p99 > 2x baseline"
        elif r.status == "OVERLOAD":
            status_suffix = " <- throughput plateaued or p99 > 5x"

        print(
            f"{r.concurrency:>11} | {r.throughput:>8.1f}/s | "
            f"{format_duration(r.p50):>7} | {format_duration(r.p95):>7} | "
            f"{format_duration(r.p99):>7} | {r.errors:>6} | {r.status}{status_suffix}"
        )

    print(separator)
    if recommended:
        print(f"\nRecommendation: MAX_CONCURRENT_TASKS={recommended} (best throughput before degradation)")
    else:
        print("\nRecommendation: Could not determine optimal level. Check for errors or try different concurrency values.")
    print()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark LLM backend at different concurrency levels")
    parser.add_argument("--provider", required=True, choices=["openrouter", "vllm"])
    parser.add_argument("--api-key", help="API key (for OpenRouter, or authenticated vLLM)")
    parser.add_argument("--endpoint", help="Server endpoint (for vLLM)")
    parser.add_argument("--model", required=True, help="Model name")
    parser.add_argument(
        "--concurrency",
        default="1,5,10,20,50",
        help="Comma-separated concurrency levels to test (default: 1,5,10,20,50)",
    )
    parser.add_argument(
        "--requests-per-level",
        type=int,
        default=30,
        help="Number of requests per concurrency level (default: 30)",
    )

    args = parser.parse_args()

    if args.provider == "openrouter" and not args.api_key:
        parser.error("--api-key is required for openrouter provider")
    if args.provider == "vllm" and not args.endpoint:
        parser.error("--endpoint is required for vllm provider")

    levels = [int(x.strip()) for x in args.concurrency.split(",")]
    levels.sort()

    logger.info(f"Benchmarking {args.provider} model={args.model}")
    logger.info(f"Concurrency levels: {levels}")
    logger.info(f"Requests per level: {args.requests_per_level}")

    results: list[LevelResult] = []
    baseline_p99: Optional[float] = None
    prev_throughput: float = 0

    for level in levels:
        logger.info(f"--- Testing concurrency={level} ---")
        tracker, errors, throughput = await run_level(
            provider=args.provider,
            concurrency=level,
            num_requests=args.requests_per_level,
            api_key=args.api_key,
            endpoint=args.endpoint,
            model=args.model,
        )

        p50 = tracker.p50
        p95 = tracker.p95
        p99 = tracker.p99

        # Set baseline from first level
        if baseline_p99 is None:
            baseline_p99 = p99 if p99 > 0 else 1.0

        # Classify status
        status = classify_status(p99, baseline_p99)
        if status == "OK" and detect_throughput_plateau(throughput, prev_throughput):
            status = "OVERLOAD"

        results.append(LevelResult(
            concurrency=level,
            throughput=throughput,
            p50=p50,
            p95=p95,
            p99=p99,
            errors=errors,
            status=status,
        ))

        prev_throughput = throughput
        logger.info(
            f"concurrency={level}: throughput={throughput:.1f}/s p50={format_duration(p50)} "
            f"p95={format_duration(p95)} p99={format_duration(p99)} errors={errors} status={status}"
        )

    # Find recommendation: highest concurrency that's still OK
    recommended = None
    for r in reversed(results):
        if r.status == "OK":
            recommended = r.concurrency
            break

    # If no OK level found, recommend the first level
    if recommended is None and results:
        recommended = results[0].concurrency

    print_results(results, recommended)


if __name__ == "__main__":
    asyncio.run(main())
