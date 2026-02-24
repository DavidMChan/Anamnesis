-- Fix c_marital demographics: replace letter codes with option texts
--
-- The demographic survey question was:
--   "Which of the following best describes your marital status?"
--   (A) Married
--   (B) Separated
--   (C) Divorced
--   (D) Widowed
--   (E) Never married
--
-- Due to a bug, the stored value and distribution keys were letters (A/B/C/D/E)
-- instead of the full option texts. This migration corrects all affected rows.
--
-- Only updates rows where value is still a bare letter (A-E), so it is safe
-- to run multiple times.

UPDATE backstories
SET demographics = jsonb_set(
    demographics,
    '{c_marital}',
    jsonb_build_object(
        'value',
        CASE demographics -> 'c_marital' ->> 'value'
            WHEN 'A' THEN 'Married'
            WHEN 'B' THEN 'Separated'
            WHEN 'C' THEN 'Divorced'
            WHEN 'D' THEN 'Widowed'
            WHEN 'E' THEN 'Never married'
            ELSE demographics -> 'c_marital' ->> 'value'
        END,
        'distribution',
        (
            SELECT jsonb_object_agg(
                CASE kv.key
                    WHEN 'A' THEN 'Married'
                    WHEN 'B' THEN 'Separated'
                    WHEN 'C' THEN 'Divorced'
                    WHEN 'D' THEN 'Widowed'
                    WHEN 'E' THEN 'Never married'
                    ELSE kv.key
                END,
                kv.value
            )
            FROM jsonb_each(demographics -> 'c_marital' -> 'distribution') AS kv(key, value)
        )
    )
)
WHERE demographics ? 'c_marital'
  AND (demographics -> 'c_marital' ->> 'value') = ANY (ARRAY['A', 'B', 'C', 'D', 'E']);
