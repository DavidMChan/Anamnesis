-- Cancel survey run support + update check_run_completion for cancelled tasks
--
-- Changes:
--   1. Add 'cancelled' to survey_tasks status check constraint
--   2. New cancel_run RPC: atomically cancel run + remaining tasks
--   3. Update check_run_completion to account for cancelled tasks

-- 1. Add 'cancelled' as valid task status
ALTER TABLE survey_tasks DROP CONSTRAINT IF EXISTS survey_tasks_status_check;
ALTER TABLE survey_tasks ADD CONSTRAINT survey_tasks_status_check
    CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'));

-- 2. Atomic cancel_run RPC
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

GRANT EXECUTE ON FUNCTION cancel_run(UUID) TO authenticated, service_role;

-- 3. Update check_run_completion to count cancelled tasks as terminal
CREATE OR REPLACE FUNCTION check_run_completion(run_id UUID)
RETURNS void AS $$
DECLARE
    v_total INTEGER;
    v_completed INTEGER;
    v_failed INTEGER;
    v_cancelled INTEGER;
    v_run_status TEXT;
BEGIN
    SELECT total_tasks, status INTO v_total, v_run_status FROM survey_runs WHERE id = run_id;

    -- Skip if run is already cancelled (cancel_run sets status directly)
    IF v_run_status = 'cancelled' THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE status = 'completed'),
        COUNT(*) FILTER (WHERE status = 'failed'),
        COUNT(*) FILTER (WHERE status = 'cancelled')
    INTO v_completed, v_failed, v_cancelled
    FROM survey_tasks WHERE survey_run_id = run_id;

    -- Sync counters with actual counts
    UPDATE survey_runs
    SET completed_tasks = v_completed, failed_tasks = v_failed
    WHERE id = run_id;

    -- Mark run as done if all tasks are terminal
    IF v_completed + v_failed + v_cancelled >= v_total THEN
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
