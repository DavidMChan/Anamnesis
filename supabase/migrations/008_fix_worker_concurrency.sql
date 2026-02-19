-- Fix worker concurrency bugs for multi-worker deployments
--
-- Bugs fixed:
--   P0: CHECK constraint missing 'queued' — dispatcher mark_task_queued() silently fails
--   P0: No idempotency in task claiming — duplicate messages cause re-processing
--   P0: Hot row counter drift — blind +1 counters diverge from actual task states
--   P1: store_result not atomic — result and status updates are separate calls
--
-- New RPCs: claim_task, complete_task, fail_task
-- Modified: check_run_completion (now derives counts from survey_tasks)

-- 1. Fix CHECK constraint to include 'queued'
ALTER TABLE survey_tasks DROP CONSTRAINT IF EXISTS survey_tasks_status_check;
ALTER TABLE survey_tasks ADD CONSTRAINT survey_tasks_status_check
    CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed'));

-- 2. Atomic task claiming (idempotent — safe for duplicate messages)
CREATE OR REPLACE FUNCTION claim_task(p_task_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    claimed BOOLEAN;
BEGIN
    UPDATE survey_tasks
    SET status = 'processing', attempts = attempts + 1
    WHERE id = p_task_id AND status IN ('pending', 'queued')
    RETURNING TRUE INTO claimed;

    RETURN COALESCE(claimed, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Atomic task completion (result + status in one call)
CREATE OR REPLACE FUNCTION complete_task(p_task_id UUID, p_result JSONB)
RETURNS BOOLEAN AS $$
DECLARE
    done BOOLEAN;
BEGIN
    UPDATE survey_tasks
    SET status = 'completed', result = p_result, processed_at = NOW()
    WHERE id = p_task_id AND status = 'processing'
    RETURNING TRUE INTO done;

    RETURN COALESCE(done, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Atomic task failure (error + status in one call)
CREATE OR REPLACE FUNCTION fail_task(p_task_id UUID, p_error TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    done BOOLEAN;
BEGIN
    UPDATE survey_tasks
    SET status = 'failed', error = p_error, processed_at = NOW()
    WHERE id = p_task_id AND status = 'processing'
    RETURNING TRUE INTO done;

    RETURN COALESCE(done, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Replace check_run_completion — derive counts from survey_tasks (source of truth)
--    This fixes counter drift: completed_tasks/failed_tasks are now always accurate.
CREATE OR REPLACE FUNCTION check_run_completion(run_id UUID)
RETURNS void AS $$
DECLARE
    v_total INTEGER;
    v_completed INTEGER;
    v_failed INTEGER;
BEGIN
    SELECT total_tasks INTO v_total FROM survey_runs WHERE id = run_id;

    SELECT
        COUNT(*) FILTER (WHERE status = 'completed'),
        COUNT(*) FILTER (WHERE status = 'failed')
    INTO v_completed, v_failed
    FROM survey_tasks WHERE survey_run_id = run_id;

    -- Sync counters with actual counts
    UPDATE survey_runs
    SET completed_tasks = v_completed, failed_tasks = v_failed
    WHERE id = run_id;

    -- Mark run as done if all tasks are terminal
    IF v_completed + v_failed >= v_total THEN
        UPDATE survey_runs
        SET
            status = CASE
                WHEN v_failed > 0 AND v_completed = 0 THEN 'failed'
                ELSE 'completed'
            END,
            completed_at = NOW()
        WHERE id = run_id AND status = 'running';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Grant permissions
GRANT EXECUTE ON FUNCTION claim_task(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_task(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fail_task(UUID, TEXT) TO authenticated, service_role;
