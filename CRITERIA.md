# Feature: Async Worker + LLM Benchmark

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description

Convert the synchronous worker to async so a single worker process can handle many concurrent tasks (different backstories). Currently each worker blocks on one LLM call at a time — with async, one worker can have dozens of LLM requests in flight simultaneously. Also add a standalone benchmark script to determine the optimal concurrency level for a given LLM backend.

### Why
- Server has only 2GB/1GB RAM → can run 3-4 worker processes max
- Processing tens of thousands of backstories is too slow with 3-4 sequential workers
- LLM calls are I/O-bound (500ms–30s wait) → perfect for async concurrency
- One async worker with concurrency=30 ≈ 30 sync workers in throughput

### Constraint
Questions within a single task (backstory) MUST remain sequential due to context accumulation — Q2 needs Q1's answer. Only different tasks can run in parallel.

## Technical Approach

### Architecture Change

```
BEFORE (sync):                    AFTER (async):
Worker 1: [task] → [task] → ...  Worker 1: [task1] ─┐
Worker 2: [task] → [task] → ...           [task2] ─┼─ up to N concurrent
Worker 3: [task] → [task] → ...           [task3] ─┤
                                           ...     ─┘
= 3 concurrent LLM calls         = N concurrent LLM calls (N=10..100)
```

### Core Changes

**1. RabbitMQ consumer: pika → aio-pika** (`queue.py`)
- Replace `pika.BlockingConnection` with `aio_pika.connect_robust()`
- Async message iterator instead of blocking callback
- Set `prefetch_count = MAX_CONCURRENT_TASKS` so RabbitMQ delivers enough messages
- Manual async ack/nack

**2. LLM clients: sync → async** (`llm.py`)
- Add `async complete()` methods to `OpenRouterClient` and `VLLMClient`
- Replace `httpx.Client` with `httpx.AsyncClient` (shared session per client for connection pooling)
- Keep the same retry/backoff logic, just async
- Parser LLM (`parser.py`) also needs async

**3. Worker: sync → async** (`worker.py`)
- `process_task()` → `async def process_task()`
- `process_questions_in_series()` → `async def process_questions_in_series()`
- Internal question loop stays sequential (await each LLM call before next)

**4. Main loop: blocking → asyncio** (`main.py`)
- `asyncio.run(main())` entry point
- `asyncio.Semaphore(MAX_CONCURRENT_TASKS)` to limit concurrency
- Each consumed message spawns an `asyncio.Task` (gated by semaphore)
- Graceful shutdown: wait for in-flight tasks to complete on SIGINT/SIGTERM

**5. DB calls: use `asyncio.to_thread()`** (`worker.py`)
- Supabase client remains sync (calls are fast, 10-50ms)
- Wrap in `asyncio.to_thread()` to avoid blocking the event loop
- No need to rewrite the entire DB layer

**6. Latency metrics** (`metrics.py` — new)
- Simple in-memory tracker: records each LLM call duration
- Calculates p50, p95, p99 over a sliding window
- Logs summary every N seconds (configurable)
- Used by benchmark script AND by worker at runtime

### Files to Create
- `worker/scripts/benchmark.py` — Standalone benchmark script
- `worker/src/metrics.py` — Latency tracking utility

### Files to Modify
- `worker/src/queue.py` — pika → aio-pika (consumer only; publisher stays sync for dispatcher)
- `worker/src/llm.py` — Add async `complete()` to both clients
- `worker/src/parser.py` — Async parse method
- `worker/src/worker.py` — Async `process_task()` and `process_questions_in_series()`
- `worker/main.py` — Async main loop with semaphore-gated task spawning
- `worker/src/config.py` — Add `MAX_CONCURRENT_TASKS` env var
- `worker/requirements.txt` — Add `aio-pika`, keep `pika` (still used by publisher/dispatcher)

### Files NOT Modified
- `worker/src/dispatcher.py` — Stays sync (runs as separate process, uses QueuePublisher which stays sync)
- `worker/src/db.py` — Stays sync (wrapped with `to_thread` at call sites)
- `worker/src/prompt.py` — Pure functions, no I/O
- Frontend — No changes

