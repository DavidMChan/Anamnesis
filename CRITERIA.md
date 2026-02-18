# Feature: Backstory Update with Demographics

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description
Replace all existing backstories in the database with ~35k backstories from the postdoc's JSONL file that includes demographic survey results. Each backstory will have demographics stored as top_choice + probability distribution for 11 dimensions (age, gender, education, income, race, religion, region, party, democratic_strength, republican_strength, independent_leaning).

## Data Source
- **File**: `/Users/vaclis./Documents/UCB/BAIR/demo-survey_subject-all-full_turns-Mistral-Small-24B-Base-2501_20250318.jsonl`
- **Size**: ~2GB, 38,560 lines, 34,949 unique vuids (3,611 vuids appear twice — take first occurrence)
- **Format**: One JSON object per line

### JSONL Record Structure
Each record contains:
- `virtual_subject_vuid`: Unique identifier (e.g., `"Mistral-Small-24B-Base-2501_202502271120_806"`)
- `virtual_subject_backstory`: Full interview Q&A text (~8k chars)
- 11 demographic dimensions, each with fields:
  - `c_{dim}_question_options`: Array of option strings
  - `c_{dim}_top_choice`: Index into options array (most frequent LLM answer)
  - `c_{dim}_choices`: Object mapping index → probability
  - `c_{dim}_parsed_responses`: Array of raw response indices per prompt

### Target Demographics JSONB Format
```json
{
  "c_age": {
    "value": "45-54",
    "distribution": {
      "18-24": 0.0,
      "25-34": 0.0,
      "35-44": 0.0,
      "45-54": 1.0,
      "55-64": 0.0,
      "65+": 0.0,
      "Prefer not to answer": 0.0
    }
  },
  "c_gender": {
    "value": "Male",
    "distribution": {
      "Male": 1.0,
      "Female": 0.0,
      "Other (e.g., non-binary, trans)": 0.0,
      "Prefer not to answer": 0.0
    }
  }
}
```
Each key maps to `{ "value": "<top choice text>", "distribution": { "<option text>": probability, ... } }`.

## Technical Approach

### Schema Changes (SQL Migration)

1. **Add `vuid` column** to `backstories` table:
   ```sql
   ALTER TABLE backstories ADD COLUMN vuid TEXT;
   CREATE UNIQUE INDEX idx_backstories_vuid ON backstories(vuid) WHERE vuid IS NOT NULL;
   ```
   This enables future matching between DB records and external data files.

2. **Update `demographic_keys`** to match JSONL dimensions:
   - Delete old seed data
   - Insert new keys matching the 11 JSONL dimensions with correct enum_values

### Files to Create
- `worker/scripts/import_jsonl_backstories.py` — Streaming JSONL importer with demographics extraction
- `supabase/migrations/007_add_vuid_column.sql` — Add vuid column + update demographic_keys

### Files to Modify
- `frontend/src/types/database.ts` — Add `vuid` field to Backstory interface, update Demographics type
- `worker/src/db.py` — Update demographic filtering to use new `{"value": ..., "distribution": ...}` format

### Key Decisions
- **Streaming import**: Read JSONL line-by-line to handle 2GB file without loading into memory
- **Dedup by vuid**: 3,611 vuids appear twice; take the first occurrence only
- **Clear everything first**: Delete all survey_tasks → survey_runs → backstories before import (FK order)
- **source_type = 'alterity'**: All imported backstories use this source type
- **Demographics value field**: Use human-readable option text (not index) for easy filtering

## Pass Criteria

### Unit Tests
- [ ] `import_jsonl_backstories.py` — `parse_demographics(record)` extracts correct format from a JSONL record
- [ ] `import_jsonl_backstories.py` — `parse_demographics(record)` handles missing/null fields gracefully
- [ ] `import_jsonl_backstories.py` — Deduplication by vuid works (second occurrence skipped)
- [ ] `import_jsonl_backstories.py` — `sanitize_text()` removes null characters from backstory text

### Acceptance Criteria
- [ ] All existing backstories are deleted from DB (anthology + alterity)
- [ ] All existing survey_runs and survey_tasks are cleaned up first (FK constraints)
- [ ] ~34,949 backstories imported with non-empty demographics JSONB
- [ ] Each backstory has `vuid`, `backstory_text`, `demographics`, `source_type='alterity'`
- [ ] Demographics has 11 keys, each with `value` (text) and `distribution` (object)
- [ ] `demographic_keys` table updated with correct enum_values for each dimension
- [ ] Frontend `Backstory` type updated with `vuid` field
- [ ] Import script supports `--dry-run`, `--limit`, `--batch-size` flags

## Implementation Notes

### For the Implementing Agent

1. **Start with the migration** (`007_add_vuid_column.sql`):
   - Add `vuid TEXT` column with unique partial index
   - Truncate/update `demographic_keys` with new values from JSONL

2. **Write the import script** (`worker/scripts/import_jsonl_backstories.py`):
   - Stream the JSONL file line by line (`for line in open(...)`)
   - Track seen vuids in a set for dedup
   - Parse demographics using the `_top_choice` and `_choices` fields
   - Convert index-based choices to text-based using `_question_options`
   - Batch insert (default 100 rows per batch)
   - The script should handle the delete step too (`--clear` flag or interactive confirm)

3. **Handle FK constraints before clearing**:
   ```sql
   DELETE FROM survey_tasks;
   DELETE FROM survey_runs;
   DELETE FROM backstories;
   ```

4. **Demographics parsing pseudocode**:
   ```python
   DEMO_FIELDS = ["c_age", "c_gender", "c_education", "c_income", "c_race",
                   "c_religion", "c_region", "c_party", "c_democratic_strength",
                   "c_republican_strength", "c_independent_leaning"]

   def parse_demographics(record):
       demographics = {}
       for field in DEMO_FIELDS:
           options = record.get(f"{field}_question_options")
           top_idx = record.get(f"{field}_top_choice")
           choices = record.get(f"{field}_choices")
           if options is None or top_idx is None:
               continue
           value = options[top_idx] if 0 <= top_idx < len(options) else None
           distribution = {}
           if choices:
               for idx_str, prob in choices.items():
                   idx = int(idx_str)
                   if 0 <= idx < len(options):
                       distribution[options[idx]] = prob
           demographics[field] = {"value": value, "distribution": distribution}
       return demographics
   ```

5. **Reference patterns**: See `worker/scripts/import_backstories.py` for batch insert pattern, Supabase client setup, and text sanitization.

### Performance Notes
- File is ~2GB — must stream, never `json.load()` the whole file
- Use batch inserts (100-200 rows) to avoid Supabase API limits
- Track progress with periodic print statements
- Expected runtime: a few minutes for 35k rows

## Out of Scope
- Updating the frontend UI for browsing demographics (separate feature)
- Re-running demographic filtering logic in the worker
- Importing anthology backstories (they're being removed)
- Matching with human survey respondents
