# Feature: Fix Parser — Tier1 Detection + Open Response Cleanup

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description

Two parser fixes in the worker:

1. **OpenRouter Tier1 detection bug**: Structured JSON responses from OpenRouter are never parsed as JSON when using completions mode (`use_chat_template=False`), causing every MCQ/ranking/multiple_select to unnecessarily fall through to tier2_parser.
2. **Open response post-processing**: Currently accepts raw LLM output with zero cleanup. Needs clipping (model generating next question), sentence-boundary trimming, and HTML cleanup.

Also: increase log output from 80 chars to 200 chars for better debugging.

---

## Issue 1: OpenRouter Tier1 Structured Output Detection

### Root Cause

`llm.py:_parse_response()` lines 164-168:
```python
sent_json_schema = (
    self.provider == "vllm"
    or (self.provider == "openrouter" and self.use_chat_template)  # BUG
)
```

But `_build_create_params()` sends JSON schema for OpenRouter in **both** API modes:
- Chat mode: `{"response_format": rf}` (top-level kwarg)
- Completions mode: `{"extra_body": {"response_format": rf}}` (via extra_body)

So when `use_chat_template=False` (the default), `sent_json_schema=False`, and valid JSON responses like `{"ranking": ["C", "D", "E", "A", "B"]}` are never parsed as structured output. They fall through to text parsing (which fails on JSON), then to tier2_parser.

### Fix

Align `_parse_response` detection with `_build_create_params`. Replace the `sent_json_schema` logic:

```python
# We sent JSON schema for any question with options, EXCEPT vLLM MCQ
# (which uses extra_body.structured_outputs choice constraint instead).
sent_json_schema = (
    question.type != "mcq" or self.provider == "openrouter"
)
```

This is correct because `_build_create_params` sends JSON schema whenever:
- Provider is OpenRouter (all question types with options) — both chat and completions modes
- Provider is vLLM and question type is NOT mcq (multiple_select, ranking)

And does NOT send JSON schema when:
- Provider is vLLM and question type IS mcq (uses `extra_body.structured_outputs.choice` instead)

### Also: Increase log output length

Currently `repr(raw[:80])` in `worker.py` truncates to 80 chars, hiding useful debug info. Change all `[:80]` to `[:200]` in log lines.

---

## Issue 2: Open Response Post-Processing

### Current Behavior

`llm.py:_parse_response()` lines 183-185:
```python
if question and question.type == "open_response":
    return LLMResponse(answer=content.strip(), raw=content)
```

No cleanup at all.

### Required Post-Processing Pipeline

Create a new function `clean_open_response(text: str) -> str` in `response.py` with this pipeline:

#### Step 1: Clip at boundary markers
- If `<Q>` appears in the text, clip everything from `<Q>` onward (first occurrence)
- If `Question:` appears in the text (case-insensitive), clip everything from `Question:` onward
- These indicate the model started generating the next question

#### Step 2: HTML cleanup
- Use Python's built-in `html.unescape()` for HTML entities (`&amp;` → `&`, `&nbsp;` → space, etc.)
- Replace `<br>`, `<br/>`, `<br />` with newlines
- Strip any remaining HTML tags via simple regex `re.sub(r'<[^>]+>', '', text)`