### Key Decisions
- **aio-pika over threaded pika**: pika channels are not thread-safe; aio-pika is the official async RabbitMQ client for Python
- **httpx.AsyncClient over aiohttp**: Already using httpx sync, minimal API change
- **to_thread for DB**: Supabase calls are fast and infrequent compared to LLM calls; full async DB migration is not worth the complexity
- **Keep publisher sync**: Dispatcher is a separate process and doesn't need async
- **Fixed concurrency with env var**: Simple, deterministic, easy to tune after benchmarking

## Part 1: Benchmark Script

### `worker/scripts/benchmark.py`

Standalone script that measures LLM backend capacity at different concurrency levels.

**Usage:**
```bash
# Benchmark vLLM
python scripts/benchmark.py \
  --provider vllm \
  --endpoint http://gpu-server:8000/v1 \
  --model meta-llama/Llama-3-70b \
  --concurrency 1,5,10,20,50,100 \
  --requests-per-level 50

# Benchmark OpenRouter
python scripts/benchmark.py \
  --provider openrouter \
  --api-key $OPENROUTER_API_KEY \
  --model anthropic/claude-3-haiku \
  --concurrency 1,5,10,20,50 \
  --requests-per-level 30
```

**What it does:**
1. For each concurrency level:
   - Fire N concurrent requests (using a realistic short prompt + MCQ question)
   - Record individual latencies
   - Calculate: throughput (req/s), p50, p95, p99
2. Output a table + recommendation:
```
Concurrency | Throughput | p50    | p95    | p99    | Status
----------- | ---------- | ------ | ------ | ------ | ------
1           | 1.2 req/s  | 820ms  | 850ms  | 860ms  | OK
5           | 5.8 req/s  | 840ms  | 920ms  | 980ms  | OK
10          | 11.1 req/s | 870ms  | 1.1s   | 1.3s   | OK
20          | 19.5 req/s | 950ms  | 1.8s   | 2.5s   | OK
50          | 38.2 req/s | 1.2s   | 3.5s   | 5.2s   | WARN ← p99 > 2x baseline
100         | 42.1 req/s | 2.1s   | 8.3s   | 15s    | OVERLOAD ← throughput plateaued

Recommendation: MAX_CONCURRENT_TASKS=20 (best throughput before degradation)
```

**Detection logic:**
- `OK`: p99 < 2x baseline p99
- `WARN`: p99 >= 2x baseline p99 (degrading)
- `OVERLOAD`: throughput stopped increasing OR p99 >= 5x baseline

**Prompt used for benchmark:**
- Short backstory (~200 tokens) + 1 MCQ question with 4 options
- For vLLM: uses Completions API with guided decoding (matches real workload)
- For OpenRouter: uses Chat API with structured output (matches real workload)

## Part 2: Async Worker

### Config Changes

New env var in `worker/src/config.py`:
```
MAX_CONCURRENT_TASKS=10    # Default: 10 (conservative, tune with benchmark)
```

### main.py Async Loop

```python
async def main():
    config = get_config()
    semaphore = asyncio.Semaphore(config.worker.max_concurrent_tasks)
    tasks: set[asyncio.Task] = set()

    async def handle_message(message: aio_pika.IncomingMessage):
        async with semaphore:
            # ... process task (async)
            await message.ack()

    async for message in queue:
        task = asyncio.create_task(handle_message(message))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
```

### Graceful Shutdown

