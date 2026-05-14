-- Ground Truth Matching feature
-- Adds 'matching' phase to survey_runs lifecycle and ground_truth payload column.
--
-- Lifecycle for ground-truth runs:
--   matching -> pending -> running -> completed
-- (matching is the new phase where the worker computes Hungarian/greedy/random
--  matches between uploaded respondents and the backstory pool, then creates
--  survey_tasks and transitions the run to 'pending'.)

ALTER TABLE survey_runs
    DROP CONSTRAINT IF EXISTS survey_runs_status_check;

ALTER TABLE survey_runs
    ADD CONSTRAINT survey_runs_status_check
    CHECK (status IN ('pending', 'matching', 'running', 'completed', 'failed', 'cancelled'));

-- ground_truth payload (request + computed matches).
-- Shape (see GroundTruthData in types/database.ts):
-- {
--   "mode": "per_respondent" | "aggregate",
--   "match_method": "hungarian" | "greedy" | "random",
--   "demographic_keys": ["c_age", "c_gender", ...],
--   "question_keys": ["q1", "q2", ...],            -- optional
--   "respondents": [
--     { "_id": "...", "_count": 1,
--       "demographics": { "c_age": "30-39", ... },
--       "answers": { "q1": "A", ... } }            -- optional
--   ],
--   "matches": [
--     { "_id": "...", "backstory_id": "uuid", "score": 0.123 }
--   ],
--   "stats": { "n_respondents": N, "pool_size": M, ... }
-- }
ALTER TABLE survey_runs
    ADD COLUMN ground_truth JSONB;

-- Partial index for cheap dispatcher polling of pending matching jobs.
CREATE INDEX idx_survey_runs_matching ON survey_runs(created_at)
    WHERE status = 'matching';
