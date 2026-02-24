-- RPC: retry_task
-- Resets a single failed task back to 'pending' so the dispatcher re-queues it.
-- Also resets the run to 'running' if it was in a terminal state,
-- so the dispatcher picks it up again.

CREATE OR REPLACE FUNCTION retry_task(p_task_id UUID)
RETURNS VOID AS $$
DECLARE
    v_run_id UUID;
BEGIN
    -- Only act on failed tasks; get the run_id at the same time
    SELECT survey_run_id INTO v_run_id
    FROM survey_tasks
    WHERE id = p_task_id AND status = 'failed';

    IF v_run_id IS NULL THEN
        RETURN; -- task not found or not in failed state
    END IF;

    -- Reset the task
    UPDATE survey_tasks
    SET status = 'pending', error = NULL, processed_at = NULL, attempts = 0
    WHERE id = p_task_id;

    -- Bring the run back to 'running' so the dispatcher picks it up
    UPDATE survey_runs
    SET status = 'running', completed_at = NULL
    WHERE id = v_run_id
      AND status IN ('completed', 'failed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION retry_task(UUID) TO authenticated, service_role;
