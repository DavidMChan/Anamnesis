-- Survey Runs and Tasks Schema
-- This migration adds tables for tracking survey execution runs

-- 1. SURVEY_RUNS table
-- Tracks individual survey execution runs
CREATE TABLE survey_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id       UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    total_tasks     INTEGER NOT NULL DEFAULT 0,
    completed_tasks INTEGER NOT NULL DEFAULT 0,
    failed_tasks    INTEGER NOT NULL DEFAULT 0,
    results         JSONB NOT NULL DEFAULT '{}',
    -- Results format: {backstory_id: {qkey: response, ...}, ...}
    error_log       JSONB DEFAULT '[]',
    -- Error log format: [{backstory_id, error, timestamp}, ...]
    llm_config      JSONB NOT NULL,
    -- Snapshot of LLM config at run time
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. SURVEY_TASKS table
-- Individual task tracking for progress and retry logic
CREATE TABLE survey_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_run_id   UUID NOT NULL REFERENCES survey_runs(id) ON DELETE CASCADE,
    backstory_id    UUID NOT NULL REFERENCES backstories(id),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    result          JSONB,
    -- Result format: {qkey: response, ...} for this backstory
    error           TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,
    UNIQUE(survey_run_id, backstory_id)
);

-- Create indexes for efficient queries
CREATE INDEX idx_survey_runs_survey ON survey_runs(survey_id);
CREATE INDEX idx_survey_runs_status ON survey_runs(status);
CREATE INDEX idx_survey_runs_created ON survey_runs(created_at DESC);

CREATE INDEX idx_survey_tasks_run_status ON survey_tasks(survey_run_id, status);
CREATE INDEX idx_survey_tasks_backstory ON survey_tasks(backstory_id);

-- Enable Row Level Security
ALTER TABLE survey_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for survey_runs
-- Users can view runs for their own surveys
CREATE POLICY "Users can view own survey runs" ON survey_runs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM surveys
            WHERE surveys.id = survey_runs.survey_id
            AND surveys.user_id = auth.uid()
        )
    );

-- Users can create runs for their own surveys
CREATE POLICY "Users can create own survey runs" ON survey_runs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM surveys
            WHERE surveys.id = survey_runs.survey_id
            AND surveys.user_id = auth.uid()
        )
    );

-- Users can update their own survey runs
CREATE POLICY "Users can update own survey runs" ON survey_runs
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM surveys
            WHERE surveys.id = survey_runs.survey_id
            AND surveys.user_id = auth.uid()
        )
    );

-- RLS Policies for survey_tasks
-- Users can view tasks for their own survey runs
CREATE POLICY "Users can view own survey tasks" ON survey_tasks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM survey_runs
            JOIN surveys ON surveys.id = survey_runs.survey_id
            WHERE survey_runs.id = survey_tasks.survey_run_id
            AND surveys.user_id = auth.uid()
        )
    );

-- Service role (worker) needs full access - create policies for service role
-- Note: Service role bypasses RLS by default, but we document intent here

-- Function to increment completed_tasks atomically
CREATE OR REPLACE FUNCTION increment_completed_tasks(run_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE survey_runs
    SET completed_tasks = completed_tasks + 1
    WHERE id = run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment failed_tasks atomically
CREATE OR REPLACE FUNCTION increment_failed_tasks(run_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE survey_runs
    SET failed_tasks = failed_tasks + 1
    WHERE id = run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if run is complete and update status
CREATE OR REPLACE FUNCTION check_run_completion(run_id UUID)
RETURNS void AS $$
DECLARE
    run_record survey_runs%ROWTYPE;
BEGIN
    SELECT * INTO run_record FROM survey_runs WHERE id = run_id;

    IF run_record.completed_tasks + run_record.failed_tasks >= run_record.total_tasks THEN
        UPDATE survey_runs
        SET
            status = CASE
                WHEN run_record.failed_tasks > 0 AND run_record.completed_tasks = 0 THEN 'failed'
                ELSE 'completed'
            END,
            completed_at = NOW()
        WHERE id = run_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to append result to survey_runs.results
CREATE OR REPLACE FUNCTION append_run_result(
    run_id UUID,
    backstory_uuid UUID,
    task_result JSONB
)
RETURNS void AS $$
BEGIN
    UPDATE survey_runs
    SET results = results || jsonb_build_object(backstory_uuid::text, task_result)
    WHERE id = run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to append error to survey_runs.error_log
CREATE OR REPLACE FUNCTION append_run_error(
    run_id UUID,
    backstory_uuid UUID,
    error_msg TEXT
)
RETURNS void AS $$
BEGIN
    UPDATE survey_runs
    SET error_log = error_log || jsonb_build_array(
        jsonb_build_object(
            'backstory_id', backstory_uuid::text,
            'error', error_msg,
            'timestamp', NOW()
        )
    )
    WHERE id = run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
