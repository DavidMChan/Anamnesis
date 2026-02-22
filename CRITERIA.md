# Feature: Worker Prompt & LLM Refactor

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description
Refactor the worker's LLM layer and question-filling pipeline to be dramatically simpler and more extensible. Replace two separate LLM clients (OpenRouter + vLLM, 900+ LOC) with a single unified client using the standard OpenAI Python SDK. Replace hand-rolled HTTP requests and guided decoding with vLLM's native `structured_outputs` via `extra_body`. Drop Tier 3 parsing (regex text matching). Introduce a strategy pattern for filling algorithms so new approaches can be plugged in trivially.

## Current Pain Points
1. **Two near-identical LLM clients** (`OpenRouterClient`: 315 LOC, `VLLMClient`: 342 LOC) with duplicated retry, error handling, and response parsing
2. **Hand-rolled HTTP requests** via `httpx` instead of using the `openai` SDK
3. **Guided decoding implemented manually** in the HTTP payload instead of using vLLM's built-in `extra_body={"structured_outputs": {"choice": [...]}}`
4. **Three-tier parsing** (guided -> parser LLM -> regex matching) is overengineered; Tier 3 (`match_option_text`) is rarely needed
5. **No strategy pattern** -- can't easily swap filling algorithms (e.g., series-with-context vs. parallel-independent)
6. **vLLM uses legacy Completions API** (`/v1/completions`) instead of Chat Completions API

## Technical Approach

### Architecture: Before -> After

```
BEFORE (953 LOC in llm.py):
  OpenRouterClient (httpx, manual json_schema)         -- 315 LOC
  VLLMClient (httpx, /v1/completions, hand-rolled guided decoding) -- 342 LOC
  LLMClient factory
  LLMResponse with 4 parsing classmethods              -- ~160 LOC

AFTER (~300 LOC in llm.py):
  UnifiedLLMClient (openai SDK, works for both providers)
  LLMResponse (simplified, keep from_json + from_text)
```

```
BEFORE (438 LOC in worker.py):
  TaskProcessor with hardcoded series-with-context + 3-tier parsing

AFTER:
  FillingStrategy protocol
  SeriesWithContextStrategy (default -- current behavior, minus Tier 3)
  TaskProcessor delegates to strategy
```

### Key Design Decisions

1. **Unified OpenAI SDK client**: Both OpenRouter and vLLM expose OpenAI-compatible APIs. Use `openai.AsyncOpenAI(base_url=..., api_key=...)` for both. This eliminates all hand-rolled HTTP code.

2. **vLLM guided decoding via `extra_body`**: Instead of manually constructing `structured_outputs` in the HTTP payload, use the SDK's `extra_body` param:
   ```python
   # MCQ: constrain to single letter
   client.chat.completions.create(
       ...,
       extra_body={"structured_outputs": {"choice": ["A", "B", "C", "D"]}},
   )
   # Multiple select / ranking: regex constraint
   client.chat.completions.create(
       ...,
       extra_body={"structured_outputs": {"regex": "[A-D](, [A-D])*"}},
   )
   ```

3. **OpenRouter structured output via `response_format`**: Same SDK, different param:
   ```python
   client.chat.completions.create(
       ...,
       response_format={"type": "json_schema", "json_schema": {...}},
   )
   ```

4. **Drop Tier 3** (regex text matching in `match_option_text`): Keep Tier 1 (structured output) + Tier 2 (parser LLM fallback). Tier 3 adds complexity for marginal benefit.

5. **Strategy pattern for filling**: Define a `FillingStrategy` protocol with `async def fill(backstory, questions, llm, parser) -> Dict[str, str]`. The default `SeriesWithContext` implements the current anthology approach.

6. **vLLM switches to Chat Completions API**: Since we're using instruct/chat models with guided decoding, use `/v1/chat/completions` instead of `/v1/completions`.

### Files to Modify

