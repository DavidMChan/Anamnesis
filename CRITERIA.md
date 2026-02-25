# Feature: Survey Algorithm Selection

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description

Add an `algorithm` field to `survey_runs` that controls how the LLM is prompted — just like `llm_config` and `demographics`, it's a per-run decision, not baked into the survey definition. The existing algorithm is `anthology` (LLM reads a full backstory then answers questions). The new algorithm is `zero_shot_baseline`: construct a short demographic description (e.g. "You are a 29-30 year old female.") from the run's demographic filters, and run N independent LLM calls using that prompt. The `sample_size` field in demographics doubles as "number of trials" for this algorithm.

The results page shows which algorithm was used for the displayed run.

## Technical Approach

### Files to Create
- `supabase/migrations/20260225000000_survey_algorithm.sql` — add `algorithm` column to `survey_runs`
- `frontend/src/lib/demographicPrompt.ts` — `buildDemographicPromptText(filters: DemographicFilter): string` helper
- `frontend/tests/demographicPrompt.test.ts` — unit tests for prompt builder

### Files to Modify
- `frontend/src/types/database.ts` — add `SurveyAlgorithm = 'anthology' | 'zero_shot_baseline'` type; add `algorithm: SurveyAlgorithm` to `SurveyRun`
- `frontend/src/pages/SurveyView.tsx` — add algorithm selector to the run configuration UI (alongside LLM config overrides and demographics); pass algorithm to `createRun()`; when `zero_shot_baseline` is selected, relabel "Sample size" → "Number of trials"; add a **Prompt Preview card** that updates live as algorithm/demographics/N change
- `frontend/src/hooks/useSurveyRun.ts` — `useCreateSurveyRun().createRun()` accepts `algorithm` param; routes to `createZeroShotBaselineRun` when appropriate
- `frontend/src/lib/surveyRunner.ts` — add `createZeroShotBaselineRun()`; update `createSurveyRun()` to include `algorithm: 'anthology'` in the run insert
- `frontend/src/pages/SurveyResults.tsx` — show algorithm in `RunConfigCard`; handle `backstory_id = null` tasks (use `task.id` as key fallback, display "Trial N" row label)
- `worker/src/prompt.py` — add `build_demographic_prompt(filters: dict) -> str`
- `worker/src/worker.py` — handle `backstory_id = None` in `async_process_task`
- `worker/src/db.py` — add `get_survey_algorithm(run_id: str) -> str` (reads `survey_runs.algorithm`); add `get_run_demographics(run_id: str) -> dict`
- `worker/main.py` — detect `zero_shot_baseline` algorithm; skip backstory lookup; inject constructed prompt text into task dict
- `worker/tests/test_prompt.py` — add unit tests for `build_demographic_prompt`

### Key Decisions

- **`algorithm` on `survey_runs`** (not `surveys`): Same survey can be run with different algorithms on different runs, just like different LLM configs or demographic filters. Consistent with existing per-run config philosophy.
- **`survey_runs.algorithm TEXT NOT NULL DEFAULT 'anthology'`** with check constraint — explicit column (not buried in `llm_config` JSONB) so it's queryable, filterable, and visible in the results page.
- **Reuse `SeriesWithContext` strategy** for `zero_shot_baseline`: The constructed prompt text is passed as the "backstory" argument. No new strategy class needed.
- **`survey_tasks.backstory_id = NULL`** for zero_shot_baseline tasks: The column is already nullable (no `NOT NULL` in schema). No schema change for `survey_tasks`.
- **Results keyed by `task.id`** when `backstory_id` is null: `SurveyResults.tsx` currently keys by `backstory_id`; fall back to `task.id` and display "Trial N" as the row label.
- **Demographics filters drive the prompt**: The `DemographicSelectionConfig.filters` (or raw `DemographicFilter`) stored on the run is used to construct the prompt. `sample_size` = number of trials.
- **Algorithm selector in SurveyView run panel**: sits alongside the existing `RunConfigCard` + `DemographicFilter` components. When `zero_shot_baseline` is selected, show a prompt preview card and relabel "Sample size" as "Number of trials".

## Pass Criteria

### Unit Tests (frontend)

