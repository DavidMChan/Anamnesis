-- Add per-survey LLM settings (temperature, max_tokens)
-- These are nullable: null means "use provider default"
ALTER TABLE surveys ADD COLUMN temperature NUMERIC;
ALTER TABLE surveys ADD COLUMN max_tokens INTEGER;