- **`worker/src/llm.py`** -- Replace `OpenRouterClient` + `VLLMClient` with single `UnifiedLLMClient` using `openai` SDK. Keep error classes. Simplify `LLMResponse`.
- **`worker/src/worker.py`** -- Extract filling logic into `FillingStrategy` protocol. Keep `TaskProcessor` as orchestrator. Remove `match_option_text` (Tier 3).
- **`worker/src/prompt.py`** -- Keep formatting functions as-is. Keep `get_response_schema()` (still needed for OpenRouter json_schema).
- **`worker/src/parser.py`** -- Simplify: use `openai` SDK instead of raw `httpx`.
- **`worker/src/config.py`** -- Simplify `LLMConfig`: remove provider-split fields, unify into `base_url`, `api_key`, `model`.
- **`worker/main.py`** -- Update `create_llm_client()` and `create_parser_llm()` for new unified client.

### Files to Update (tests)

- **`worker/tests/test_llm.py`** -- Update for unified client
- **`worker/tests/test_guided_decoding.py`** -- Update for `extra_body` approach
- **`worker/tests/test_guided_decoding_expand.py`** -- Update or merge into test_guided_decoding
- **`worker/tests/test_worker.py`** -- Update for strategy pattern
- **`worker/tests/test_async_worker.py`** -- Update for strategy pattern

### Dependencies

- **Add**: `openai>=1.0` to `requirements.txt`
- **Keep**: `httpx` (used internally by openai SDK; parser.py may also still use it)

## Detailed Design

### 1. Unified LLM Client (`llm.py`)

```python
from openai import AsyncOpenAI, OpenAI

class UnifiedLLMClient:
    """Single LLM client for both OpenRouter and vLLM via OpenAI SDK."""

    def __init__(
        self,
        base_url: str,          # "https://openrouter.ai/api/v1" or "http://gpu:8000/v1"
        api_key: str,
        model: str,
        provider: str,          # "openrouter" or "vllm" -- affects structured output method
        temperature: float = 0.0,
        max_tokens: int | None = 512,
        max_retries: int = 3,
        use_guided_decoding: bool = True,
    ):
        self.model = model
        self.provider = provider
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.use_guided_decoding = use_guided_decoding

        self._sync_client = OpenAI(
            base_url=base_url, api_key=api_key, max_retries=max_retries
        )
        self._async_client = AsyncOpenAI(
            base_url=base_url, api_key=api_key, max_retries=max_retries
        )

    def _build_create_params(self, question: Question | None) -> dict:
        """
        Build the kwargs for chat.completions.create() based on provider + question type.

        For vLLM: returns extra_body with structured_outputs (choice/regex)
        For OpenRouter: returns response_format with json_schema
        """
        if not self.use_guided_decoding or not question or not question.options:
            return {}

        n = len(question.options)
        letters = [chr(65 + i) for i in range(n)]
        last = letters[-1]

        if self.provider == "vllm":
            if question.type == "mcq":
                return {"extra_body": {"structured_outputs": {"choice": letters}}}
            elif question.type == "multiple_select":
                return {"extra_body": {"structured_outputs": {"regex": f"[A-{last}](, [A-{last}])*"}}}
            elif question.type == "ranking":
                return {"extra_body": {"structured_outputs": {"regex": f"[A-{last}](, [A-{last}]){{{n-1}}}"}}}
        elif self.provider == "openrouter":
            schema = get_response_schema(question)
            return {
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "answer", "strict": True, "schema": schema}
                }
            }
        return {}

    def _effective_max_tokens(self, question: Question | None) -> int | None:
        """Determine max_tokens based on question type and guided decoding."""
        if not question:
            return self.max_tokens
        if self.provider == "vllm" and self.use_guided_decoding and question.options:
            if question.type == "mcq":
                return 1
            elif question.type in ("multiple_select", "ranking"):
                return 3 * len(question.options)
        return self.max_tokens

    def _parse_response(self, content: str, question: Question | None) -> LLMResponse:
        """Parse response based on provider and question type."""
        if not content:
            return LLMResponse(answer="", raw="")

        # OpenRouter with json_schema returns JSON
        if self.provider == "openrouter" and self.use_guided_decoding and question and question.options:
            return LLMResponse.from_json(content)

        # vLLM with choice constraint returns single letter
        if self.provider == "vllm" and self.use_guided_decoding and question and question.options:
            if question.type == "mcq":
                letter = content.strip().upper()
                valid = {chr(65 + i) for i in range(len(question.options))}
                if letter in valid:
                    return LLMResponse(answer=letter, raw=content)
            elif question.type in ("multiple_select", "ranking"):
                require_all = question.type == "ranking"
                return LLMResponse.from_comma_separated(
                    content, len(question.options),
                    require_all=require_all, options=question.options
                )

        # Open response or fallback
        if question and question.type == "open_response":
            return LLMResponse(answer=content.strip(), raw=content)

        return LLMResponse.from_text(content)

    async def async_complete(self, prompt: str, *, question: Question | None = None) -> LLMResponse:
        """Get completion from LLM (async)."""
        params = self._build_create_params(question)
        messages = [{"role": "user", "content": prompt}]

        try:
            response = await self._async_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=self._effective_max_tokens(question),
                **params,
            )
            content = response.choices[0].message.content or ""
            return self._parse_response(content, question)
        except openai.BadRequestError as e:
            # Check if structured output not supported
            if "json" in str(e).lower() or "schema" in str(e).lower():
                raise StructuredOutputNotSupported(str(e))
            raise NonRetryableError(str(e))
        except openai.AuthenticationError as e:
            raise NonRetryableError(str(e))
        except openai.RateLimitError as e:
            raise RetryableError(str(e))
        except openai.APIStatusError as e:
            if e.status_code >= 500:
                raise RetryableError(str(e))
            raise NonRetryableError(str(e))

    def complete(self, prompt: str, *, question: Question | None = None) -> LLMResponse:
        """Get completion from LLM (sync)."""
        # Same as async_complete but using sync client
        params = self._build_create_params(question)
        messages = [{"role": "user", "content": prompt}]

        response = self._sync_client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self._effective_max_tokens(question),
            **params,
        )
        content = response.choices[0].message.content or ""
        return self._parse_response(content, question)

    async def close(self):
        await self._async_client.close()
```

