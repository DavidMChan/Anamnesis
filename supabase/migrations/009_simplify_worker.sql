-- Simplify worker pipeline
--
-- Changes:
--   1. New start_task RPC (replaces claim_task) — no status guard, returns attempt count
--   2. Drop unused RPCs: claim_task, append_run_result, append_run_error,
--      increment_completed_tasks, increment_failed_tasks, increment_task_attempts

-- 1. New start_task: sets processing + increments attempts, returns count
CREATE OR REPLACE FUNCTION start_task(p_task_id UUID)
RETURNS INTEGER AS $$
DECLARE
    new_attempts INTEGER;
BEGIN
    UPDATE survey_tasks
    SET status = 'processing', attempts = attempts + 1
    WHERE id = p_task_id
    RETURNING attempts INTO new_attempts;
    RETURN COALESCE(new_attempts, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION start_task(UUID) TO authenticated, service_role;

-- 2. Drop unused RPCs
DROP FUNCTION IF EXISTS claim_task(UUID);
DROP FUNCTION IF EXISTS append_run_result(UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS append_run_error(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS increment_completed_tasks(UUID);
DROP FUNCTION IF EXISTS increment_failed_tasks(UUID);
DROP FUNCTION IF EXISTS increment_task_attempts(UUID);
