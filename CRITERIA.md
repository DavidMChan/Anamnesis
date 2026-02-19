# Fix: Worker Concurrency Bugs

## Status
- [x] Planning complete
- [x] Implementation complete
- [ ] Tests passing

## Problem

Running 3+ workers simultaneously caused `completed_tasks` to exceed `total_tasks` (e.g., 2089/1000). Root cause: a chain of bugs that amplified duplicate message processing.

## Bugs Fixed

### P0: CHECK constraint missing 'queued'
- `survey_tasks.status` CHECK only allowed `('pending', 'processing', 'completed', 'failed')`
- Dispatcher's `mark_task_queued()` silently failed → tasks stayed 'pending'
- Dispatcher re-published same tasks every poll cycle → massive message duplication

### P0: No idempotency in task claiming
- `mark_processing()` didn't check current status
- Any duplicate message caused re-processing + counter increment
- **Fix:** Atomic `claim_task()` RPC with `WHERE status IN ('pending', 'queued')`

### P0: Counter drift (hot row)
- `increment_completed_tasks` was blind `+1`, decoupled from actual task states
- **Fix:** `check_run_completion` now derives counts from `survey_tasks` table

### P1: store_result not atomic
- `update_task_result` then `update_task_status` in two separate calls
- **Fix:** Single `complete_task()` RPC with `WHERE status = 'processing'` guard

### P1: fail_task not atomic
- `update_task_error` then `update_task_status` in two separate calls
- **Fix:** Single `fail_task()` RPC with `WHERE status = 'processing'` guard

## Changes

### New: `supabase/migrations/008_fix_worker_concurrency.sql`
- Fix CHECK constraint to include 'queued'
- `claim_task(p_task_id)` → atomic claiming, returns BOOLEAN
- `complete_task(p_task_id, p_result)` → atomic completion, returns BOOLEAN
- `fail_task(p_task_id, p_error)` → atomic failure, returns BOOLEAN
- `check_run_completion(run_id)` → rewritten to derive counts from survey_tasks

### Modified: `worker/src/db.py`
- Added `claim_task()`, `complete_task()`, `fail_task()` methods

### Modified: `worker/src/worker.py`
- `process_task()` claims before processing (skips duplicates)
- `store_result()` uses atomic `complete_task` RPC
- Error paths use atomic `fail_task` RPC
- `update_run_progress()` no longer calls blind counter increments

### Modified: `worker/tests/test_worker.py`
- Tests updated to verify atomic RPC flow (claim → process → complete/fail)
- New tests for duplicate message idempotency

## Pass Criteria

- [ ] `008_fix_worker_concurrency.sql` applies cleanly
- [ ] `claim_task` returns false for already-claimed tasks
- [ ] `complete_task` and `fail_task` are atomic (single UPDATE)
- [ ] `check_run_completion` derives counts from survey_tasks
- [ ] Worker skips duplicate messages without error
- [ ] All unit tests pass (`pytest worker/tests/`)
