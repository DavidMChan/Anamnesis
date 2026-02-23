# Feature: Minor Frontend Improvements (5 items)

## Status
- [x] Planning complete
- [ ] Ready for implementation

## Description
A bundle of 5 small UI/UX improvements to the survey platform:
1. Show which model was used per run on the results page
2. Show effective LLM config + demographics on SurveyView
3. Allow editing LLM settings + demographics per run (unlock active surveys)
4. Default temperature=1, max_tokens=128 when not set
5. Show run start time in run history

---

## Feature 1: Show Model on Results Page

### What
On the results page (`SurveyResults.tsx`), show which LLM model was used for the displayed run.

### Where
- **ResultsHero**: Add model name as a subtitle text in the header line
  - e.g., `128 responses • 5 questions • anthropic/claude-3-haiku`
  - Use the `run.llm_config` which is already fetched
- **Run Config Card**: Add a collapsible card below the hero showing full run config:
  - Provider (openrouter / vllm)
  - Model name
  - Temperature
  - Max tokens

### Files to Modify
- `frontend/src/components/results/ResultsHero.tsx` — Add `run` prop (type `SurveyRun`), display model name in subtitle
- `frontend/src/pages/SurveyResults.tsx` — Pass `run` to `ResultsHero`, add run config card below hero

### Implementation Details
- Extract model name helper (shared across features, put in `frontend/src/lib/llmConfig.ts`):
  ```ts
  export function getModelName(config: LLMConfig): string | undefined {
    return config.provider === 'vllm' ? config.vllm_model : config.openrouter_model
  }
  ```
- The config card should be collapsible (default collapsed) using a simple `useState` toggle
- Show: Provider badge, Model name, Temperature, Max Tokens

### Pass Criteria
- [ ] Results page header shows model name (e.g., "anthropic/claude-3-haiku") in the subtitle line
- [ ] Collapsible "Run Configuration" card displays provider, model, temperature, max_tokens
- [ ] Card defaults to collapsed
- [ ] Handles missing/undefined fields gracefully (show "Not set" or omit)

---

## Feature 2: Show Effective LLM Config on SurveyView

### What
On the survey detail page (`SurveyView.tsx`), always show the effective LLM configuration that will be used for the next run.

### Current Behavior
The "LLM Settings" card only appears when `survey.temperature != null || survey.max_tokens != null`. It only shows temperature and max_tokens.

### New Behavior
Always show an "LLM Settings" card that displays the **effective** config for the next run:
- Provider (from per-survey override -> user profile default)
- Model name (from per-survey override -> user profile default)
- Temperature (from per-survey override -> user profile default -> system default 1)
- Max Tokens (from per-survey override -> user profile default -> system default 128)
- Show which values are overridden vs inherited with subtle text like "(default)" or "(survey override)"

### Files to Modify
- `frontend/src/pages/SurveyView.tsx` — Replace the existing conditional LLM Settings card with an always-visible card showing effective config

### Implementation Details
- Use `mergeEffectiveConfig()` helper (see Feature 3) to compute the effective config
- Show values with "(default)" or "(override)" labels for clarity

### Pass Criteria
- [ ] LLM Settings card is always visible on SurveyView (not conditional)
- [ ] Shows provider, model, temperature, max_tokens
- [ ] Values correctly cascade: per-survey override > user profile > system defaults
- [ ] Override vs default values are visually distinguished

---

## Feature 3: Per-Run LLM Settings (Unlock Active Survey Editing)

### What
Allow users to change LLM settings (model, provider, temperature, max_tokens) and demographics per run. Currently, once a survey has been run (status=active), it cannot be edited at all.

### Approach
1. **DB Migration**: Add `llm_config` JSONB column to `surveys` table, **replacing** the existing standalone `temperature` and `max_tokens` columns. Migrate existing data into the new column and drop the old ones.
2. **Unlock Edit for Active Surveys**: Show the Edit button for active surveys too, but on the edit page, **lock the questions section** (read-only) for active surveys. Demographics and LLM settings remain editable.
3. **Inline Editing on SurveyView**: Make the LLM Settings card on SurveyView editable inline (pencil icon -> edit mode). User can quickly tweak settings without going to the full edit page.

