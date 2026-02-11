-- Migration: Add new source_type values (anthology, alterity)
-- These are used by the import_backstories.py script to bulk-import
-- HuggingFace datasets into the backstories table.

-- Drop existing check constraint and add new one with additional values
ALTER TABLE backstories DROP CONSTRAINT backstories_source_type_check;

ALTER TABLE backstories ADD CONSTRAINT backstories_source_type_check
  CHECK (source_type IN ('llm_generated', 'human_interview', 'uploaded', 'anthology', 'alterity'));

COMMENT ON COLUMN backstories.source_type IS
  'Source: llm_generated, human_interview, uploaded, anthology, alterity';