### 2. Filling Strategy (`worker.py`)

```python
from typing import Protocol

class FillingStrategy(Protocol):
    """Protocol for survey filling algorithms."""
    async def fill(
        self,
        backstory: str,
        questions: list[Question],
        llm: UnifiedLLMClient,
        parser_llm: ParserLLM | None = None,
    ) -> dict[str, str]:
        """Fill all questions and return qkey -> answer mapping."""
        ...


class SeriesWithContext:
    """
    Anthology-style: questions asked sequentially with context accumulation.
    LLM sees its previous answers when answering follow-up questions.
    Two-tier parsing: structured output (Tier 1) + parser LLM fallback (Tier 2).
    """

    def __init__(self, max_compliance_retries: int = 10):
        self.max_compliance_retries = max_compliance_retries

    async def fill(
        self,
        backstory: str,
        questions: list[Question],
        llm: UnifiedLLMClient,
        parser_llm: ParserLLM | None = None,
    ) -> dict[str, str]:
        results = {}
        context = ""

        for i, question in enumerate(questions):
            if i == 0:
                prompt = build_initial_prompt(backstory, question)
            else:
                prompt = build_followup_prompt(context, question)

            answer, raw = await self._ask_with_retry(prompt, question, llm, parser_llm)
            results[question.qkey] = answer
            context = append_answer_to_context(prompt, raw)

        return results

    async def _ask_with_retry(self, prompt, question, llm, parser_llm) -> tuple[str, str]:
        """Ask question with compliance retries + Tier 1/2 parsing."""
        raw = ""
        for retry in range(self.max_compliance_retries):
            response = await llm.async_complete(prompt, question=question)
            raw = response.raw or ""
            answer = response.answer

            # Tier 1 success
            if answer:
                return answer, raw

            # Open response: any non-empty text is valid
            if question.type == "open_response":
                continue  # retry if empty

            # Tier 2: parser LLM fallback (MCQ, multiple_select, ranking)
            if question.type in ("mcq", "multiple_select", "ranking") and parser_llm and raw:
                answer = await parser_llm.async_parse(raw, question)
                if answer:
                    return answer, raw

        return "", raw


class TaskProcessor:
    """Processes survey tasks using a pluggable filling strategy."""

    def __init__(
        self,
        db,
        llm: UnifiedLLMClient,
        max_retries: int = 3,
        parser_llm: ParserLLM | None = None,
        strategy: FillingStrategy | None = None,
    ):
        self.db = db
        self.llm = llm
        self.max_retries = max_retries
        self.parser_llm = parser_llm
        self.strategy = strategy or SeriesWithContext()

    async def async_process_task(self, task):
        # ... fetch backstory, questions ...
        results = await self.strategy.fill(backstory, questions, self.llm, self.parser_llm)
        # ... store results ...
```

