# Feature: vLLM Guided Decoding for MCQ Parsing

## Status
- [x] Planning complete
- [ ] Ready for implementation

## Description

Replace the fragile regex-based MCQ response parsing for vLLM (base models) with **guided decoding** using vLLM's `structured_outputs.choice` parameter. This constrains token generation at the model level, guaranteeing only valid option letters (A, B, C, D, etc.) can be produced — eliminating the "I think" bug and all other parsing failures for MCQ questions.

**Three-tier parsing strategy (priority order):**
1. **Guided decoding** (`structured_outputs.choice`) — constrains generation to valid letters only
2. **Parser LLM fallback** — if guided decoding is unavailable or fails, use a cheap instruction-tuned model to extract the answer (like Alterity's approach)
3. **Existing regex** — keep current `from_text()` as last resort

**Scope:** vLLM only. OpenRouter already uses JSON schema with enum constraint.

## Problem Statement

Base models often don't follow instructions and produce free-form text instead of a clean option letter. Current regex parsing has ~12 hardcoded negative lookaheads (`I'm`, `I think`, `I am`, etc.) and still fails on some responses out of 1000 runs. The postdoc's recommendation: use vLLM guided decoding with literal types.

## Technical Approach

### Files to Modify

- **`worker/src/llm.py`** — Main changes:
  - `VLLMClient._make_request()`: Add `structured_outputs.choice` to payload for MCQ questions
  - `VLLMClient.complete()`: Accept question metadata to determine if guided decoding should be used
  - `VLLMClient`: Add `_make_guided_request()` method for guided decoding path
  - Keep `from_text()` as-is (used as tier 3 fallback and by non-MCQ questions)

- **`worker/src/worker.py`** — Changes:
  - `TaskProcessor.process_questions_in_series()`: Pass question type/options info to LLM client so it can enable guided decoding for MCQ
  - Integrate parser LLM fallback (tier 2) when guided decoding fails or is unavailable
  - Add `ParserLLM` integration for tier 2 fallback

- **`worker/src/config.py`** — Changes:
  - Add `parser_llm_endpoint` and `parser_llm_model` config for the fallback parser LLM
  - Add `use_guided_decoding: bool` config flag (default: True)

### Files to Create

- **`worker/src/parser.py`** — New module for tier 2 parser LLM:
  - `ParserLLM` class that calls a cheap instruction-tuned model to extract answer letters
  - Prompt template following Alterity's approach: "Answer ONLY as a single upper-case character. DO NOT infer..."
  - Falls back gracefully if parser LLM is not configured

- **`worker/tests/test_guided_decoding.py`** — Tests for the new guided decoding flow

### Key Decisions

1. **`structured_outputs.choice` over `guided_regex`**: The `choice` parameter is simpler and exactly matches our use case (select one of N literals). No regex escaping needed.

2. **`max_tokens=1` for MCQ guided decoding**: Since we're constraining to single letters, we only need 1 token. This is faster and cheaper. For other question types (ranking, multiple_select, open_response), keep existing max_tokens.

3. **Pass question metadata through `complete()`**: The `complete()` method needs to know the question type and valid options to enable guided decoding. We'll extend the interface with an optional `question` parameter rather than changing `response_schema` semantics.

4. **Parser LLM is optional**: If `parser_llm_api_key` is not configured, tier 2 is skipped and we fall directly to regex (tier 3). This keeps the system working without extra infrastructure.

5. **vLLM API version compatibility**: Use the new `structured_outputs` field (not the deprecated `guided_choice`). The existing test `test_vllm_uses_guided_json` references the old API — update it.

## API Details

### vLLM Completions API with guided decoding

```json
POST /v1/completions
{
  "model": "meta-llama/Llama-3-70b",
  "prompt": "...",
  "temperature": 1.0,
  "max_tokens": 1,
  "stop": ["\n"],
  "structured_outputs": {
    "choice": ["A", "B", "C", "D"]
  }
}
```

Response: `{"choices": [{"text": "B", ...}]}`

### Parser LLM prompt (tier 2)

```
You are given a question and a response to that question.
Please select the option specified in the question that strictly matches the response.

Requirements:
Answer ONLY as a single upper-case character.
DO NOT infer what option matches the response: if there is no strict match, answer 'X'.

Question: {question_text}
{options}

Response: {raw_llm_response}

Answer:
```

## Pass Criteria

### Unit Tests

#### Guided Decoding (Tier 1)
- [ ] `test_vllm_mcq_uses_guided_choice`: VLLMClient sends `structured_outputs.choice` with correct letters (A, B, C, ...) for MCQ questions
- [ ] `test_vllm_mcq_guided_max_tokens_1`: MCQ requests use `max_tokens=1`
- [ ] `test_vllm_non_mcq_no_guided_choice`: Non-MCQ questions (open_response, ranking, multiple_select) do NOT use guided_choice
- [ ] `test_vllm_guided_decoding_returns_valid_letter`: Response from guided decoding is correctly parsed as single letter
- [ ] `test_vllm_guided_decoding_disabled_flag`: When `use_guided_decoding=False`, falls back to text-only mode
- [ ] `test_vllm_guided_choice_dynamic_options`: Choice list matches actual number of options (e.g., 2 options → ["A", "B"], 5 options → ["A", "B", "C", "D", "E"])

#### Parser LLM Fallback (Tier 2)
- [ ] `test_parser_llm_extracts_letter`: ParserLLM correctly extracts letter from verbose response
- [ ] `test_parser_llm_returns_empty_on_X`: ParserLLM returns empty string when parser responds with "X"
- [ ] `test_parser_llm_not_configured_skips`: When parser LLM not configured, tier 2 is skipped gracefully
- [ ] `test_parser_llm_prompt_format`: Parser prompt includes question text, options, and raw response

#### Existing Regex (Tier 3) — No Changes
- [ ] Existing `TestFromText` tests still pass (regression)

#### Integration Flow
- [ ] `test_compliance_forcing_with_guided_decoding`: Compliance forcing loop uses guided decoding on each retry
- [ ] `test_fallback_chain_guided_then_parser_then_regex`: When guided decoding returns empty, tries parser LLM, then regex
- [ ] `test_context_accumulation_with_guided_answer`: Context accumulation works correctly when answer comes from guided decoding (raw response is just the letter)

### Acceptance Criteria
- [ ] MCQ questions sent to vLLM include `structured_outputs.choice` in the request payload
- [ ] `max_tokens=1` is used for MCQ guided decoding requests
- [ ] Non-MCQ question types are unaffected (no guided decoding applied)
- [ ] Parser LLM fallback works when guided decoding is unavailable
- [ ] Parser LLM is optional (system works without it configured)
- [ ] Existing regex parsing (`from_text()`) is preserved as tier 3 fallback
- [ ] All existing tests pass without modification (except updating deprecated `guided_json` test)
- [ ] Context accumulation still works (raw answer appended to context)

## Implementation Notes

### For the Implementing Agent

1. **Start with tests** — write `test_guided_decoding.py` first
2. **Extend `VLLMClient.complete()` signature** — add optional `question: Question` parameter (keep `response_schema` for backward compat). When `question` is provided and `question.type == "mcq"`, enable guided decoding.
3. **VLLMClient._make_request()** — modify to accept `guided_choices: Optional[List[str]]` and `max_tokens_override`. When guided_choices is set, add `structured_outputs.choice` to payload and set `max_tokens=1`.
4. **Worker integration** — in `process_questions_in_series()`, pass `question` to `self.llm.complete(prompt, question=question)` so VLLMClient knows when to use guided decoding.
5. **Parser LLM** — create a simple `ParserLLM` class that uses OpenRouter or another instruction-tuned model. Follow Alterity's prompt exactly. Integrate into the compliance forcing loop in worker.py.
6. **Context accumulation edge case** — when guided decoding produces just "A" as raw, the context becomes `"...Answer: A"` which is fine. But if parser LLM is used, store the original raw response (not the parser's response) in context.
7. **Reference patterns**:
   - vLLM guided decoding: `structured_outputs.choice` in request body (not `extra_body`)
   - Alterity parser: `alterity/survey/opinion_poll_survey_executor.py:parse_response()`
   - Anthology regex: `anthology/survey/atp_survey.py:regex_letter_classifier()`

### Config defaults
```python
use_guided_decoding: bool = True
parser_llm_provider: str = "openrouter"  # or "vllm"
parser_llm_model: str = "google/gemini-2.0-flash-001"  # cheap, fast
parser_llm_api_key: str = ""  # empty = skip tier 2
parser_llm_max_tokens: int = 4  # just need a single letter
parser_llm_temperature: float = 0.0  # deterministic parsing
```

### Test Data
- Use mock HTTP responses (existing pattern with `patch("httpx.Client")`)
- Test MCQ with 2, 4, and 5+ options
- Test verbose base model responses: `"I think I'm going with option B because..."`, `"Well, honestly I feel like..."`, `"B."`, `" B"`, `"(B)"`

## Out of Scope
- OpenRouter parsing changes (already uses JSON schema)
- Multiple select / ranking / open response guided decoding (future work)
- Changing the prompt format itself (Answer: forcing prompt stays the same)
- Adding option randomization (Anthology has it, but not in current scope)
- Parser LLM cost tracking/billing
