-- Add unified llm_config JSONB column to surveys, replacing standalone temperature/max_tokens columns

-- 1. Add new unified column
ALTER TABLE surveys ADD COLUMN llm_config JSONB;

-- 2. Migrate existing temperature/max_tokens data
UPDATE surveys
SET llm_config = jsonb_strip_nulls(jsonb_build_object(
  'temperature', temperature,
  'max_tokens', max_tokens
))
WHERE temperature IS NOT NULL OR max_tokens IS NOT NULL;

-- 3. Drop old columns (absorbed into llm_config)
ALTER TABLE surveys DROP COLUMN temperature;
ALTER TABLE surveys DROP COLUMN max_tokens;
