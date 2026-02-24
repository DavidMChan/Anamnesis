-- Demographic Survey: schema changes + RPC functions
--
-- Design:
--   demographic_keys = pure metadata (what dimensions exist)
--   surveys (type='demographic', demographic_key='...') = the survey that populates a key
--   survey_runs.llm_config = execution params (distribution_mode, num_trials)
--   backstories.demographics = where results are written back

-- 1. Alter demographic_keys: only add status + created_by
ALTER TABLE demographic_keys
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'finished'
    CHECK (status IN ('pending', 'running', 'finished', 'failed')),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- 2. Alter surveys: add type + demographic_key
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'survey'
    CHECK (type IN ('survey', 'demographic')),
  ADD COLUMN IF NOT EXISTS demographic_key TEXT REFERENCES demographic_keys(key);

-- 3. RPC: write_demographic_result
-- Writes the distribution + top value back to a backstory's demographics JSONB.
CREATE OR REPLACE FUNCTION write_demographic_result(
  p_backstory_id UUID,
  p_demographic_key TEXT,
  p_value TEXT,
  p_distribution JSONB DEFAULT '{}'
) RETURNS VOID AS $$
  UPDATE backstories
  SET demographics = jsonb_set(
    COALESCE(demographics, '{}'),
    ARRAY[p_demographic_key],
    jsonb_build_object('value', p_value, 'distribution', p_distribution)
  )
  WHERE id = p_backstory_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- 4. RPC: finish_demographic_key
-- Updates demographic_keys.status when a demographic survey run finishes.
-- Looks up the key via surveys.demographic_key.
CREATE OR REPLACE FUNCTION finish_demographic_key(
  p_survey_id UUID,
  p_status TEXT DEFAULT 'finished'
) RETURNS VOID AS $$
  UPDATE demographic_keys
  SET status = p_status
  WHERE key = (SELECT demographic_key FROM surveys WHERE id = p_survey_id);
$$ LANGUAGE sql SECURITY DEFINER;

-- 5. RLS: Allow authenticated users to INSERT into demographic_keys
CREATE POLICY "Authenticated users can insert demographic_keys"
  ON demographic_keys
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 6. RLS: Allow authenticated users to UPDATE their own demographic_keys
CREATE POLICY "Users can update own demographic_keys"
  ON demographic_keys
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid());