### Database Migration

```sql
-- 1. Add new unified column
ALTER TABLE surveys ADD COLUMN llm_config JSONB;

-- 2. Migrate existing temperature/max_tokens data
UPDATE surveys
SET llm_config = jsonb_strip_nulls(jsonb_build_object(
  'temperature', temperature,
  'max_tokens', max_tokens
))
WHERE temperature IS NOT NULL OR max_tokens IS NOT NULL;

-- 3. Drop old columns (absorbed into llm_config)
ALTER TABLE surveys DROP COLUMN temperature;
ALTER TABLE surveys DROP COLUMN max_tokens;
```

### Cleanup: What Gets Removed

| Removed | Location | Replaced By |
|---------|----------|-------------|
| `surveys.temperature` column | DB | `surveys.llm_config->>'temperature'` |
| `surveys.max_tokens` column | DB | `surveys.llm_config->>'max_tokens'` |
| `Survey.temperature` field | `database.ts` | `Survey.llm_config?.temperature` |
| `Survey.max_tokens` field | `database.ts` | `Survey.llm_config?.max_tokens` |
| `temperature` state variable | `SurveyCreate.tsx` | Merged into single `llmConfig` state |
| `maxTokens` state variable | `SurveyCreate.tsx` | Merged into single `llmConfig` state |
| `showLlmSettings` state variable | `SurveyCreate.tsx` | LLM section always visible |
| Conditional LLM card (lines 329-357) | `SurveyView.tsx` | Always-visible editable card |
| Scattered merge logic | `SurveyView.tsx:155-159`, `SurveyCreate.tsx:366-369` | Single `mergeEffectiveConfig()` helper |

### TypeScript Type Changes

In `frontend/src/types/database.ts`:
```ts
export interface Survey {
  id: string
  user_id: string
  name?: string
  questions: Question[]
  demographics: DemographicFilter
  status: SurveyStatus
  llm_config?: Partial<LLMConfig> | null  // Per-survey LLM overrides
  created_at: string
  // REMOVED: temperature, max_tokens (now inside llm_config)
}
```

### New Shared Helper

Create `frontend/src/lib/llmConfig.ts`:
```ts
import type { LLMConfig } from '@/types/database'

export const LLM_DEFAULTS = {
  temperature: 1,
  max_tokens: 128,
} as const

/** Extract display model name from an LLM config */
export function getModelName(config: LLMConfig): string | undefined {
  return config.provider === 'vllm' ? config.vllm_model : config.openrouter_model
}

/** Merge user profile defaults + per-survey overrides + system defaults */
export function mergeEffectiveConfig(
  profileConfig: LLMConfig | undefined,
  surveyConfig: Partial<LLMConfig> | null | undefined,
): LLMConfig {
  return {
    ...profileConfig,
    ...surveyConfig,
    temperature: surveyConfig?.temperature ?? profileConfig?.temperature ?? LLM_DEFAULTS.temperature,
    max_tokens: surveyConfig?.max_tokens ?? profileConfig?.max_tokens ?? LLM_DEFAULTS.max_tokens,
  }
}
```

This single file replaces all scattered merge logic across SurveyView and SurveyCreate.

### Files to Modify
- **`supabase/migrations/YYYYMMDD_survey_llm_config.sql`** — New migration (add column, migrate data, drop old columns)
- **`frontend/src/types/database.ts`** — Replace `temperature`/`max_tokens` with `llm_config` on `Survey`
- **`frontend/src/pages/SurveyView.tsx`** — Always-visible editable LLM card; show Edit button for active surveys; use `mergeEffectiveConfig()` in `runSurvey()`
- **`frontend/src/pages/SurveyCreate.tsx`** — Replace 3 state vars with single `llmConfig` state; add provider/model fields; lock questions for active surveys; save to `survey.llm_config`
- **`frontend/src/pages/SurveyResults.tsx`** — No changes needed (reads from `run.llm_config`)
- **`frontend/src/lib/surveyRunner.ts`** — No changes needed (receives merged config from caller)

