# Feature: UX Improvements — Cancel Survey Run + Configurable Concurrency

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description

Two related UX improvements for the survey runner:

1. **Cancel Survey Run**: Users can stop a running survey to avoid wasting hours on a misconfigured run. A "Stop" button appears during active runs. The worker skips queued tasks for cancelled runs and lets in-flight tasks finish naturally.

2. **Configurable Concurrency**: Users set their `max_concurrent_tasks` on the Settings page (instead of a hardcoded env var). This value is snapshotted per survey run and the **dispatcher** enforces per-run concurrency by only pushing that many tasks into RabbitMQ at a time. The worker semaphore is removed entirely — concurrency is controlled at the source, not the consumer, so it works correctly regardless of how many worker instances are running.

---

## Part 1: Cancel Survey Run

### Technical Approach

#### Files to Modify

**Frontend:**
- `frontend/src/components/surveys/SurveyRunProgress.tsx` — Add "Stop Run" button with confirmation dialog
- `frontend/src/pages/SurveyView.tsx` — Wire up cancel callback to `SurveyRunProgress`
- `frontend/src/lib/surveyRunner.ts` — Enhance `cancelSurveyRun()` to call new RPC

**Worker:**
- `worker/main.py` — In `handle_message()`, check run status before processing; skip cancelled runs
- `worker/src/db.py` — Add `get_run_status(run_id)` method

**Database:**
- New migration — Add `cancel_run(run_id)` RPC function that atomically: sets run status to 'cancelled', sets completed_at, and marks all pending/queued tasks as 'cancelled'

### Detailed Changes

#### 1. Database: New `cancel_run` RPC (new migration)

```sql
CREATE OR REPLACE FUNCTION cancel_run(p_run_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Cancel the run
  UPDATE survey_runs
  SET status = 'cancelled', completed_at = NOW()
  WHERE id = p_run_id AND status IN ('pending', 'running');

  -- Cancel remaining tasks (pending/queued only, not processing)
  UPDATE survey_tasks
  SET status = 'cancelled'
  WHERE survey_run_id = p_run_id AND status IN ('pending', 'queued');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

This is atomic — no race between cancelling run and cancelling tasks.

Also need to add 'cancelled' to the `survey_tasks.status` check constraint (currently only allows: pending, queued, processing, completed, failed).

#### 2. Frontend: `cancelSurveyRun()` enhancement

Replace the current implementation in `surveyRunner.ts` to call the RPC:

```typescript
export async function cancelSurveyRun(runId: string): Promise<boolean> {
  const { error } = await supabase.rpc('cancel_run', { p_run_id: runId })
  return !error
}
```

#### 3. Frontend: "Stop Run" button in `SurveyRunProgress.tsx`

- Show a red "Stop Run" button when `run.status === 'running' || run.status === 'pending'`
- Clicking shows a confirmation dialog: "Stop this survey run? Tasks already in progress will finish, but no new tasks will be started."
- On confirm, call `onCancel()` prop
- Show loading state on button while cancelling
- After cancel, refresh run data

Props change:
```typescript
interface SurveyRunProgressProps {
  run: SurveyRun
  onViewResults?: () => void
  onRunAgain?: () => void
  onCancel?: () => Promise<void>  // NEW
}
```

#### 4. Frontend: Wire up in `SurveyView.tsx`

Pass `onCancel` callback that calls `cancelSurveyRun(run.id)` then refreshes.

#### 5. Worker: Skip cancelled runs in `handle_message()`

After fetching the task (line ~196 in main.py), before calling `start_task()`:

```python
# Check if run is cancelled
run_status = db.get_run_status(task["survey_run_id"])
if run_status in ("cancelled", "completed", "failed"):
    logger.info(f"Skipping task {task_id} — run {task['survey_run_id']} is {run_status}")
    await message.ack()
    return
```

#### 6. Worker db.py: `get_run_status()`

```python
def get_run_status(self, run_id: str) -> Optional[str]:
    data = self._safe_single_execute(
        self.client.table("survey_runs").select("status").eq("id", run_id)
    )
    return data.get("status") if data else None
