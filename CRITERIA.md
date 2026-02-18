# Feature: Expand vLLM Guided Decoding to All Question Types

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description

Expand vLLM guided decoding beyond MCQ to support **multiple select**, **ranking**, and **open response** question types. Currently only MCQ uses `structured_outputs.choice` to constrain output to a single letter. The other three types fall back to raw text parsing which fails badly with base models.

**Approach:** Use `structured_outputs.regex` for multiple_select and ranking (dynamically generated regex based on option count), skip guided decoding for open_response but fix the parsing/stop-sequence issues so raw text is used as the answer.

**Key constraint:** Option count is user-defined and variable (2–10+), so the regex character class must be dynamically generated (e.g., 3 options → `[A-C]`, 6 options → `[A-F]`).

## Problem Statement

For vLLM (base models), non-MCQ question types are essentially broken:
- **Multiple select**: `from_text()` only extracts a single letter, losing the multi-selection semantics
- **Ranking**: `from_text()` extracts only the first letter, losing the ordering
- **Open response**: `from_text()` tries to extract a letter and fails; stop sequences (`\n`, `.`) cut off responses after one sentence
- **Parser LLM (Tier 2)** is MCQ-only — non-MCQ types get no fallback
- **Compliance forcing** retries 10 times but always fails since parsing can't handle the format

## Technical Approach

### Files to Modify

- **`worker/src/llm.py`** — Core changes:
  - `VLLMClient.complete()`: Expand guided decoding logic from MCQ-only to all types with options
  - `VLLMClient._make_request()`: Accept `guided_regex` parameter alongside existing `guided_choices`; handle different stop sequence and max_tokens strategies per type
  - Add `LLMResponse.from_comma_separated()` class method for parsing comma-separated letter lists (used by both multiple_select and ranking)
  - Add open_response handling: use raw text directly as the answer

- **`worker/src/worker.py`** — Changes:
  - `process_questions_in_series()`: Extend Tier 2 (parser LLM) to handle multiple_select and ranking, not just MCQ
  - Modify compliance forcing loop: skip retries for open_response (any text is valid)
  - Add validation logic for multiple_select (valid letters, no duplicates) and ranking (complete permutation)

- **`worker/src/parser.py`** — Changes:
  - Extend `ParserLLM.parse()` to support multiple_select and ranking with type-specific prompt templates
  - Add `PARSER_PROMPT_MULTIPLE_SELECT` and `PARSER_PROMPT_RANKING` templates

- **`worker/src/prompt.py`** — No changes needed (existing prompts are already correct)

### Files to Create
- **`worker/tests/test_guided_decoding_expand.py`** — Tests for the new guided decoding support

### Key Decisions

1. **`structured_outputs.regex` for multiple_select and ranking**: vLLM supports regex-based guided decoding alongside choice-based. This constrains output to comma-separated letters without exponential enumeration. Dynamic regex based on option count handles variable-length option lists.

2. **Dynamic regex generation**: For N options, the regex character class is `[A-{chr(64+N)}]`. Examples:
   - 3 options: `[A-C]`
   - 4 options: `[A-D]`
   - 8 options: `[A-H]`
   - Multiple select pattern: `[A-D](, [A-D])*` (1+ letters, comma-space separated)
   - Ranking pattern: `[A-D](, [A-D]){3}` (exactly N letters, comma-space separated)

3. **Post-validation with compliance retry**: Regex can't enforce no-duplicates or completeness. Post-validation catches these, and the existing compliance retry loop (10 attempts) handles re-prompting. This is simpler than grammar-based approaches.

4. **Open response: no guided decoding, different stop sequences**: Base models generate natural text for open response. Remove `"\n"` and `"."` from stop sequences (keep `"Question:"` to prevent self-prompting). Use raw text as the answer.

5. **Parser LLM extended for all types**: Currently Tier 2 only handles MCQ. Extend it with type-specific prompts for multiple_select ("extract comma-separated letters") and ranking ("extract ordered letters"). Skip parser for open_response.

