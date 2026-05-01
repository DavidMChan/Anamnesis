-- Adaptive sampling: mark a run complete once remaining work is unnecessary.
--
-- This differs from cancel_run: the run is considered successfully completed,
-- while unfinished tasks are cancelled so queued/in-flight messages do not add
-- extra results after the stopping decision.

DROP FUNCTION IF EXISTS complete_run_early(UUID);

CREATE OR REPLACE FUNCTION complete_run_early(
  p_run_id UUID,
  p_stop_summary JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID AS $$
DECLARE
  v_completed INTEGER;
  v_failed INTEGER;
  v_summary JSONB;
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

  v_summary = COALESCE(p_stop_summary, '{}'::JSONB) || jsonb_build_object('stopped_at', NOW());

  UPDATE survey_runs
  SET
    status = CASE
      WHEN v_failed > 0 AND v_completed = 0 THEN 'failed'
      ELSE 'completed'
    END,
    total_tasks = v_completed + v_failed,
    completed_tasks = v_completed,
    failed_tasks = v_failed,
    llm_config = jsonb_set(
      COALESCE(llm_config, '{}'::JSONB),
      '{adaptive_sampling,stop_summary}',
      v_summary,
      true
    ),
    completed_at = NOW()
  WHERE id = p_run_id
    AND status IN ('pending', 'running');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_run_early(UUID, JSONB) TO authenticated, service_role;