```

#### 7. Dispatcher: Already handles cancelled runs

The dispatcher only dispatches for `pending`/`running` runs, so cancelled runs are naturally skipped. No changes needed.

### Edge Cases

- **Race condition**: User cancels while dispatcher is mid-dispatch → Some tasks may arrive at worker after cancel. Worker's status check handles this.
- **All tasks already processing**: Cancel sets run status but all in-flight tasks finish. `check_run_completion()` will see the final state. The run stays 'cancelled' because the cancel_run RPC already set it.
- **Double cancel**: Second call is a no-op (WHERE clause filters on status IN pending/running).
- **Cancel during pending (before dispatcher picks it up)**: All tasks are still 'pending' in DB, get bulk-cancelled. No messages in queue. Clean stop.

---

## Part 2: Configurable Concurrency

### Architecture: Dispatcher-Level Throttling

**Why not worker semaphores?** A per-worker semaphore doesn't enforce a global limit. If the user sets `max_concurrent=50` and there are 3 workers, each gets its own semaphore(50), resulting in 150 concurrent LLM calls — not the 50 the user intended.

**Solution:** Move concurrency control to the **dispatcher**, which is a single process and the sole source of messages into RabbitMQ. The dispatcher only pushes tasks up to the run's `max_concurrent_tasks` limit at a time. As tasks complete, slots free up, and the dispatcher fills them on its next poll cycle (every 2s).

```
Dispatcher (single process, polls every 2s):
  For each active run:
    in_flight = count tasks WHERE status IN ('queued', 'processing')
    slots = max_concurrent_tasks - in_flight
    dispatch up to `slots` new pending tasks

       ┌─── only N tasks in queue at a time ───┐
       ▼                                        ▼
    Worker 1 ◄──── RabbitMQ ────► Worker 2 ◄───► Worker 3
    (no semaphore,                (no semaphore)  (no semaphore)
     just processes
     whatever it gets)
```

The worker semaphore (`asyncio.Semaphore`) and `process_with_semaphore()` wrapper are **removed entirely**. Workers process messages directly — no local throttling. The `MAX_CONCURRENT_TASKS` env var and `config.worker.max_concurrent_tasks` are also removed.

### Technical Approach

#### Files to Modify

**Frontend:**
- `frontend/src/pages/Settings.tsx` — Add "Max Concurrent Tasks" number input with guidance text

**Worker (dispatcher):**
- `worker/src/dispatcher.py` — Throttle dispatch per run based on `max_concurrent_tasks` from run's `llm_config`
- `worker/src/db.py` — Add `get_in_flight_count(run_id)` and `get_run_max_concurrent(run_id)` methods

**Worker (consumer — simplify):**
- `worker/main.py` — Remove `semaphore`, `process_with_semaphore()`, and all `max_concurrent` references. Messages go directly to `handle_message()`. Remove `MAX_CONCURRENT_TASKS` from config. Set `prefetch_count` to a fixed reasonable value (e.g., 10) or make it a simple env var for operational tuning (not user-facing).
- `worker/src/config.py` — Remove `max_concurrent_tasks` from `WorkerConfig`

### Detailed Changes

#### 1. Frontend: Settings page — Add concurrency field

Add a number input in the LLM Configuration card, after the parser LLM model field:

```tsx
<div>
  <Label>Max Concurrent Tasks</Label>
  <Input
    type="number"
    min={1}
    max={200}
    value={llmConfig.max_concurrent_tasks || 10}
    onChange={...}
  />
  <p className="text-sm text-muted-foreground mt-1">
    Maximum parallel LLM requests per survey run. Start with 5–10 for cloud APIs
    (OpenAI, Anthropic). For self-hosted vLLM, try 20–100 — increase until you
    see rate-limit errors, then back off.
  </p>
</div>
```

Default value: 10 (matches current hardcoded default).

#### 2. LLMConfig type

Add `max_concurrent_tasks?: number` to the LLMConfig TypeScript type. This field flows through:
- Saved to `users.llm_config` via Settings page
- Merged into per-survey overrides in `SurveyView.tsx` (already merges temperature/max_tokens)
- Snapshotted into `survey_runs.llm_config` at run creation time

No changes needed in `surveyRunner.ts` — it already copies the full `llm_config` into the run.

#### 3. Dispatcher: Throttled dispatch per run

Change `dispatch_run()` in `dispatcher.py` to limit how many tasks it dispatches:

```python
def dispatch_run(self, run: Dict[str, Any]) -> int:
    run_id = run["id"]
    run_status = run.get("status", "pending")

    # Get max_concurrent from the run's llm_config snapshot
    llm_config = run.get("llm_config", {}) or {}
    max_concurrent = llm_config.get("max_concurrent_tasks", 10)

    # Count tasks currently in-flight (queued + processing)
    in_flight = self.db.get_in_flight_count(run_id)
    slots_available = max(0, max_concurrent - in_flight)

    if slots_available == 0:
        return 0

    # Only fetch and dispatch up to slots_available tasks
    tasks = self.db.get_pending_tasks_for_dispatch(run_id, limit=slots_available)
    if not tasks:
        return 0

    dispatched = 0
    for task in tasks:
        try:
            self.db.mark_task_queued(task["id"])
            self.publisher.publish_task(run_id, task["id"])
            dispatched += 1
        except Exception as e:
            self.db.update_task_status(task["id"], "pending")
            logger.error(f"Failed to publish task {task['id']}: {e}")

    if dispatched > 0 and run_status == "pending":
        self.db.update_run_status(run_id, "running")

    return dispatched
