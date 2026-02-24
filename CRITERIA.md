# Feature: Optimize Dispatcher DB Queries

## Problem

The dispatcher polls every 2 seconds. Each poll cycle executes **N+1 queries** — one to fetch all active runs, then 4-7 additional queries per run plus one UPDATE per dispatched task. With 10 concurrent runs this means 50-70+ queries every 2 seconds, which exhausts Supabase resources and causes 524 timeouts.

### Current N+1 Pattern (per poll cycle)

```
# 1 query
get_runs_needing_dispatch()        → SELECT * FROM survey_runs WHERE status IN ('pending','running')

for run in runs:                   # N runs
    # dispatch_run() — per run:
    get_in_flight_count(run_id)    → SELECT count(*) FROM survey_tasks WHERE run_id=... AND status IN ('queued','processing')
    get_pending_tasks_for_dispatch → SELECT id,backstory_id FROM survey_tasks WHERE run_id=... AND status='pending'
    mark_task_queued(task_id)      → UPDATE survey_tasks SET status='queued' WHERE id=...  (× per task!)

    # poll_and_dispatch() — per run:
    check_run_completion(run_id)   → RPC call
    get_run_status(run_id)         → SELECT status FROM survey_runs WHERE id=...       ← REDUNDANT
    get_survey_type(run_id)        → SELECT surveys(type) FROM survey_runs WHERE id=... ← REDUNDANT
    get_survey_run(run_id)         → SELECT * FROM survey_runs WHERE id=...             ← REDUNDANT
```

**Total per cycle: 1 + N×(3 + tasks_dispatched) + N×4 ≈ 7N + 1 queries**

## Changes

All changes are in `worker/src/dispatcher.py` and `worker/src/db.py`.

### 1. Eliminate redundant queries in poll loop

**File:** `worker/src/dispatcher.py` — `poll_and_dispatch()`

After `check_run_completion()`, the loop calls `get_run_status()`, `get_survey_type()`, and `get_survey_run()` to check if the run just finished and handle demographic survey completion. But:

- `get_run_status()` — can be kept as a single re-fetch (RPC updated status server-side, need to read it back)
- `get_survey_type()` — redundant if we fetch it in the initial query
- `get_survey_run()` — redundant, we already have `run["survey_id"]` from the initial fetch

**Fix:** Change `get_runs_needing_dispatch()` to `select("id, status, survey_id, llm_config, surveys(type)")` so `survey_type` is available from the initial fetch. After `check_run_completion()`, only call `get_run_status()` (1 query instead of 3). Use `run["survey_id"]` directly.

### 2. Batch `mark_task_queued` UPDATE

**File:** `worker/src/db.py`

Currently `mark_task_queued(task_id)` is called once per task inside a loop. If 20 tasks are dispatched per run, that's 20 UPDATE queries.

**Fix:** Add `mark_tasks_queued(task_ids: List[str])` that does a single UPDATE with `.in_("id", task_ids)`. Update `dispatcher.py` to:
1. Batch mark all tasks as queued first (1 query)
2. Then publish each to RabbitMQ
3. If a publish fails, revert that single task to pending

### 3. Adaptive poll interval

**File:** `worker/src/dispatcher.py`

Currently polls every 2 seconds regardless of activity.

**Fix:**
- Idle (no pending/running runs found): poll every 5 seconds
- Active (runs exist but nothing dispatched this cycle): poll every 3 seconds
- Busy (tasks were dispatched this cycle): poll every 1 second

### 4. Bug fix: undefined `old_status` variable

**File:** `worker/src/dispatcher.py` line 126

```python
if new_status in ("completed", "failed") and old_status == "running":
```

`old_status` is never defined. Should use `run.get("status")` (the status from the initial fetch, before `check_run_completion` RPC may have changed it).

## Query Count After Fix

```
# 1 query (with join)
get_runs_needing_dispatch()        → SELECT id,status,survey_id,llm_config,surveys(type) FROM survey_runs WHERE ...

for run in runs:                   # N runs
    get_in_flight_count(run_id)    → 1 query
    get_pending_tasks_for_dispatch → 1 query
    mark_tasks_queued(task_ids)    → 1 query (batch, was M queries)
    check_run_completion(run_id)   → 1 RPC
    get_run_status(run_id)         → 1 query
                                     # get_survey_type: ELIMINATED (from initial fetch)
                                     # get_survey_run: ELIMINATED (use run dict)
```

**Total per cycle: 1 + N×5 ≈ 5N + 1 queries** (down from 7N + M + 1)

## Pass Criteria

- [ ] `get_runs_needing_dispatch()` selects only needed columns with `surveys(type)` join
- [ ] `poll_and_dispatch()` no longer calls `get_survey_type()` or `get_survey_run()` — uses data from initial fetch
- [ ] `mark_tasks_queued(task_ids)` batch method exists and is used instead of per-task calls
- [ ] `old_status` bug on line 126 is fixed
- [ ] Poll interval adapts based on activity level
- [ ] Existing worker tests still pass (`worker/tests/`)
- [ ] No functional change — dispatcher still correctly dispatches tasks, marks runs complete, and handles demographic survey finalization
