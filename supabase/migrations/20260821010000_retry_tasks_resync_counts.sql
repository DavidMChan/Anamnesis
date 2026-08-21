-- Fix retry_task / retry_all_failed_tasks: resync survey_runs.completed_tasks
-- and failed_tasks after resetting tasks to 'pending'.
--
-- Both previously only touched survey_tasks — the run's cached counters
-- (completed_tasks/failed_tasks, synced by check_run_completion whenever a
-- task finishes) never got recalculated, so the UI kept showing the old
-- failed count until some other task in the run happened to complete.

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

    -- Resync the run's cached counters now that one fewer task is failed
    PERFORM check_run_completion(v_run_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION retry_all_failed_tasks(p_run_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE survey_tasks
    SET status = 'pending', error = NULL, processed_at = NULL, attempts = 0
    WHERE survey_run_id = p_run_id AND status = 'failed';

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        UPDATE survey_runs
        SET status = 'running', completed_at = NULL
        WHERE id = p_run_id
          AND status IN ('completed', 'failed');

        PERFORM check_run_completion(p_run_id);
    END IF;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION retry_task(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION retry_all_failed_tasks(UUID) TO authenticated, service_role;
