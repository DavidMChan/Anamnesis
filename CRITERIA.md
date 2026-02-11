# Feature: Backstory Dataset Import

## Status
- [x] Planning complete
- [ ] Ready for implementation

## Description

Create a one-time Python script to import HuggingFace backstory datasets into Supabase:

1. **Anthology**: 11,400 backstories from the 2024 paper
2. **Alterity**: 41,100 backstories from interview-style generation

Total: **52,500 backstories** available as public pool for surveys.

## Dataset Sources

| Dataset | URL | Size |
|---------|-----|------|
| Anthology | `SuhongMoon/anthology_backstory` | 11,400 rows |
| Alterity | `SuhongMoon/alterity_backstory` | 41,100 rows |

## Technical Approach

### Files to Create
- `supabase/migrations/003_add_source_types.sql` - Add new source_type values
- `worker/scripts/import_backstories.py` - One-time import script

### Files to Modify
- `worker/requirements.txt` - Add `datasets` package
- `frontend/src/types/database.ts` - Add new source_type values

### Database Mapping

| Supabase Column | Value |
|-----------------|-------|
| `backstory_text` | HuggingFace `text` field |
| `contributor_id` | `NULL` |
| `source_type` | `'anthology'` or `'alterity'` |
| `transcript` | `NULL` |
| `demographics` | `{}` |
| `is_public` | `TRUE` |

## Pass Criteria

### Acceptance Criteria
- [ ] Migration adds comment documenting new source_type values
- [ ] TypeScript types updated
- [ ] Script imports anthology dataset (11,400 rows)
- [ ] Script imports alterity dataset (41,100 rows)
- [ ] All rows have correct `source_type`, `is_public=TRUE`, `contributor_id=NULL`
- [ ] Running twice doesn't duplicate data

## Implementation Notes

### Migration
```sql
-- 003_add_source_types.sql
COMMENT ON COLUMN backstories.source_type IS
  'Source: llm_generated, human_interview, uploaded, anthology, alterity';
```

### Script Usage
```bash
cd worker
pip install datasets

# Import both datasets
python scripts/import_backstories.py --dataset anthology
python scripts/import_backstories.py --dataset alterity

# Optional flags
--dry-run       # Preview without inserting
--batch-size N  # Default 100
--limit N       # Test with subset
```

### Environment
```bash
# worker/.env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
```

## Out of Scope
- Unit tests (one-time script)
- Demographics parsing (another student has this)
- Frontend UI changes