### Files to Create
- **`frontend/src/lib/llmConfig.ts`** — `LLM_DEFAULTS`, `getModelName()`, `mergeEffectiveConfig()`

### Run Creation Flow (simplified)

In `SurveyView.tsx` `runSurvey()`:
```ts
import { mergeEffectiveConfig } from '@/lib/llmConfig'

const runLlmConfig = mergeEffectiveConfig(profile?.llm_config, survey.llm_config)
const runId = await createRun(survey.id, runLlmConfig)
```

Replaces the current 5-line manual merge in both SurveyView and SurveyCreate.

### SurveyView Inline Editing
- The LLM Settings card gets a pencil/edit icon in the header
- Clicking it toggles edit mode: fields become editable inputs/selects
- A "Save" button persists changes to the survey's `llm_config` column via Supabase update
- Fields:
  - Provider selector: OpenRouter / vLLM (or empty = inherit from profile)
  - Model input: text field (contextual to selected provider)
  - Temperature: number input (0-2, step 0.1)
  - Max Tokens: number input (1-16384)
- All fields show placeholder with effective default value when empty

### SurveyCreate Changes (Edit Page for Active Surveys)
- When editing an active survey:
  - Questions section is read-only (show questions but remove add/remove/edit controls, inputs disabled)
  - Demographics section remains fully editable
  - LLM Settings section remains fully editable
  - Add provider + model fields to the LLM settings section (currently only has temperature + max_tokens)
- When editing a draft survey: everything editable (no change from current behavior)
- Replace `temperature`/`maxTokens`/`showLlmSettings` state vars with single `llmConfig: Partial<LLMConfig>` state
- LLM Settings section always visible (remove collapsible toggle)

### Pass Criteria
- [ ] New `llm_config` JSONB column exists on surveys table
- [ ] Old `temperature` and `max_tokens` columns are dropped
- [ ] Existing survey data is migrated (no data loss)
- [ ] Active surveys show Edit button on SurveyView
- [ ] Edit page locks questions section for active surveys (visually read-only)
- [ ] Edit page allows changing demographics + LLM settings for active surveys
- [ ] LLM Settings section on edit page includes provider + model fields
- [ ] SurveyView has inline-editable LLM Settings card
- [ ] Inline edits save to `survey.llm_config` in the database
- [ ] Run creation uses `mergeEffectiveConfig()` — single source of truth for merge logic
- [ ] Each run's `llm_config` snapshot reflects the settings used for that specific run

---

## Feature 4: Default LLM Settings

### What
When temperature or max_tokens are not explicitly set by the user (neither in global settings nor per-survey), apply system defaults:
- **Temperature**: 1
- **Max Tokens**: 128

### Implementation
Handled by `LLM_DEFAULTS` and `mergeEffectiveConfig()` in `frontend/src/lib/llmConfig.ts` (see Feature 3). No additional files needed.

In UI inputs, use `placeholder="1 (default)"` / `placeholder="128 (default)"`.

### Pass Criteria
- [ ] When temperature is not set anywhere, run uses temperature=1
- [ ] When max_tokens is not set anywhere, run uses max_tokens=128
- [ ] UI shows default values as placeholders or helper text
- [ ] Explicitly set values still override defaults

---

## Feature 5: Run History Shows Start Time

### What
In the run history list (`SurveyRunHistory` component), show when each run started with full datetime, not just the date.

### Current Behavior
Shows: `new Date(run.created_at).toLocaleDateString()` — only the date, no time.

### New Behavior
Show date + time, preferring `started_at` when available:
- If `started_at` exists: show formatted datetime
- Otherwise: show `created_at` datetime
- Format: locale-appropriate, e.g., "Feb 22, 2026 3:45 PM"