## API Details

### vLLM Completions API — Regex Guided Decoding

```json
POST /v1/completions
{
  "model": "meta-llama/Llama-3-70b",
  "prompt": "...Select all that apply. Answer with comma-separated letters (e.g., A, C, D).\nAnswer:",
  "temperature": 1.0,
  "max_tokens": 12,
  "structured_outputs": {
    "regex": "[A-D](, [A-D])*"
  }
}
```

Response: `{"choices": [{"text": "A, C, D", ...}]}`

### Per-Type Configuration Summary

| Type | Guided Decoding | Regex Pattern | max_tokens | Stop Sequences |
|------|-----------------|---------------|------------|----------------|
| `mcq` | `choice` (existing) | N/A | `1` | removed |
| `multiple_select` | `regex` | `[A-{X}](, [A-{X}])*` | `3*N` | removed |
| `ranking` | `regex` | `[A-{X}](, [A-{X}]){N-1}` | `3*N` | removed |
| `open_response` | **none** | N/A | `max_tokens` (default 512) | `["Question:"]` only |

Where `X = chr(64 + N)` and `N = len(options)`.

### Post-Validation Rules

| Type | Validation | On Failure |
|------|-----------|------------|
| `mcq` | Letter in valid range | Retry (existing) |
| `multiple_select` | All letters valid, deduplicate | Return deduplicated result (always valid after regex) |
| `ranking` | All N letters present, no duplicates | Return empty → compliance retry |
| `open_response` | Always valid (non-empty text) | Accept as-is |

## Pass Criteria

### Unit Tests — Guided Decoding Expansion

#### Multiple Select Guided Decoding
- [ ] `test_vllm_multiple_select_uses_guided_regex`: VLLMClient sends `structured_outputs.regex` with correct pattern for multiple_select questions
- [ ] `test_vllm_multiple_select_dynamic_options`: Regex pattern adjusts to option count (2 options → `[A-B]`, 5 options → `[A-E]`)
- [ ] `test_vllm_multiple_select_max_tokens`: max_tokens is set to `3 * len(options)` (enough for all letters + separators)
- [ ] `test_vllm_multiple_select_parses_comma_list`: Response "A, C, D" is parsed as "A,C,D"
- [ ] `test_vllm_multiple_select_deduplicates`: Response "A, A, C" is deduplicated to "A,C"
- [ ] `test_vllm_multiple_select_single_letter`: Response "B" is parsed as "B" (single selection is valid)

#### Ranking Guided Decoding
- [ ] `test_vllm_ranking_uses_guided_regex`: VLLMClient sends `structured_outputs.regex` with correct pattern for ranking questions
- [ ] `test_vllm_ranking_enforces_exact_count`: Regex pattern requires exactly N letters (e.g., `{3}` for 4 options)
- [ ] `test_vllm_ranking_parses_complete_permutation`: Response "B, A, C, D" is parsed as "B,A,C,D"
- [ ] `test_vllm_ranking_rejects_duplicates`: Response "A, A, C, D" returns empty answer (triggers compliance retry)
- [ ] `test_vllm_ranking_rejects_incomplete`: Response "A, B" (missing letters) returns empty answer

#### Open Response Handling
- [ ] `test_vllm_open_response_no_guided_decoding`: Open response questions do NOT use `structured_outputs`
- [ ] `test_vllm_open_response_uses_raw_text`: Raw response text is used directly as the answer
- [ ] `test_vllm_open_response_stop_sequences`: Only `"Question:"` is used as stop sequence (not `"\n"` or `"."`)
- [ ] `test_vllm_open_response_no_compliance_retry`: Open response skips compliance forcing (any non-empty text is valid)
- [ ] `test_vllm_open_response_empty_retries`: Empty response still triggers retry (model produced nothing)

