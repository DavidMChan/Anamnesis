-- Update rerun_demographic_survey to accept an optional llm_config override.
-- If p_llm_config is provided, it replaces the previous run's config.
-- If NULL, the previous run's config is reused (original behavior).

CREATE OR REPLACE FUNCTION rerun_demographic_survey(
  p_survey_id  UUID,
  p_llm_config JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_demographic_key TEXT;
  v_llm_config      JSONB;
  v_backstory_count INTEGER;
  v_new_run_id      UUID;
BEGIN
  SELECT demographic_key INTO v_demographic_key
  FROM surveys
  WHERE id = p_survey_id AND type = 'demographic';

  IF v_demographic_key IS NULL THEN
    RAISE EXCEPTION 'Survey % is not a demographic survey or does not exist', p_survey_id;
  END IF;

  -- Use provided config, or fall back to most recent run's config
  IF p_llm_config IS NOT NULL THEN
    v_llm_config := p_llm_config;
  ELSE
    SELECT llm_config INTO v_llm_config
    FROM survey_runs
    WHERE survey_id = p_survey_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_llm_config IS NULL THEN
    RAISE EXCEPTION 'No config available for survey %', p_survey_id;
  END IF;

  UPDATE backstories
  SET demographics = demographics - v_demographic_key
  WHERE demographics ? v_demographic_key;

  UPDATE demographic_keys
  SET status = 'running'
  WHERE key = v_demographic_key;

  SELECT COUNT(*) INTO v_backstory_count
  FROM backstories
  WHERE is_public = true AND source_type != 'anthology';

  INSERT INTO survey_runs (
    survey_id, status, total_tasks, completed_tasks, failed_tasks,
    results, error_log, llm_config, demographics
  ) VALUES (
    p_survey_id, 'pending', v_backstory_count, 0, 0,
    '{}', '[]', v_llm_config, '{}'
  )
  RETURNING id INTO v_new_run_id;

  INSERT INTO survey_tasks (survey_run_id, backstory_id, status, attempts)
  SELECT v_new_run_id, id, 'pending', 0
  FROM backstories
  WHERE is_public = true AND source_type != 'anthology';

  RETURN v_new_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