### 3. Simplified Config (`config.py`)

```python
@dataclass
class LLMConfig:
    """Unified LLM configuration."""
    provider: str = ""           # "openrouter" or "vllm"
    base_url: str = ""           # Full API base URL
    api_key: str = ""            # API key (required for openrouter, optional for vllm)
    model: str = ""              # Model identifier
    temperature: float = 0.0
    max_tokens: int | None = 512
    use_guided_decoding: bool = True
    parser_llm_model: str = "google/gemini-2.0-flash-001"

    @classmethod
    def from_user_config(cls, user_config: dict, api_key: str | None = None) -> "LLMConfig":
        provider = user_config.get("provider", "")

        if provider == "openrouter":
            base_url = "https://openrouter.ai/api/v1"
            model = user_config.get("openrouter_model", "")
        elif provider == "vllm":
            endpoint = user_config.get("vllm_endpoint", "").rstrip("/")
            base_url = f"{endpoint}/v1" if not endpoint.endswith("/v1") else endpoint
            model = user_config.get("vllm_model", "")
        else:
            raise ValueError(f"Unknown provider: {provider}")

        return cls(
            provider=provider,
            base_url=base_url,
            api_key=api_key or "",
            model=model,
            temperature=user_config.get("temperature", 0.0),
            max_tokens=user_config.get("max_tokens", 512),
            use_guided_decoding=user_config.get("use_guided_decoding", True),
            parser_llm_model=user_config.get("parser_llm_model", "google/gemini-2.0-flash-001"),
        )
```

### 4. Simplified `main.py` Client Creation

```python
def create_llm_client(llm_config: LLMConfig) -> UnifiedLLMClient:
    return UnifiedLLMClient(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key,
        model=llm_config.model,
        provider=llm_config.provider,
        temperature=llm_config.temperature,
        max_tokens=llm_config.max_tokens,
        use_guided_decoding=llm_config.use_guided_decoding,
    )
```

## Pass Criteria

### Unit Tests

- [ ] **UnifiedLLMClient creation**: Can create client for both `openrouter` and `vllm` providers with correct `base_url`
- [ ] **Structured params for vLLM MCQ**: `_build_create_params` returns `{"extra_body": {"structured_outputs": {"choice": ["A","B","C","D"]}}}` for 4-option MCQ
- [ ] **Structured params for vLLM regex**: Returns correct regex extra_body for multiple_select and ranking
- [ ] **Structured params for OpenRouter**: Returns `response_format` with `json_schema` for MCQ
- [ ] **Response parsing (JSON)**: `LLMResponse.from_json` handles `answer`, `answers`, `ranking` fields
- [ ] **Response parsing (text)**: `LLMResponse.from_text` extracts letters from plain text responses
- [ ] **SeriesWithContext strategy**: Processes questions sequentially, accumulates context
- [ ] **SeriesWithContext tier 1+2**: Falls back to parser LLM when structured output fails to parse
- [ ] **SeriesWithContext no tier 3**: Does NOT call `match_option_text` (removed)
- [ ] **Strategy pattern**: `TaskProcessor` accepts any `FillingStrategy` and delegates correctly
- [ ] **Parser LLM**: Still works for MCQ/multiple_select/ranking parsing
- [ ] **Config from_user_config**: Builds correct `base_url` for both providers
- [ ] **Error mapping**: OpenAI SDK exceptions mapped to `RetryableError`/`NonRetryableError`