### Files to Modify
- `frontend/src/components/surveys/SurveyRunProgress.tsx` — Update display in `SurveyRunHistory`

### Implementation Details
Change the date display in the run history list items:
```tsx
// Before:
{new Date(run.created_at).toLocaleDateString()}

// After:
{new Date(run.started_at || run.created_at).toLocaleString(undefined, {
  month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit',
})}
```

### Pass Criteria
- [ ] Run history entries show date + time (not just date)
- [ ] Uses `started_at` when available, falls back to `created_at`
- [ ] Time format is readable (e.g., "Feb 22, 2026 3:45 PM")

---

## Implementation Order

Recommended order: **5 -> 3 -> 4 -> 2 -> 1**

1. **Feature 5** (run history time) — One-line change, trivial
2. **Feature 3** (per-run settings) — DB migration + cleanup old columns + new helper + UI changes. Do this early since Features 2 and 4 depend on it.
3. **Feature 4** (defaults) — Trivially handled by `mergeEffectiveConfig()` from Feature 3
4. **Feature 2** (effective config on SurveyView) — Uses the editable card built in Feature 3
5. **Feature 1** (model on results) — Uses `getModelName()` helper from Feature 3

---

## Summary of All File Changes

### New Files
| File | Purpose |
|------|---------|
| `supabase/migrations/YYYYMMDD_survey_llm_config.sql` | Add `llm_config`, migrate data, drop old columns |
| `frontend/src/lib/llmConfig.ts` | `LLM_DEFAULTS`, `getModelName()`, `mergeEffectiveConfig()` |

### Modified Files
| File | Changes |
|------|---------|
| `frontend/src/types/database.ts` | Remove `temperature`/`max_tokens` from `Survey`, add `llm_config` |
| `frontend/src/pages/SurveyView.tsx` | Always-visible editable LLM card; unlock Edit for active; use `mergeEffectiveConfig()` |
| `frontend/src/pages/SurveyCreate.tsx` | Single `llmConfig` state; add provider/model fields; lock questions for active; always-visible LLM section |
| `frontend/src/components/results/ResultsHero.tsx` | Add `run` prop, show model name in subtitle |
| `frontend/src/pages/SurveyResults.tsx` | Pass `run` to `ResultsHero`, add collapsible run config card |
| `frontend/src/components/surveys/SurveyRunProgress.tsx` | Show datetime (not just date) in run history |

### Removed Code
| What | Where |
|------|-------|
| `surveys.temperature` column | DB migration drops it |
| `surveys.max_tokens` column | DB migration drops it |
| `temperature` / `maxTokens` / `showLlmSettings` state vars | `SurveyCreate.tsx` |
| Conditional LLM Settings card | `SurveyView.tsx` (lines 329-357) |
| Scattered merge logic | `SurveyView.tsx:155-159`, `SurveyCreate.tsx:366-369` |

**Net result**: 2 new small files, 6 modified files, ~40 lines of removed code replaced by a cleaner shared helper.

---

## Out of Scope
- Changing API keys per-survey (keys remain in Supabase Vault, global only)
- Per-survey chat template or guided decoding toggles (keep as global settings)
- Per-survey parser LLM model (keep as global setting)
- Changing questions on active surveys
- Run comparison UI (comparing results across runs with different settings)

## Notes for the Implementing Agent
- Worker is unaffected — it reads from `survey_runs.llm_config` snapshot, never from `surveys` table directly
- The `llm_config` column on `surveys` stores a **partial** `LLMConfig` — only fields the user explicitly overrides. Empty/null fields inherit from user profile defaults.
- Use `useAuthContext()` to get user's profile LLM config for computing effective settings
- Reference existing UI patterns in `Settings.tsx` for provider select and model input
- Inline edit on SurveyView should be simple — just `useState` toggle, no heavy form library
- When dropping DB columns, the migration is irreversible — make sure data migration step runs first