- [ ] `buildDemographicPromptText({})` returns `"You are a person."`
- [ ] `buildDemographicPromptText({ c_age: { min: 29, max: 30 } })` returns `"You are a 29-30 year old."`
- [ ] `buildDemographicPromptText({ c_gender: ["female"] })` returns `"You are a female."`
- [ ] `buildDemographicPromptText({ c_age: { min: 29, max: 30 }, c_gender: ["female"] })` returns `"You are a 29-30 year old female."`
- [ ] `buildDemographicPromptText({ c_age: { min: 25 } })` returns `"You are a 25+ year old."`
- [ ] `buildDemographicPromptText({ c_gender: ["male", "female"] })` returns `"You are a male or female."`
- [ ] `c_` prefix is stripped: `c_education` → "education" used in description
- [ ] Age key detected by "age" substring — only age keys get "year old" suffix
- [ ] Unknown/arbitrary keys handled gracefully (no crash, included with stripped key name)

### Acceptance Criteria

- [ ] `survey_runs.algorithm TEXT NOT NULL DEFAULT 'anthology' CHECK (algorithm IN ('anthology', 'zero_shot_baseline'))` exists in DB
- [ ] `SurveyAlgorithm = 'anthology' | 'zero_shot_baseline'` exported from `types/database.ts`
- [ ] `SurveyRun.algorithm` field present in TypeScript type
- [ ] SurveyView run panel has algorithm selector; default is "Anthology"
- [ ] Prompt Preview card is visible in the run panel for both algorithms whenever the survey has at least one question
- [ ] For Anthology: prompt preview shows `[backstory text]` (italic placeholder) + first question formatted exactly as the worker sends it; description reads "run once per backstory"
- [ ] For Zero-Shot Baseline: prompt preview shows the constructed demographic text (e.g. `You are a 29-30 year old female.`) + first question; description reads "repeated N times independently" where N matches the sample_size field
- [ ] Prompt preview updates live when algorithm selector or demographic filters are changed
- [ ] When "Zero-Shot Baseline" selected: "Number of trials" label used for sample size
- [ ] `survey_runs.algorithm` is saved correctly when creating a run
- [ ] Worker reads `algorithm` from `survey_runs` directly (no join to surveys table)
- [ ] Worker skips backstory DB lookup when `task["backstory_id"]` is `None`
- [ ] `SurveyResults.tsx` shows algorithm in run config section
- [ ] `SurveyResults.tsx` renders without error when tasks have `backstory_id = null`
- [ ] CSV export for `zero_shot_baseline` runs uses trial index instead of backstory_id column

## Implementation Notes

### For the Implementing Agent

**Implementation order:**
1. DB migration
2. TypeScript type update (`SurveyAlgorithm`, `SurveyRun.algorithm`)
3. `demographicPrompt.ts` + unit tests
4. `worker/src/prompt.py` `build_demographic_prompt` + worker tests
5. `SurveyView.tsx` algorithm selector + prompt preview UI
6. `surveyRunner.ts` `createZeroShotBaselineRun` + `useCreateSurveyRun` routing
7. `worker/src/db.py` new methods + `worker/main.py` algorithm detection
8. `worker/src/worker.py` null backstory_id handling
9. `SurveyResults.tsx` algorithm display + null backstory_id handling

---

**DB migration:**
```sql
ALTER TABLE survey_runs
  ADD COLUMN algorithm TEXT NOT NULL DEFAULT 'anthology'
  CHECK (algorithm IN ('anthology', 'zero_shot_baseline'));
```

---

**Prompt construction logic** (identical in TypeScript and Python):
```
For each key in filters (sorted for determinism):
  strip "c_" prefix → dimension name
  is_age = "age" in dimension name

  if value is {min, max}:
    is_age  → "{min}-{max} year old"
    else    → "{min}-{max} {dimension_name}"
  if value is {min} only:
    is_age  → "{min}+ year old"
    else    → "{min}+ {dimension_name}"
  if value is {max} only:
    is_age  → "under {max} year old"
    else    → "under {max} {dimension_name}"
  if value is string[]:
    single  → just the value as-is
    multiple → join with " or "

Collect all descriptors, join with " ".
Result: "You are a {descriptors}." or "You are a person." if empty.
```

---

