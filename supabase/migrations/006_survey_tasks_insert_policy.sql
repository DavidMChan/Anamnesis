-- Add INSERT policy for survey_tasks
-- Users can create tasks for their own survey runs

CREATE POLICY "Users can create tasks for own survey runs" ON survey_tasks
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM survey_runs
            JOIN surveys ON surveys.id = survey_runs.survey_id
            WHERE survey_runs.id = survey_tasks.survey_run_id
            AND surveys.user_id = auth.uid()
        )
    );