#### Existing MCQ (Regression)
- [ ] `test_vllm_mcq_still_uses_choice`: MCQ guided decoding unchanged (still uses `structured_outputs.choice`)
- [ ] All existing tests in `test_guided_decoding.py` still pass

#### Parser LLM Extension (Tier 2)
- [ ] `test_parser_llm_multiple_select`: Parser LLM extracts comma-separated letters for multiple_select
- [ ] `test_parser_llm_ranking`: Parser LLM extracts ordered comma-separated letters for ranking
- [ ] `test_parser_llm_prompt_format_multiple_select`: Parser prompt instructs "Answer as comma-separated letters" for multiple_select
- [ ] `test_parser_llm_prompt_format_ranking`: Parser prompt instructs "Answer as ordered comma-separated letters" for ranking

#### Integration Flow
- [ ] `test_compliance_retry_ranking_invalid_permutation`: When ranking response has duplicates, compliance loop retries and eventually gets valid permutation
- [ ] `test_context_accumulation_multiple_select`: Context includes full "A, C, D" answer for subsequent questions
- [ ] `test_context_accumulation_open_response`: Context includes full text response for subsequent questions
- [ ] `test_mixed_question_types_in_series`: Survey with MCQ + multiple_select + open_response + ranking processes all types correctly in sequence

### Acceptance Criteria
- [ ] Multiple select questions sent to vLLM include `structured_outputs.regex` with dynamic pattern
- [ ] Ranking questions sent to vLLM include `structured_outputs.regex` with exact-count pattern
- [ ] Open response questions use raw text as answer without letter extraction
- [ ] Open response uses relaxed stop sequences (`"Question:"` only, not `"\n"` or `"."`)
- [ ] Regex patterns are dynamically generated based on actual option count (not hardcoded to 4)
- [ ] Post-validation deduplicates multiple_select and validates ranking completeness
- [ ] Compliance retry is skipped for open_response (except empty response)
- [ ] Parser LLM (Tier 2) supports multiple_select and ranking, not just MCQ
- [ ] All existing MCQ guided decoding tests pass unchanged
- [ ] Context accumulation works for all four question types

## Implementation Notes

### For the Implementing Agent

1. **Start with tests** — write `test_guided_decoding_expand.py` first, covering all new test cases above.

2. **Modify `VLLMClient.complete()`** — Replace the MCQ-only condition with a type-aware dispatch:
   ```python
   # Current (MCQ only):
   if self.use_guided_decoding and question.type == "mcq" and question.options:
       guided_choices = [chr(65 + i) for i in range(len(question.options))]

   # New (all types):
   guided_params = None
   if self.use_guided_decoding and question is not None and question.options:
       n = len(question.options)
       last = chr(64 + n)  # 'D' for 4 options
       if question.type == "mcq":
           guided_params = ("choice", [chr(65 + i) for i in range(n)])
       elif question.type == "multiple_select":
           guided_params = ("regex", f"[A-{last}](, [A-{last}])*")
       elif question.type == "ranking":
           guided_params = ("regex", f"[A-{last}](, [A-{last}]){{{n-1}}}")
       # open_response: None (no guided decoding)
   ```

3. **Modify `VLLMClient._make_request()`** — Accept a `guided_params` tuple instead of just `guided_choices`. Handle both `choice` and `regex` types:
   ```python
   if guided_params:
       param_type, param_value = guided_params
       payload["structured_outputs"] = {param_type: param_value}
       payload.pop("stop", None)
       if param_type == "choice":
           payload["max_tokens"] = 1
       elif param_type == "regex":
           payload["max_tokens"] = 3 * num_options
   ```

4. **Handle open_response stop sequences** — When `question.type == "open_response"`, only use `["Question:"]` as stop sequences instead of the default `["\n", ".", "Question:"]`.

