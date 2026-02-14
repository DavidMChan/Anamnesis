-- Add queued_at column to track when tasks are dispatched to RabbitMQ
-- This prevents the dispatcher from re-dispatching tasks that are already in the queue

ALTER TABLE survey_tasks
ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;

-- Add index for efficient stale task queries
CREATE INDEX IF NOT EXISTS idx_survey_tasks_queued_status
ON survey_tasks (survey_run_id, status, queued_at)
WHERE status = 'queued';

-- Add 'queued' as valid status (between 'pending' and 'processing')
-- Task lifecycle: pending -> queued -> processing -> completed/failed
COMMENT ON COLUMN survey_tasks.status IS 'Task status: pending (new), queued (in RabbitMQ), processing (worker handling), completed, failed';
