# Feature: Logprobs Mode for Demographic Surveys

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description

Add a **logprobs distribution mode** for demographic surveys. Instead of asking each backstory the same question N times (current n_sample mode), logprobs mode asks **once** with `logprobs=True` and computes the probability distribution directly from the LLM's token log-probabilities. This is ~20x cheaper and faster than n_sample mode, and follows the approach in Anthology's `demographic_logprob_parser()`.

**Scope:** Demographic surveys only, vLLM provider only, MCQ questions only.

## Background & Reference

Anthology's `demographic_logprob_parser()` (`anthology/demographic_survey/response_parser.py:280-301`):
```python
def demographic_logprob_parser(logprobs, num_choices):
    result_dict = {chr(i + 65): 0.0 for i in range(num_choices)}
    for logprob in logprobs:
        token = logprob.token
        if token.startswith("("):
            token = token[-1]
        if token in result_dict:
            result_dict[token] += exp(logprob.logprob)
    return result_dict
```

## Technical Approach

### Files to Create

- **`worker/src/logprobs.py`** — Logprobs parsing utilities
  - `LogprobsResult` dataclass: `{generated_token: str, top_logprobs: Dict[str, float]}`
  - `parse_logprobs_to_distribution(top_logprobs: Dict[str, float], num_options: int) -> Dict[str, float]`
    - Cleans tokens: handles "A", "(A", " A" variants (following Anthology)
    - Accumulates `exp(logprob)` per option letter
    - Normalizes to sum=1, rounds to 4 decimal places
    - Returns letter-keyed dict: `{"A": 0.72, "B": 0.25, "C": 0.03}`
    - Edge case: if no matching tokens found, logs warning and returns uniform distribution

- **`worker/tests/test_logprobs.py`** — Unit tests for logprobs parsing

### Files to Modify

- **`worker/src/llm.py`** (`UnifiedLLMClient`) — Add `async_complete_logprobs()` method
  - New method that calls the LLM API with logprobs parameters
  - Forces `max_tokens=1`, `temperature=0.0`
  - **No structured output** (no guided decoding) — logprobs require unconstrained generation to get the true model distribution
  - Handles both API modes:
    - Chat API (`use_chat_template=True`): `logprobs=True, top_logprobs=20`
    - Completion API (`use_chat_template=False`): `logprobs=20`
  - Returns `LogprobsResult` with unified format regardless of API mode
  - Error handling: same `RetryableError`/`NonRetryableError` hierarchy as `async_complete()`

