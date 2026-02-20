-- RPC to efficiently fetch demographics for a large list of backstory IDs
CREATE OR REPLACE FUNCTION get_backstory_demographics(backstory_ids UUID[])
RETURNS TABLE(id UUID, demographics JSONB) AS $$
BEGIN
  -- Create a temporary table to hold the IDs
  CREATE TEMP TABLE IF NOT EXISTS temp_backstory_ids (id UUID) ON COMMIT DROP;

  -- Truncate it in case it persists across calls within a transaction/session
  TRUNCATE TABLE temp_backstory_ids;

  -- Insert the IDs
  INSERT INTO temp_backstory_ids (id)
  SELECT unnest(backstory_ids);

  -- Return the joined data
  RETURN QUERY
  SELECT b.id, b.demographics
  FROM backstories b
  JOIN temp_backstory_ids t ON b.id = t.id;
END;
$$ LANGUAGE plpgsql;