**`worker/src/db.py` new methods:**
```python
def get_survey_algorithm(self, run_id: str) -> str:
    """Returns 'anthology' or 'zero_shot_baseline'. Reads from survey_runs directly."""
    data = self._safe_single_execute(
        self.client.table("survey_runs").select("algorithm").eq("id", run_id)
    )
    if not data:
        return "anthology"
    return data.get("algorithm") or "anthology"

def get_run_demographics(self, run_id: str) -> dict:
    """Returns the DemographicSelectionConfig or DemographicFilter stored on the run."""
    data = self._safe_single_execute(
        self.client.table("survey_runs").select("demographics").eq("id", run_id)
    )
    return (data or {}).get("demographics") or {}
```

---

**`worker/main.py` — add after step 4 (get LLM), before step 5 (detect demographic survey):**
```python
# Detect algorithm
algorithm = await asyncio.to_thread(db.get_survey_algorithm, task["survey_run_id"])

if algorithm == "zero_shot_baseline":
    run_demographics = await asyncio.to_thread(db.get_run_demographics, task["survey_run_id"])
    # DemographicSelectionConfig stores filters under "filters"; raw DemographicFilter used as-is
    filters = run_demographics.get("filters", run_demographics) if isinstance(run_demographics, dict) else {}
    task["zero_shot_prompt_text"] = build_demographic_prompt(filters)
    logger.info(f"Task {task_id}: zero_shot_baseline, prompt={task['zero_shot_prompt_text']!r}")
```

Import at top: `from src.prompt import build_demographic_prompt`

---

**`worker/src/worker.py` — `async_process_task` change:**
```python
backstory_id = task["backstory_id"]  # None for zero_shot_baseline
if backstory_id:
    backstory_data = await asyncio.to_thread(self.db.get_backstory, backstory_id)
    if not backstory_data:
        raise NonRetryableError(f"Backstory {backstory_id} not found")
    backstory_text = backstory_data.get("backstory_text", "")
else:
    # zero_shot_baseline: handle_message pre-builds and injects the prompt
    backstory_text = task.get("zero_shot_prompt_text", "")
```

---

**`frontend/src/lib/surveyRunner.ts` — `createZeroShotBaselineRun`:**
```typescript
export async function createZeroShotBaselineRun(
  options: CreateSurveyRunOptions
): Promise<CreateSurveyRunResult> {
  const { surveyId, llmConfig, demographics: rawDemographics } = options
  const n = isDemographicSelectionConfig(rawDemographics)
    ? rawDemographics.sample_size
    : 10

  if (!n || n <= 0) return { success: false, error: 'Number of trials must be > 0' }

  const { data: run, error: runError } = await supabase
    .from('survey_runs')
    .insert({
      survey_id: surveyId, status: 'pending',
      total_tasks: n, completed_tasks: 0, failed_tasks: 0,
      results: {}, error_log: [],
      llm_config: llmConfig,
      demographics: rawDemographics,
      algorithm: 'zero_shot_baseline',
    })
    .select().single()

  if (runError || !run) return { success: false, error: runError?.message ?? 'Failed to create run' }

  // N tasks, all with backstory_id = null
  const tasks = Array.from({ length: n }, () => ({
    survey_run_id: run.id,
    backstory_id: null,
    status: 'pending',
    attempts: 0,
  }))

  const { error: tasksError } = await supabase.from('survey_tasks').insert(tasks)
  if (tasksError) {
    await supabase.from('survey_runs').delete().eq('id', run.id)
    return { success: false, error: tasksError.message }
  }

  await supabase.from('surveys').update({ status: 'active' }).eq('id', surveyId)
  return { success: true, runId: run.id }
}
```

Also update existing `createSurveyRun` to pass `algorithm: 'anthology'` in the run insert.

---

**`useCreateSurveyRun` signature change:**
```typescript
const createRun = useCallback(
  async (
    surveyId: string,
    llmConfig: LLMConfig,
    demographics: DemographicFilter | DemographicSelectionConfig,
    algorithm: SurveyAlgorithm = 'anthology',
  ): Promise<string | null> => {
    const fn = algorithm === 'zero_shot_baseline'
      ? createZeroShotBaselineRun
      : createSurveyRun
    const result = await fn({ surveyId, llmConfig, demographics })
    ...
  }
)
```

---

**`SurveyView.tsx` — algorithm state and run panel:**
```tsx
const [runAlgorithm, setRunAlgorithm] = useState<SurveyAlgorithm>('anthology')

// In runSurvey():
const runId = await createRun(survey.id, runLlmConfig, runDemographics, runAlgorithm)
```