On SIGINT/SIGTERM:
1. Stop accepting new messages from RabbitMQ
2. Wait for all in-flight tasks to complete (with timeout)
3. Nack any unfinished tasks (they'll be redelivered)
4. Exit

### LLM Async Pattern

```python
class OpenRouterClient(BaseLLMClient):
    def __init__(self, ...):
        # Shared async client for connection pooling
        self._async_client: Optional[httpx.AsyncClient] = None

    async def async_complete(self, prompt, ...) -> LLMResponse:
        if not self._async_client:
            self._async_client = httpx.AsyncClient(timeout=self.timeout)
        # Same logic as sync, but with await
        response = await self._async_client.post(...)
        ...

    async def close(self):
        if self._async_client:
            await self._async_client.aclose()
```

### Runtime Metrics Logging

Every 30 seconds (configurable), log:
```
[metrics] window=30s | processed=45 | throughput=1.5/s | p50=820ms | p95=1.3s | p99=2.1s | in_flight=10/20
```

This gives observability without the complexity of adaptive concurrency.

## Pass Criteria

### Unit Tests

- [ ] `test_benchmark_latency_tracker`: LatencyTracker correctly calculates p50/p95/p99 from recorded durations
- [ ] `test_benchmark_status_detection`: Correctly classifies OK/WARN/OVERLOAD based on baseline p99
- [ ] `test_async_queue_consumer`: aio-pika consumer calls handler for each message, respects prefetch
- [ ] `test_async_llm_openrouter`: AsyncClient makes correct HTTP request, parses response
- [ ] `test_async_llm_vllm`: AsyncClient makes correct request with guided decoding params
- [ ] `test_async_worker_process_task`: Async process_task follows claim→process→complete flow
- [ ] `test_async_worker_sequential_questions`: Questions within a task are processed sequentially (not parallel)
- [ ] `test_async_worker_concurrent_tasks`: Multiple tasks run concurrently (semaphore-gated)
- [ ] `test_async_graceful_shutdown`: In-flight tasks complete before shutdown; pending messages are nacked
- [ ] `test_async_error_handling`: RetryableError/NonRetryableError still handled correctly in async flow
- [ ] `test_metrics_logging`: Metrics summary logged at configured interval with correct values
- [ ] `test_config_max_concurrent`: MAX_CONCURRENT_TASKS loaded from env with default=10

### E2E Tests (Manual / Integration)

- [ ] Worker starts, connects to RabbitMQ, and begins consuming
- [ ] Dispatching 50 tasks results in N concurrent LLM calls (not 1 at a time)
- [ ] All tasks complete correctly with valid results stored in DB
- [ ] Graceful shutdown on Ctrl+C: in-flight tasks finish, unprocessed tasks stay in queue
- [ ] Worker with vLLM backend processes tasks correctly
- [ ] Worker with OpenRouter backend processes tasks correctly
- [ ] Benchmark script runs against vLLM and produces a table with recommendation

### Acceptance Criteria

- [ ] Single worker process handles MAX_CONCURRENT_TASKS tasks simultaneously
- [ ] Questions within each task are still processed sequentially (context accumulation preserved)
- [ ] Existing atomic task claiming (PR #7) still prevents duplicate processing
- [ ] Task error handling (retry/fail) works the same as sync version
- [ ] Benchmark script can test both vLLM and OpenRouter backends
- [ ] Benchmark outputs a clear table with throughput + p50/p95/p99 per concurrency level
- [ ] Runtime metrics are logged periodically (throughput, p50, p95, p99, in-flight count)
- [ ] Dispatcher (`dispatcher.py`) continues to work unchanged
- [ ] No breaking changes to DB schema or RPC functions

## Implementation Notes

### For the Implementing Agent

- Start with Part 1 (benchmark script + metrics.py) — it's standalone and useful immediately
- For Part 2, convert bottom-up: llm.py → parser.py → worker.py → queue.py → main.py
- Run existing unit tests after each file conversion to catch regressions
- The `BaseLLMClient` abstract class needs an `async_complete` abstract method added
- Keep the sync `complete()` method too — dispatcher's publisher still uses sync pika
- `httpx.AsyncClient` should be a shared instance (connection pooling), not created per request
- For DB calls, wrap each call: `result = await asyncio.to_thread(self.db.some_method, args)`
- aio-pika uses `async with message.process():` for auto ack/nack — but we want manual control since we ack only after task completion
- Prefetch count should equal MAX_CONCURRENT_TASKS (so RabbitMQ sends enough work)

### Dependencies to Add
```
aio-pika>=9.0.0    # Async RabbitMQ client
```
Keep `pika` — still needed by `QueuePublisher` in `dispatcher.py`.

### Test Data
- Benchmark script includes a built-in test prompt (short backstory + 1 MCQ)
- Unit tests use mocked async HTTP responses
- For integration testing, use the existing test_run.py pattern

## Out of Scope
- Adaptive concurrency (auto-adjust based on runtime p99) — future enhancement
- Async DB client (supabase async) — not needed, calls are fast
- Async dispatcher — separate process, stays sync
- Frontend changes — none needed
- DB schema changes — none needed
