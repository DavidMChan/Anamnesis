-- RPC to discover available distribution bins per demographic dimension.
-- Scans all public, non-anthology backstories and collects unique distribution
-- keys per dimension, returning them as a JSONB object:
--   { "c_age": ["18-24", "25-34", ...], "c_gender": ["male", "female"], ... }
CREATE OR REPLACE FUNCTION get_distribution_bins()
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}'::JSONB;
  rec RECORD;
  dim_key TEXT;
  dist_keys JSONB;
BEGIN
  -- For each backstory's demographics, extract dimension keys and their distribution keys
  FOR rec IN
    SELECT demographics
    FROM backstories
    WHERE is_public = TRUE
      AND source_type != 'anthology'
      AND demographics IS NOT NULL
  LOOP
    FOR dim_key IN SELECT jsonb_object_keys(rec.demographics)
    LOOP
      -- Get the distribution keys for this dimension
      dist_keys := rec.demographics -> dim_key -> 'distribution';
      IF dist_keys IS NOT NULL THEN
        -- Merge distribution keys into result
        IF result ? dim_key THEN
          -- Add new keys that don't exist yet
          SELECT jsonb_agg(DISTINCT val)
          INTO dist_keys
          FROM (
            SELECT jsonb_array_elements_text(result -> dim_key) AS val
            UNION
            SELECT jsonb_object_keys(rec.demographics -> dim_key -> 'distribution') AS val
          ) combined;
          result := jsonb_set(result, ARRAY[dim_key], dist_keys);
        ELSE
          -- First time seeing this dimension — collect all keys
          SELECT jsonb_agg(k)
          INTO dist_keys
          FROM jsonb_object_keys(rec.demographics -> dim_key -> 'distribution') AS k;
          result := jsonb_set(result, ARRAY[dim_key], COALESCE(dist_keys, '[]'::JSONB));
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Sort keys within each dimension
  FOR dim_key IN SELECT jsonb_object_keys(result)
  LOOP
    SELECT jsonb_agg(val ORDER BY val)
    INTO dist_keys
    FROM jsonb_array_elements_text(result -> dim_key) AS val;
    result := jsonb_set(result, ARRAY[dim_key], COALESCE(dist_keys, '[]'::JSONB));
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;
