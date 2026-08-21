-- RPC: retry_all_failed_tasks
-- Resets every failed task in a run back to 'pending' in one round trip, so
-- the client doesn't have to retry tasks one at a time. Also brings the run
-- back to 'running' if it had finished, so the dispatcher picks it up again.

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
    END IF;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION retry_all_failed_tasks(UUID) TO authenticated, service_role;