#### Step 3: Trim to last sentence boundary
- If the text does NOT end with sentence-ending punctuation (`.`, `!`, `?`), find the last occurrence of any of these and trim there (inclusive of the punctuation)
- If the text already ends with `.`, `!`, or `?`, leave it as-is
- If no sentence-ending punctuation exists at all, keep the text as-is (don't destroy the response)

#### Step 4: Final cleanup
- Strip leading/trailing whitespace

### Integration Point

In `llm.py:_parse_response()`, replace:
```python
return LLMResponse(answer=content.strip(), raw=content)
```
with:
```python
from .response import clean_open_response
return LLMResponse(answer=clean_open_response(content), raw=content)
```

The `raw` field preserves the original unmodified response for logging/debugging.

---

## Technical Approach

### Files to Modify

| File | Changes |
|------|---------|
| `worker/src/llm.py` | Fix `sent_json_schema` condition in `_parse_response()`. Call `clean_open_response()` for open_response type. |
| `worker/src/response.py` | Add `clean_open_response()` function with the 4-step pipeline. Add `import html` at top. |
| `worker/src/worker.py` | Change `[:80]` to `[:200]` in all log lines that truncate raw output. |

### Files to Create

| File | Purpose |
|------|---------|
| `worker/tests/test_open_response_cleanup.py` | Unit tests for `clean_open_response()` |

### Files to Modify (tests)

| File | Changes |
|------|---------|
| `worker/tests/test_llm.py` | Add tests for OpenRouter completions mode structured output parsing |

---

## Pass Criteria

### Unit Tests — `clean_open_response()`

- [ ] **Clip at `<Q>`**: `"I think the answer is yes.<Q>Question: What do you..."` → `"I think the answer is yes."`
- [ ] **Clip at `Question:`**: `"I believe strongly in freedom. Question: How do you feel..."` → `"I believe strongly in freedom."`
- [ ] **Case-insensitive Question clip**: `"Yes definitely. question: next one"` → `"Yes definitely."`
- [ ] **HTML entity cleanup**: `"I don&amp;t think so"` → `"I don&t think so"` (after unescape)
- [ ] **BR tag cleanup**: `"Line one<br />Line two<br>Line three"` → `"Line one\nLine two\nLine three"`
- [ ] **Strip remaining HTML**: `"This is <b>bold</b> text"` → `"This is bold text"`
- [ ] **Trim at last sentence when fragment**: `"I agree with this policy. The reason is that we should consid"` → `"I agree with this policy."`
- [ ] **No trim when text ends with punctuation**: `"I agree with this policy."` → `"I agree with this policy."`
- [ ] **No trim when no punctuation exists**: `"Yes I think so"` → `"Yes I think so"`
- [ ] **Empty/whitespace input**: `""` → `""`, `"   "` → `""`
- [ ] **Multiple `<Q>` markers**: `"Answer here.<Q>Next<Q>More"` → `"Answer here."`
- [ ] **Combined pipeline**: HTML entities + clip + trim all applied in correct order
- [ ] **Only `Question:` at start of line or after sentence**: Don't clip if "Question" appears mid-sentence as a regular word (e.g., "That's a good question about policy.") — actually, this is tricky. Simplest approach: clip at `\nQuestion:` or at the start of the text. But the user said "if the model says 'Question:'" which implies it's generating a new question prompt. Use pattern: match `Question:` that is preceded by newline, start-of-string, or sentence-ending punctuation+space.

### Unit Tests — OpenRouter Tier1 Structured Output

- [ ] **OpenRouter completions MCQ**: Content `'{"answer": "B"}'`, parse correctly as `answer="B"` via `_parse_structured_response` (NOT tier2)
- [ ] **OpenRouter completions multiple_select**: Content `'{"choice_A": false, "choice_B": true, "choice_C": true, "choice_D": false}'`, parse as `answer="B,C"` via tier1
- [ ] **OpenRouter completions ranking**: Content `'{"ranking": ["C", "D", "E", "A", "B"]}'`, parse as `answer="C,D,E,A,B"` via tier1
- [ ] **OpenRouter chat MCQ**: Still works (regression check)
- [ ] **vLLM MCQ**: Still uses letter-constrained path, NOT json_schema parse (regression check)
- [ ] **vLLM multiple_select/ranking**: Still uses json_schema parse (regression check)
- [ ] **Truncated JSON still handled**: Invalid JSON → `answer=""` → tier2 fallback (existing behavior preserved)

### Log Length

- [ ] All `[:80]` in `worker.py` log lines changed to `[:200]`

### Acceptance Criteria

- [ ] OpenRouter with `use_chat_template=False` correctly parses structured JSON responses at tier1 (no unnecessary tier2 fallback)
- [ ] OpenRouter with `use_chat_template=True` continues to work (regression)
- [ ] vLLM guided decoding continues to work for all question types (regression)
- [ ] Open responses are cleaned: no HTML tags/entities, no model-generated next questions, no sentence fragments
- [ ] `raw` field in LLMResponse preserves the unmodified original response
- [ ] All existing tests pass
- [ ] No new external dependencies (uses only `html`, `re` from stdlib)

---

## Implementation Notes

### For the Implementing Agent

1. **Start with `clean_open_response()` tests** in a new `test_open_response_cleanup.py` — this is a pure function, easy to TDD
2. **Implement `clean_open_response()`** in `response.py`
3. **Fix `sent_json_schema`** in `llm.py:_parse_response()` — update the condition
4. **Add tier1 detection tests** in `test_llm.py`
5. **Update log lines** in `worker.py` — find-replace `[:80]` → `[:200]`
6. **Run all existing tests** to verify no regressions: `cd worker && python -m pytest tests/ -v`

### Reference Files
- Existing parsing: `worker/src/response.py` (add `clean_open_response` here)
- Structured output detection: `worker/src/llm.py:_parse_response()` (fix detection here)
- Tier 2 parser: `worker/src/parser.py` (not changing, just reference)
- Test patterns: `worker/tests/test_llm.py`, `worker/tests/test_guided_decoding.py`

### No External Dependencies
- `html.unescape()` is from Python's built-in `html` module
- `re` is already imported in `response.py`
- No pip install needed

### Edge Case: "Question" as a regular word
The `Question:` clip should NOT trigger on sentences like "That's a good question about policy." The colon after "Question" is the key differentiator — `Question:` with a colon is a prompt-style marker. The regex pattern should match `Question:` (with colon) which is unlikely in natural prose.

## Out of Scope
- Changing prompt templates (no `<Q>` injection into prompts)
- Changing the tier2 parser logic
- Changing max_tokens defaults
- JSON repair for truncated structured output
- Frontend changes
- Adding new question types
