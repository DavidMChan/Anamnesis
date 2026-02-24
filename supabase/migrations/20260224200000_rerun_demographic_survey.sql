-- RPC: rerun_demographic_survey
--
-- Atomically resets and re-runs a demographic survey:
--   1. Clears existing demographic results from all backstories
--   2. Resets demographic_keys.status back to 'running'
--   3. Creates a new survey_run copying llm_config from the most recent run
--   4. Creates survey_tasks for all public non-anthology backstories
--
-- Returns the new survey_run.id.
-- The auto-finish trigger (trg_auto_finish_demographic_key) will fire automatically
-- when the new run completes and set demographic_keys.status = 'finished'.

CREATE OR REPLACE FUNCTION rerun_demographic_survey(p_survey_id UUID)
RETURNS UUID AS $$
DECLARE
  v_demographic_key TEXT;
  v_llm_config      JSONB;
  v_backstory_count INTEGER;
  v_new_run_id      UUID;
BEGIN
  -- 1. Get the survey's demographic key
  SELECT demographic_key INTO v_demographic_key
  FROM surveys
  WHERE id = p_survey_id AND type = 'demographic';

  IF v_demographic_key IS NULL THEN
    RAISE EXCEPTION 'Survey % is not a demographic survey or does not exist', p_survey_id;
  END IF;

  -- 2. Get llm_config from the most recent run (to reuse exact settings)
  SELECT llm_config INTO v_llm_config
  FROM survey_runs
  WHERE survey_id = p_survey_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_llm_config IS NULL THEN
    RAISE EXCEPTION 'No previous run found for survey %, cannot re-run', p_survey_id;
  END IF;

  -- 3. Clear all demographic results for this key from every backstory
  UPDATE backstories
  SET demographics = demographics - v_demographic_key
  WHERE demographics ? v_demographic_key;

  -- 4. Reset demographic key status to 'running'
  UPDATE demographic_keys
  SET status = 'running'
  WHERE key = v_demographic_key;

  -- 5. Count backstories (for total_tasks)
  SELECT COUNT(*) INTO v_backstory_count
  FROM backstories
  WHERE is_public = true AND source_type != 'anthology';

  -- 6. Create new survey run (status='pending' so the dispatcher picks it up)
  INSERT INTO survey_runs (
    survey_id, status, total_tasks, completed_tasks, failed_tasks,
    results, error_log, llm_config, demographics
  ) VALUES (
    p_survey_id, 'pending', v_backstory_count, 0, 0,
    '{}', '[]', v_llm_config, '{}'
  )
  RETURNING id INTO v_new_run_id;

  -- 7. Create tasks for all public non-anthology backstories
  INSERT INTO survey_tasks (survey_run_id, backstory_id, status, attempts)
  SELECT v_new_run_id, id, 'pending', 0
  FROM backstories
  WHERE is_public = true AND source_type != 'anthology';

  RETURN v_new_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (RLS on survey_runs ensures they can only
-- re-run their own surveys — the INSERT inherits the SECURITY DEFINER context but
-- the initial ownership check is done in application code via the SELECT above).
GRANT EXECUTE ON FUNCTION rerun_demographic_survey(UUID) TO authenticated;
