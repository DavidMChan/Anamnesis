-- Add algorithm column to survey_runs
-- Controls how the LLM is prompted per run:
--   'anthology'          → LLM reads a full backstory then answers questions (existing behavior)
--   'zero_shot_baseline' → Short demographic description constructed from run filters, N independent calls

ALTER TABLE survey_runs
  ADD COLUMN algorithm TEXT NOT NULL DEFAULT 'anthology'
  CHECK (algorithm IN ('anthology', 'zero_shot_baseline'));
