-- Auto-update demographic_keys.status when a linked survey run finishes.
--
-- Problem: the Python dispatcher only processes runs in 'pending'/'running' state.
-- Once a run is 'completed', it's invisible to the dispatcher, so
-- finish_demographic_key() was never being called reliably.
--
-- Fix: use a DB-level trigger so the key status update fires atomically
-- whenever survey_runs.status transitions to 'completed' or 'failed',
-- regardless of the Python process state.

-- 1. Trigger function
CREATE OR REPLACE FUNCTION _auto_finish_demographic_key()
RETURNS TRIGGER AS $$
BEGIN
    -- Only fire on a real status transition to a terminal state
    IF NEW.status IN ('completed', 'failed') AND OLD.status != NEW.status THEN
        UPDATE demographic_keys dk
        SET status = CASE NEW.status
            WHEN 'completed' THEN 'finished'
            ELSE 'failed'
        END
        FROM surveys s
        WHERE s.id      = NEW.survey_id
          AND s.type    = 'demographic'
          AND s.demographic_key IS NOT NULL
          AND dk.key    = s.demographic_key;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach to survey_runs
DROP TRIGGER IF EXISTS trg_auto_finish_demographic_key ON survey_runs;
CREATE TRIGGER trg_auto_finish_demographic_key
AFTER UPDATE OF status ON survey_runs
FOR EACH ROW
EXECUTE FUNCTION _auto_finish_demographic_key();

-- 3. Backfill: fix any demographic keys that are still 'running'
--    because their run already completed before this trigger existed.
UPDATE demographic_keys dk
SET status = CASE
    WHEN EXISTS (
        SELECT 1 FROM survey_runs sr
        JOIN surveys s ON s.id = sr.survey_id
        WHERE s.demographic_key = dk.key
          AND sr.status = 'completed'
    ) THEN 'finished'
    WHEN EXISTS (
        SELECT 1 FROM survey_runs sr
        JOIN surveys s ON s.id = sr.survey_id
        WHERE s.demographic_key = dk.key
          AND sr.status = 'failed'
    ) THEN 'failed'
END
WHERE dk.status = 'running'
  AND NOT EXISTS (
      -- don't touch keys that still have an active run
      SELECT 1 FROM survey_runs sr
      JOIN surveys s ON s.id = sr.survey_id
      WHERE s.demographic_key = dk.key
        AND sr.status IN ('pending', 'running')
  )
  AND (
      EXISTS (
          SELECT 1 FROM survey_runs sr
          JOIN surveys s ON s.id = sr.survey_id
          WHERE s.demographic_key = dk.key
            AND sr.status IN ('completed', 'failed')
      )
  );