### Acceptance Criteria

- [ ] `llm.py` is under 400 LOC (down from 953)
- [ ] No direct `httpx` imports in `llm.py` (uses `openai` SDK exclusively)
- [ ] Single `UnifiedLLMClient` class replaces `OpenRouterClient` + `VLLMClient`
- [ ] `openai` package added to `requirements.txt`
- [ ] All existing tests pass (updated for new interfaces)
- [ ] `worker.py` uses strategy pattern -- `TaskProcessor.__init__` accepts a `FillingStrategy`
- [ ] `match_option_text` function is removed from `worker.py`
- [ ] `get_response_schema` kept in `prompt.py` (still needed for OpenRouter json_schema)
- [ ] vLLM guided decoding uses `extra_body={"structured_outputs": ...}` via OpenAI SDK
- [ ] OpenRouter structured output uses `response_format={"type": "json_schema", ...}` via OpenAI SDK
- [ ] vLLM now uses Chat Completions API (not legacy Completions API)
- [ ] Parser LLM (Tier 2) still works as fallback
- [ ] Error classes (`RetryableError`, `NonRetryableError`, etc.) preserved
- [ ] OpenAI SDK's built-in `max_retries` handles transport-level retries; manual retry only for compliance (re-asking same question on parse failure)
- [ ] `StructuredOutputNotSupported` fallback to text mode still works for OpenRouter models that don't support json_schema

## Implementation Notes

### For the Implementing Agent

1. **Start with `llm.py`** -- this is the biggest change. Replace `OpenRouterClient` + `VLLMClient` with `UnifiedLLMClient`. Keep the error classes and `LLMResponse` dataclass.
2. **Then update `worker.py`** -- extract `SeriesWithContext` strategy, remove `match_option_text`, update `TaskProcessor` to accept strategy.
3. **Update `config.py`** -- simplify `LLMConfig` to use unified `base_url`/`api_key`/`model`. Keep `from_user_config()` but simplify it.
4. **Update `main.py`** -- simplify `create_llm_client()` to one-liner.
5. **Update `parser.py`** -- optionally switch to `openai` SDK (low priority, httpx is fine here too).
6. **Update tests last** -- after all source changes are stable.

### Key vLLM API Reference (from official docs)

vLLM's OpenAI-compatible server supports structured outputs natively:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="-")

# MCQ: choice constraint
completion = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Classify this sentiment: vLLM is wonderful!"}],
    extra_body={"structured_outputs": {"choice": ["positive", "negative"]}},
)

# Regex constraint
completion = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": prompt}],
    extra_body={"structured_outputs": {"regex": r"\w+@\w+\.com\n"}},
)

# JSON schema (alternative)
completion = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": prompt}],
    response_format={"type": "json_schema", "json_schema": {"name": "car", "schema": schema}},
)
```

The deprecated fields `guided_json`, `guided_regex`, `guided_choice` have been replaced with `structured_outputs.json`, `structured_outputs.regex`, `structured_outputs.choice`.

### OpenRouter base_url
```python
client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
```

### What NOT to change
- `prompt.py` formatting functions (they're clean and correct)
- `db.py` (separate concern)
- `queue.py` (separate concern)
- `metrics.py` (separate concern)
- `dispatcher.py` (separate concern)

## Out of Scope
- Adding new filling strategies beyond `SeriesWithContext` (just establish the pattern)
- Changing prompt formatting (`prompt.py` is fine)
- Database schema changes
- Frontend changes
- Queue/dispatcher changes
- Removing `httpx` from parser.py (optional cleanup)
