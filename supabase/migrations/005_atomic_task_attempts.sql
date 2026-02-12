-- Atomic increment for task attempts
-- This migration adds an RPC function for atomic increment of task attempts

-- Function to atomically increment task attempts and return new value
CREATE OR REPLACE FUNCTION increment_task_attempts(task_id UUID)
RETURNS INTEGER AS $$
DECLARE
    new_attempts INTEGER;
BEGIN
    UPDATE survey_tasks
    SET attempts = attempts + 1
    WHERE id = task_id
    RETURNING attempts INTO new_attempts;

    RETURN new_attempts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION increment_task_attempts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_task_attempts(UUID) TO service_role;
