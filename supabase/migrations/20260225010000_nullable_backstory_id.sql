-- Allow survey_tasks.backstory_id to be NULL
-- Required for zero_shot_baseline runs which create tasks without a backstory
ALTER TABLE survey_tasks
  ALTER COLUMN backstory_id DROP NOT NULL;