```

#### 4. DB: New helpers for dispatcher

```python
def get_in_flight_count(self, run_id: str) -> int:
    """Count tasks that are currently queued or processing for a run."""
    result = (
        self.client.table("survey_tasks")
        .select("id", count="exact")
        .eq("survey_run_id", run_id)
        .in_("status", ["queued", "processing"])
        .execute()
    )
    return result.count or 0

def get_pending_tasks_for_dispatch(self, run_id: str, limit: int = None) -> list:
    """Get pending tasks for a run, optionally limited."""
    query = (
        self.client.table("survey_tasks")
        .select("id, backstory_id")
        .eq("survey_run_id", run_id)
        .eq("status", "pending")
    )
    if limit:
        query = query.limit(limit)
    return query.execute().data or []
```

#### 5. Dispatcher: Fetch `llm_config` in run query

The current `get_runs_needing_dispatch()` does `select("*")` on `survey_runs`, so `llm_config` is already included. No change needed.

#### 6. Worker main.py: Remove semaphore

Remove these:
- `max_concurrent = config.worker.max_concurrent_tasks` (line 104)
- `semaphore = asyncio.Semaphore(max_concurrent)` (line 134)
- `async def process_with_semaphore(message)` (lines 265-273) — entire function
- `config.rabbitmq.prefetch_count = max_concurrent` (line 276)
- Replace `asyncio.create_task(process_with_semaphore(message))` with `asyncio.create_task(handle_message(message))` (line 309)
- Remove `max_concurrent` from log messages and `metrics_logger.maybe_log()` calls

Set `prefetch_count` to a simple fixed value (e.g., `10`) or a separate `PREFETCH_COUNT` env var for operational use.

#### 7. Worker config.py: Remove `max_concurrent_tasks`

Remove `max_concurrent_tasks` from `WorkerConfig`. It's no longer a worker concern.

### Edge Cases

- **User doesn't set concurrency**: Default to 10 (same as current behavior)
- **User sets 0 or negative**: Frontend validates min=1
- **User sets very high value (e.g., 500)**: Allowed — the user controls their own infra costs. No artificial ceiling.
- **Multiple runs from same user**: Each run gets independent throttling
- **Dispatcher polls every 2s**: After a task completes, the next batch is dispatched within ~2s. For LLM calls that take seconds each, this latency is negligible.
- **Mid-run config change**: Doesn't affect running runs (config is snapshotted at run creation)
- **Worker prefetch_count**: Set to a reasonable fixed value. If many runs are active with high concurrency, the queue may buffer more messages. This is fine — RabbitMQ handles it.
- **No in-flight tasks but pending tasks exist**: Dispatcher dispatches up to `max_concurrent` on next poll cycle

---

## Pass Criteria

### Unit Tests

#### Frontend
- [ ] Settings page renders max_concurrent_tasks input with current value from llm_config
- [ ] Settings page saves max_concurrent_tasks to llm_config when form is submitted
- [ ] Settings page validates min=1, max=200 for concurrency input
- [ ] SurveyRunProgress shows "Stop Run" button when run status is 'running'
- [ ] SurveyRunProgress shows "Stop Run" button when run status is 'pending'
- [ ] SurveyRunProgress does NOT show "Stop Run" button when status is 'completed', 'failed', or 'cancelled'
- [ ] SurveyRunProgress "Stop Run" button shows confirmation dialog on click
- [ ] SurveyRunProgress calls onCancel callback after confirmation
- [ ] SurveyRunProgress shows loading state on "Stop Run" button while cancelling

#### Worker (consumer)
- [ ] `get_run_status()` returns correct status string from DB
- [ ] `handle_message()` skips tasks for cancelled runs (ack without processing)
- [ ] `handle_message()` skips tasks for completed/failed runs
- [ ] Worker semaphore is removed — `process_with_semaphore()` no longer exists
- [ ] Messages go directly to `handle_message()` via `asyncio.create_task()`
- [ ] `max_concurrent_tasks` is removed from `WorkerConfig`

#### Worker (dispatcher)
- [ ] `get_in_flight_count(run_id)` returns count of queued + processing tasks
- [ ] `dispatch_run()` reads `max_concurrent_tasks` from run's `llm_config`
- [ ] `dispatch_run()` dispatches at most `max_concurrent - in_flight` tasks
- [ ] `dispatch_run()` defaults to 10 when `max_concurrent_tasks` is not in `llm_config`
- [ ] `dispatch_run()` dispatches 0 tasks when in_flight >= max_concurrent
- [ ] `get_pending_tasks_for_dispatch()` accepts optional `limit` parameter

### E2E Tests

- [ ] User navigates to Settings, changes max_concurrent_tasks, saves, reloads — value persists
- [ ] User starts a survey run → "Stop Run" button appears → clicks it → confirmation dialog shows → confirms → run status changes to 'cancelled' → progress stops updating
- [ ] After cancelling, remaining tasks show as cancelled (not pending/queued)
- [ ] User can start a new run after cancelling a previous one

### Acceptance Criteria

- [ ] "Stop Run" button is visible during pending and running states
- [ ] Confirmation dialog prevents accidental cancellation
- [ ] Cancelled run stops consuming API credits (worker skips queued tasks)
- [ ] In-flight tasks at time of cancel may complete — this is expected and documented
- [ ] Max concurrent tasks field appears on Settings page with guidance text
- [ ] Default concurrency is 10 when user hasn't configured it
- [ ] Per-run concurrency is enforced by the dispatcher (correct regardless of number of workers)
- [ ] Multiple concurrent runs from different users get independent concurrency limits

---

## Implementation Notes

### For the Implementing Agent

**Start with:**
1. Database migration for `cancel_run` RPC + add 'cancelled' to survey_tasks status
2. Dispatcher changes: `get_in_flight_count()`, throttled `dispatch_run()`, `limit` param on `get_pending_tasks_for_dispatch()`
3. Worker simplification: remove semaphore, `process_with_semaphore()`, `max_concurrent_tasks` config
4. Worker cancellation check: `get_run_status()`, skip cancelled runs in `handle_message()`
5. Frontend: Settings page concurrency field, SurveyRunProgress cancel button
6. Write tests alongside each change

**Reference existing patterns in:**
- `worker/src/db.py` — existing RPC call pattern (`start_task`, `complete_task`, `fail_task`)
- `worker/src/dispatcher.py` — existing `dispatch_run()` structure (modify, don't rewrite)
- `frontend/src/pages/Settings.tsx` — existing form field pattern (Label + Input + description)
- `frontend/src/components/surveys/SurveyRunProgress.tsx` — existing button pattern (View Results, Run Again)
- `supabase/migrations/008_fix_worker_concurrency.sql` — existing RPC function pattern

**Don't forget to:**
- Add 'cancelled' as valid task status in the `survey_task_status` check constraint (currently only allows: pending, queued, processing, completed, failed)
- The `cancelSurveyRun()` function already exists in `surveyRunner.ts` — modify it, don't create a duplicate
- The `check_run_completion` function may need to account for 'cancelled' tasks when counting
- Update the `SurveyRun` TypeScript type if `cancelled` isn't already in `SurveyRunStatus`
- The `check_run_completion` RPC currently checks `completed + failed >= total_tasks`. With cancellation, update to: `completed + failed + cancelled_tasks >= total_tasks` (or just skip this for cancelled runs since cancel_run sets the run status directly)
- When removing the semaphore from `main.py`, also remove it from the metrics logger calls (`in_flight` and `max_concurrent` params)
- Keep `in_flight_tasks` set in `main.py` — it's still needed for graceful shutdown (waiting for tasks to finish before exit)
- Set `prefetch_count` to a fixed value (e.g., `10`) or a simple `PREFETCH_COUNT` env var — it's now just an operational knob for RabbitMQ buffering, not a concurrency control

### Migration Naming

Check existing migrations in `supabase/migrations/` for the next sequential number.

## Out of Scope

- **Hard cancellation of in-flight LLM calls** — We let them finish to keep the worker simple
- **Per-user queue isolation** — Overkill for a research tool with few users
- **Per-survey concurrency overrides** — Just use the global user setting for now
- **Auto-tuning concurrency** — No p99 auto-detection; just a static number with guidance text
- **Retry cancelled tasks** — If user wants to re-run, they start a new run