5. **Add `LLMResponse.from_comma_separated()`** — New class method:
   ```python
   @classmethod
   def from_comma_separated(cls, text: str, num_options: int, require_all: bool = False):
       """Parse comma-separated letters. require_all=True for ranking."""
       letters = [l.strip().upper() for l in text.split(",")]
       valid = {chr(65 + i) for i in range(num_options)}
       # Deduplicate while preserving order
       seen = set()
       result = []
       for letter in letters:
           if letter in valid and letter not in seen:
               seen.add(letter)
               result.append(letter)
       if require_all and set(result) != valid:
           return cls(answer="", raw=text)  # Incomplete → retry
       if result:
           return cls(answer=",".join(result), raw=text)
       return cls(answer="", raw=text)
   ```

6. **Response dispatch in `_make_request()`** — After getting the response text:
   ```python
   if guided_params:
       param_type, param_value = guided_params
       if param_type == "choice":
           # MCQ: existing logic
           if content.upper() in param_value:
               return LLMResponse(answer=content.upper(), raw=content)
       elif param_type == "regex":
           if question.type == "multiple_select":
               return LLMResponse.from_comma_separated(content, len(question.options), require_all=False)
           elif question.type == "ranking":
               return LLMResponse.from_comma_separated(content, len(question.options), require_all=True)
   # Open response or fallback
   if question and question.type == "open_response":
       text = content.strip()
       return LLMResponse(answer=text if text else "", raw=content)
   return LLMResponse.from_text(content)
   ```

7. **Worker compliance loop changes** — In `process_questions_in_series()`:
   - For `open_response`: accept any non-empty response as valid, skip Tier 2/3 parsing
   - Extend Tier 2 condition: `if not answer and question.type in ("mcq", "multiple_select", "ranking") and self.parser_llm`
   - For Tier 3 (`match_option_text`): keep for MCQ only (doesn't make sense for multi-select/ranking)

8. **Extend `ParserLLM`** — Add type-specific prompts:
   ```
   # Multiple select prompt:
   "Answer as comma-separated uppercase letters (e.g., A, C, D). If no match, answer 'X'."

   # Ranking prompt:
   "Answer as ordered comma-separated uppercase letters from most to least preferred
   including ALL options (e.g., B, A, C, D). If no match, answer 'X'."
   ```

9. **Important: `_make_request` needs the question object** — Currently `_make_request` only receives `guided_choices`. To dispatch correctly for regex responses, it also needs `question.type` and `len(question.options)`. Either pass the question object or pass enough metadata alongside `guided_params`.

10. **Reference existing patterns**:
    - Current MCQ guided decoding: `worker/src/llm.py:469-476`
    - Current prompt formatting: `worker/src/prompt.py:77-124`
    - vLLM `structured_outputs.regex` API: confirmed in vLLM docs
    - Compliance forcing loop: `worker/src/worker.py:148-184`

### Test Data
- Use mock HTTP responses (existing pattern with `patch("httpx.Client")`)
- Test with variable option counts: 2, 3, 4, 5, 8 options
- Test comma-separated responses: `"A, C, D"`, `"B"`, `"A, A, C"` (duplicate), `"B, A, C, D"` (complete ranking)
- Test open response: `"I think climate change is a serious issue that requires immediate action"`, empty string

### Edge Cases
- **1 option multiple_select**: Regex `[A-A]` = just "A" — degenerate but valid
- **2 option ranking**: Regex `[A-B](, [A-B]){1}` — either "A, B" or "B, A"
- **Very long open response**: Respect `max_tokens` setting, context accumulation includes full text
- **Empty guided regex response**: Should trigger compliance retry
- **Mixed survey**: MCQ → multiple_select → open_response → ranking in one survey

## Out of Scope
- OpenRouter changes (already handles all types via JSON schema)
- Prompt format changes (existing prompts are already correct for each type)
- Grammar-based guided decoding (regex is sufficient)
- Duplicate enforcement at token level (handled by post-validation + retry)
- Option randomization
- Parser LLM cost tracking