In the run configuration section, add a radio group or select before the demographics config:
```
Algorithm:  ○ Anthology (default)  ○ Zero-Shot Baseline
```
When "Zero-Shot Baseline" is selected:
- The `DemographicFilter` component still renders (for setting what demographics to simulate)
- "Sample size" label changes to "Number of trials"

---

**Prompt Preview card** — always rendered below the demographics config, mirrors the pattern in `DemographicSurveyCreate.tsx:206-240`:

```tsx
{survey.questions.length > 0 && (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4" />
        <CardTitle>Prompt Preview</CardTitle>
      </div>
      <CardDescription>
        {runAlgorithm === 'zero_shot_baseline'
          ? `What will be sent to the LLM for each trial (repeated ${runDemographics.sample_size ?? '?'} times independently)`
          : 'What will be sent to the LLM for each backstory (run once per backstory)'}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <pre className="text-sm bg-muted rounded-lg p-4 whitespace-pre-wrap font-mono overflow-x-auto leading-relaxed">
        {/* Line 1: persona / backstory placeholder */}
        {runAlgorithm === 'zero_shot_baseline'
          ? buildDemographicPromptText(
              isDemographicSelectionConfig(runDemographics)
                ? runDemographics.filters
                : runDemographics
            )
          : <span className="text-muted-foreground italic">[backstory text]</span>
        }
        {'\n\n'}
        {/* First question formatted exactly as the worker would send it */}
        {formatQuestionPreview(survey.questions[0])}
      </pre>
    </CardContent>
  </Card>
)}
```

`formatQuestionPreview(q: Question): string` — implement in `SurveyView.tsx` (or a small local helper), mirrors `worker/src/prompt.py` formatting:
- `mcq`: `Question: {text}\n(A) opt1\n(B) opt2\nAnswer with (A), (B), ...\nAnswer:`
- `multiple_select`: `Question: {text}\n(A) opt1\n...\nSelect all that apply. ...\nAnswer:`
- `ranking`: `Question: {text}\n(A) opt1\n...\nRank all options ...\nAnswer:`
- `open_response`: `Question: {text}\nAnswer:`

If the survey has more than one question, add a muted footer line: `{'\n\n'}` + `// + {survey.questions.length - 1} more question(s) with context accumulation` (for anthology) or nothing extra (zero_shot treats each question independently in the same series).

---

**`SurveyResults.tsx` changes:**

In `RunConfigCard`, add algorithm row:
```tsx
<div className="flex items-center gap-2">
  <span className="font-medium w-24">Algorithm:</span>
  <Badge variant="outline">
    {run.algorithm === 'zero_shot_baseline' ? 'Zero-Shot Baseline' : 'Anthology'}
  </Badge>
</div>
```

In the task results fetch, select `id` as well:
```tsx
.select('id, backstory_id, result')
```

Key by:
```tsx
taskResults[task.backstory_id ?? task.id] = task.result
```

When rendering result rows, if `backstory_id` is null, show `Trial {index + 1}` as the label with no backstory link.

---

### Reference Files
- Algorithm detection pattern: `worker/main.py` lines 229–248 (demographic survey detection)
- `DemographicFilter` UI component: `frontend/src/components/surveys/DemographicFilter.tsx`
- `DemographicSelectionConfig` type: `frontend/src/types/database.ts:76–86`
- Run config section in SurveyView: `frontend/src/pages/SurveyView.tsx` lines 80–180 (`runOverrides`, `runDemographics`, `runSurvey`)
- `RunConfigCard` in SurveyResults: `frontend/src/pages/SurveyResults.tsx` lines 37–82

### Test Data
- Reference filter: `{ c_age: { min: 29, max: 30 }, c_gender: ["female"] }` → prompt `"You are a 29-30 year old female."`
- Use N=3 trials in E2E tests for speed
- Use `test+${Date.now()}@example.com` for unique test emails

## Out of Scope
- Results aggregation/visualization specific to `zero_shot_baseline` runs
- Backstory detail links for trial rows (just "Trial N" label is sufficient)
- Display name lookups for demographic keys in the prompt builder (stripped key name is fine)
- Balanced slot allocation for `zero_shot_baseline` runs
- Updating the existing `type='demographic'` demographic survey feature
- Retry UI changes specific to `zero_shot_baseline` runs
