-- Adaptive sampling: mark a run complete once remaining work is unnecessary.
--
-- This differs from cancel_run: the run is considered successfully completed,
-- while unfinished tasks are cancelled so queued/in-flight messages do not add
-- extra results after the stopping decision.

CREATE OR REPLACE FUNCTION complete_run_early(p_run_id UUID)
RETURNS VOID AS $$
DECLARE
  v_completed INTEGER;
  v_failed INTEGER;
BEGIN
  UPDATE survey_tasks
  SET status = 'cancelled'
  WHERE survey_run_id = p_run_id
    AND status IN ('pending', 'queued', 'processing');

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'failed')
  INTO v_completed, v_failed
  FROM survey_tasks
  WHERE survey_run_id = p_run_id;

  UPDATE survey_runs
  SET
    status = CASE
      WHEN v_failed > 0 AND v_completed = 0 THEN 'failed'
      ELSE 'completed'
    END,
    completed_tasks = v_completed,
    failed_tasks = v_failed,
    completed_at = NOW()
  WHERE id = p_run_id
    AND status IN ('pending', 'running');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_run_early(UUID) TO authenticated, service_role;