- **`worker/src/worker.py`** — Add `LogprobsSingle` filling strategy
  - New class implementing `FillingStrategy` protocol
  - For each question: builds prompt via `build_initial_prompt()`, calls `llm.async_complete_logprobs()`, parses result with `parse_logprobs_to_distribution()`
  - Only supports MCQ questions (raises `NonRetryableError` for other types)
  - Returns `{qkey: JSON_string_of_distribution}` (e.g., `'{"A": 0.72, "B": 0.25, "C": 0.03}'`)
  - No media support needed (demographic MCQ questions don't use media)

- **`worker/main.py`** — Route to LogprobsSingle strategy + handle logprobs result format
  - In demographic detection block (~line 236): check `distribution_mode`
    - `"logprobs"` → use `LogprobsSingle()` strategy
    - `"n_sample"` (default) → use `IndependentRepeat(num_trials=N)` (existing behavior)
  - In post-processing block (~line 256): branch on mode
    - `"logprobs"`: `json.loads(raw_data)` → already letter-keyed normalized distribution, pick `value = max(dist, key=dist.get)`
    - `"n_sample"`: existing `"||"` splitting and frequency counting (unchanged)
  - Import `LogprobsSingle` from `worker.py` and `json`

- **`frontend/src/components/demographic-surveys/DemographicKeyForm.tsx`** — Enable logprobs option
  - Remove `disabled` from the logprobs `<SelectItem>` (line 215)
  - Update the label: `"Logprobs (vLLM only)"` instead of `"Logprobs (vLLM only — coming soon)"`
  - When logprobs is selected: the "Trials per Backstory" field already hides (existing conditional on line 222 checks `value.distributionMode === 'n_sample'`)

- **`frontend/src/pages/DemographicSurveyCreate.tsx`** — Validate provider for logprobs mode
  - In the submit handler: when `formData.distributionMode === 'logprobs'`, check that effective provider is `'vllm'`
  - Show toast error if OpenRouter is selected with logprobs: "Logprobs mode requires vLLM provider"

### Key Decisions

1. **vLLM only**: OpenRouter may not reliably expose logprobs for all models. Restricting to vLLM keeps it simple and correct.

2. **No guided decoding in logprobs mode**: Structured output constrains the output space, which changes the logprob distribution. We need the unconstrained distribution to get meaningful probabilities. Instead, use `max_tokens=1` and extract from `top_logprobs`.

3. **Letter-keyed distributions**: Both modes store distributions with letter keys (`{"A": 0.72, "B": 0.25, "C": 0.03}`), consistent with the existing n_sample format. The frontend maps letters to option text at display time.

4. **JSON encoding in result**: The `LogprobsSingle` strategy encodes its distribution as a JSON string in the task result dict (since result values are `str`). `main.py` detects the mode and parses accordingly.

5. **Temperature 0**: Logprobs mode forces `temperature=0.0` for deterministic, interpretable distributions.

## Pass Criteria

### Unit Tests — `worker/tests/test_logprobs.py`

- [ ] `test_basic_distribution`: Given top_logprobs `{"A": -0.33, "B": -2.10, "C": -3.00}` with 3 options → returns normalized dict with correct proportions, sums to ~1.0
- [ ] `test_paren_token_handling`: Given `{"(A": -0.5, "(B": -2.0}` with 2 options → strips parens, maps to A, B correctly
- [ ] `test_space_prefixed_tokens`: Given `{" A": -0.5, " B": -2.0}` with 2 options → strips space, maps to A, B
- [ ] `test_accumulates_variants`: Given `{"A": -1.0, "(A": -1.5}` → both accumulate into A's probability
- [ ] `test_missing_options`: Given logprobs with only A and B tokens for 4 options → C, D get 0.0 probability
- [ ] `test_no_matching_tokens`: Given logprobs with only irrelevant tokens → returns uniform distribution (1/N for each option)
- [ ] `test_normalization`: Output probabilities sum to 1.0 (within `pytest.approx` tolerance)
- [ ] `test_irrelevant_tokens_ignored`: Tokens like "the", "answer", "is" don't affect distribution

### Unit Tests — `worker/tests/test_worker.py` additions

- [ ] `test_logprobs_single_strategy`: Mock `llm.async_complete_logprobs()` → verify `LogprobsSingle.fill()` returns JSON-encoded letter distribution
- [ ] `test_logprobs_single_rejects_non_mcq`: Verify `NonRetryableError` raised for `open_response` questions

### Frontend Tests

- [ ] `DemographicKeyForm`: logprobs option is selectable (not disabled)
- [ ] `DemographicKeyForm`: selecting logprobs hides "Trials per Backstory" input
- [ ] `DemographicSurveyCreate`: shows error when logprobs + non-vLLM provider

### Acceptance Criteria

- [ ] Logprobs option is selectable in DemographicKeyForm advanced settings
- [ ] Logprobs mode calls LLM once per backstory (not N times)
- [ ] Distribution is correctly computed from token log-probabilities
- [ ] Distribution is normalized (sums to 1.0)
- [ ] Result is written to `backstories.demographics[key]` with same `{value, distribution}` format as n_sample
- [ ] n_sample mode continues to work unchanged (backward compatible)
- [ ] Validation: vLLM only, MCQ only
- [ ] Worker logs clearly indicate which mode is used: `"using LogprobsSingle"` vs `"using IndependentRepeat(n=20)"`

## Implementation Notes

### For the Implementing Agent

**Implementation order:**
1. `worker/src/logprobs.py` — Pure functions, easy to test in isolation
2. `worker/tests/test_logprobs.py` — Write tests (TDD)
3. `worker/src/llm.py` — Add `async_complete_logprobs()` method
4. `worker/src/worker.py` — Add `LogprobsSingle` strategy class
5. `worker/main.py` — Wire up routing and post-processing
6. Frontend changes (DemographicKeyForm, DemographicSurveyCreate)

**OpenAI SDK logprobs response structures (both supported by vLLM):**

Chat API (`/v1/chat/completions` — when `use_chat_template=True`):
```python
response = await client.chat.completions.create(
    model=model, messages=[...],
    logprobs=True, top_logprobs=20, max_tokens=1, temperature=0.0,
)
# response.choices[0].logprobs.content[0].top_logprobs
# → List[ChatCompletionTokenLogprob(token="A", logprob=-0.33, bytes=[65])]
```

Completion API (`/v1/completions` — when `use_chat_template=False`):
```python
response = await client.completions.create(
    model=model, prompt="...",
    logprobs=20, max_tokens=1, temperature=0.0,
)
# response.choices[0].logprobs.top_logprobs[0]
# → Dict[str, float]: {"A": -0.33, "B": -2.10, ...}
```

Both return different structures — `async_complete_logprobs()` must normalize into the common `LogprobsResult` dataclass.

**Existing patterns to follow:**
- Strategy pattern in `worker/src/worker.py` — `LogprobsSingle` implements same `FillingStrategy` protocol as `IndependentRepeat` and `SeriesWithContext`
- Error handling in `worker/src/llm.py` — same `RetryableError`/`NonRetryableError` hierarchy
- Frontend config flow: `DemographicKeyForm` → `DemographicSurveyCreate` → `surveyRunner.createDemographicSurveyRun()` → `survey_runs.llm_config`

**Config flow (already wired end-to-end, just not consumed):**
```
DemographicKeyForm.distributionMode
  → DemographicSurveyCreate bundles into llmConfig.distribution_mode
    → surveyRunner stores in survey_runs.llm_config
      → Worker reads via db.get_demographic_key_for_survey() (line 507)
        → main.py selects strategy based on distribution_mode
```

**Common gotchas:**
- Don't use guided decoding with logprobs — it constrains the output and changes the probability distribution
- The Completion API uses `logprobs=N` (integer), Chat API uses `logprobs=True` + `top_logprobs=N` — different param names
- Token `" A"` (with space prefix) is common in BPE tokenizers — must strip leading whitespace
- `json.loads()` in main.py for logprobs mode vs `"||"` splitting for n_sample — use explicit mode check, don't try/except

### Database

No schema changes needed. `distribution_mode` and `num_trials` are already part of the `llm_config` JSONB stored on `survey_runs`. The `db.get_demographic_key_for_survey()` method already reads `distribution_mode` from `llm_config` (see `worker/src/db.py:507`).

## Out of Scope

- OpenRouter logprobs support
- Logprobs for regular (non-demographic) surveys
- Logprobs for non-MCQ question types (multiple_select, ranking, open_response)
- UI to display logprobs distributions differently from n_sample distributions
- Streaming logprobs
- Batching logprobs requests across backstories
