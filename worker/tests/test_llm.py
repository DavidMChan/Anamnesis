"""
Tests for LLM client module.
All LLM calls are mocked via the OpenAI SDK.
"""
import pytest
from unittest.mock import Mock, patch, MagicMock, AsyncMock

import openai

from src.llm import UnifiedLLMClient, StructuredOutputNotSupported
from src.response import LLMResponse, LLMError, RetryableError, NonRetryableError
from src.prompt import Question


# ─── Helpers ─────────────────────────────────────────────────────────────────


def make_mock_completion(content: str):
    """Create a mock OpenAI ChatCompletion response."""
    choice = Mock()
    choice.message = Mock()
    choice.message.content = content
    completion = Mock()
    completion.choices = [choice]
    return completion


def make_client(provider="openrouter", **kwargs):
    """Create a UnifiedLLMClient with mocked internal clients."""
    defaults = dict(
        base_url="https://openrouter.ai/api/v1" if provider == "openrouter" else "http://localhost:8000/v1",
        api_key="test-key",
        model="test-model",
        provider=provider,
    )
    defaults.update(kwargs)

    with patch("src.llm.OpenAI"), patch("src.llm.AsyncOpenAI"):
        client = UnifiedLLMClient(**defaults)
    return client


def setup_sync_mock(client, content: str):
    """Set up a sync mock response on the client."""
    mock_sync = MagicMock()
    mock_sync.chat.completions.create.return_value = make_mock_completion(content)
    client._sync_client = mock_sync
    return mock_sync


# ─── UnifiedLLMClient Tests ─────────────────────────────────────────────────


class TestUnifiedLLMClientCreation:
    """Tests for creating UnifiedLLMClient."""

    def test_creates_openrouter_client(self):
        """Can create client for openrouter provider."""
        client = make_client(provider="openrouter")
        assert client.provider == "openrouter"
        assert client.model == "test-model"

    def test_creates_vllm_client(self):
        """Can create client for vllm provider."""
        client = make_client(provider="vllm")
        assert client.provider == "vllm"
        assert client.model == "test-model"

    def test_default_settings(self):
        """Default settings are correct."""
        client = make_client()
        assert client.temperature == 0.0
        assert client.max_tokens == 512
        assert client.use_guided_decoding is True


class TestStructuredParams:
    """Tests for _build_create_params."""

    def test_vllm_mcq_choice(self):
        """vLLM MCQ returns extra_body with choice constraint."""
        client = make_client(provider="vllm")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["A", "B", "C", "D"])
        params = client._build_create_params(question)
        assert params == {"extra_body": {"structured_outputs": {"choice": ["A", "B", "C", "D"]}}}

    def test_vllm_multiple_select_json_schema(self):
        """vLLM multiple_select returns response_format with boolean map schema."""
        client = make_client(provider="vllm")
        question = Question(qkey="q1", type="multiple_select", text="Q?", options=["X", "Y", "Z", "W"])
        params = client._build_create_params(question)
        assert "response_format" in params
        assert params["response_format"]["type"] == "json_schema"
        schema = params["response_format"]["json_schema"]["schema"]
        assert "choice_A" in schema["properties"]
        assert schema["properties"]["choice_A"]["type"] == "boolean"

    def test_vllm_ranking_json_schema(self):
        """vLLM ranking returns response_format with ranking array schema."""
        client = make_client(provider="vllm")
        question = Question(qkey="q1", type="ranking", text="Q?", options=["X", "Y", "Z"])
        params = client._build_create_params(question)
        assert "response_format" in params
        schema = params["response_format"]["json_schema"]["schema"]
        assert "ranking" in schema["properties"]
        assert schema["properties"]["ranking"]["minItems"] == 3
        assert schema["properties"]["ranking"]["maxItems"] == 3

    def test_openrouter_mcq_json_schema(self):
        """OpenRouter MCQ returns response_format with json_schema."""
        client = make_client(provider="openrouter")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])
        params = client._build_create_params(question)
        assert "response_format" in params
        assert params["response_format"]["type"] == "json_schema"
        assert params["response_format"]["json_schema"]["strict"] is True

    def test_no_guided_for_open_response(self):
        """No structured params for open_response."""
        client = make_client(provider="vllm")
        question = Question(qkey="q1", type="open_response", text="Q?")
        params = client._build_create_params(question)
        assert params == {}

    def test_no_guided_when_disabled(self):
        """No structured params when use_guided_decoding=False."""
        client = make_client(provider="vllm", use_guided_decoding=False)
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])
        params = client._build_create_params(question)
        assert params == {}

    def test_no_guided_without_question(self):
        """No structured params without question."""
        client = make_client(provider="vllm")
        params = client._build_create_params(None)
        assert params == {}

    def test_dynamic_option_count(self):
        """Choice list matches actual number of options."""
        client = make_client(provider="vllm")
        for n in [2, 3, 5]:
            question = Question(qkey="q1", type="mcq", text="Q?", options=[f"opt{i}" for i in range(n)])
            params = client._build_create_params(question)
            assert len(params["extra_body"]["structured_outputs"]["choice"]) == n


class TestEffectiveMaxTokens:
    """Tests for _effective_max_tokens."""

    def test_mcq_returns_1(self):
        client = make_client(provider="vllm")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])
        assert client._effective_max_tokens(question) == 1

    def test_multiple_select_returns_default(self):
        """JSON schema constrains output; uses default max_tokens."""
        client = make_client(provider="vllm")
        question = Question(qkey="q1", type="multiple_select", text="Q?", options=["A", "B", "C", "D", "E"])
        assert client._effective_max_tokens(question) == 512  # default, not 3 * 5

    def test_default_for_open_response(self):
        client = make_client(provider="vllm", max_tokens=256)
        question = Question(qkey="q1", type="open_response", text="Q?")
        assert client._effective_max_tokens(question) == 256

    def test_default_without_question(self):
        client = make_client(max_tokens=512)
        assert client._effective_max_tokens(None) == 512


class TestSyncComplete:
    """Tests for sync complete()."""

    def test_openrouter_parses_json_response(self):
        """OpenRouter JSON response is parsed correctly."""
        client = make_client(provider="openrouter")
        mock = setup_sync_mock(client, '{"answer": "C"}')
        result = client.complete("Test prompt")
        assert result.answer == "C"

    def test_openrouter_sends_response_format(self):
        """OpenRouter complete sends response_format in create call."""
        client = make_client(provider="openrouter")
        mock = setup_sync_mock(client, '{"answer": "A"}')
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

        client.complete("Test", question=question)

        call_kwargs = mock.chat.completions.create.call_args.kwargs
        assert "response_format" in call_kwargs
        assert call_kwargs["response_format"]["type"] == "json_schema"

    def test_vllm_sends_extra_body(self):
        """vLLM complete sends extra_body with structured_outputs."""
        client = make_client(provider="vllm")
        mock = setup_sync_mock(client, "B")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

        client.complete("Test", question=question)

        call_kwargs = mock.chat.completions.create.call_args.kwargs
        assert "extra_body" in call_kwargs
        assert call_kwargs["extra_body"]["structured_outputs"]["choice"] == ["A", "B"]
        assert call_kwargs["max_tokens"] == 1

    def test_vllm_mcq_parses_single_letter(self):
        """vLLM MCQ response is parsed as single letter."""
        client = make_client(provider="vllm")
        setup_sync_mock(client, "B")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])
        result = client.complete("Test", question=question)
        assert result.answer == "B"

    def test_vllm_open_response_returns_raw(self):
        """vLLM open response uses raw text."""
        client = make_client(provider="vllm")
        setup_sync_mock(client, "I think climate change is serious")
        question = Question(qkey="q1", type="open_response", text="Q?")
        result = client.complete("Test", question=question)
        assert result.answer == "I think climate change is serious"

    def test_no_question_falls_back_to_text(self):
        """Without question, uses text parsing."""
        client = make_client(provider="vllm")
        setup_sync_mock(client, "(B) because...")
        result = client.complete("Test")
        assert result.answer == "B"


class TestErrorMapping:
    """Tests for OpenAI SDK exception mapping."""

    def test_auth_error_raises_non_retryable(self):
        """AuthenticationError → NonRetryableError."""
        client = make_client()
        client._sync_client = MagicMock()
        client._sync_client.chat.completions.create.side_effect = openai.AuthenticationError(
            message="Invalid API key",
            response=Mock(status_code=401),
            body=None,
        )
        with pytest.raises(NonRetryableError):
            client.complete("Test")

    def test_rate_limit_raises_retryable(self):
        """RateLimitError → RetryableError."""
        client = make_client()
        client._sync_client = MagicMock()
        client._sync_client.chat.completions.create.side_effect = openai.RateLimitError(
            message="Rate limited",
            response=Mock(status_code=429),
            body=None,
        )
        with pytest.raises(RetryableError):
            client.complete("Test")

    def test_server_error_raises_retryable(self):
        """500+ APIStatusError → RetryableError."""
        client = make_client()
        client._sync_client = MagicMock()
        client._sync_client.chat.completions.create.side_effect = openai.InternalServerError(
            message="Server error",
            response=Mock(status_code=500),
            body=None,
        )
        with pytest.raises(RetryableError):
            client.complete("Test")

    def test_bad_request_raises_non_retryable(self):
        """BadRequestError (non-schema) → NonRetryableError."""
        client = make_client()
        client._sync_client = MagicMock()
        client._sync_client.chat.completions.create.side_effect = openai.BadRequestError(
            message="Invalid model",
            response=Mock(status_code=400),
            body=None,
        )
        with pytest.raises(NonRetryableError):
            client.complete("Test")

    def test_structured_output_not_supported_openrouter_falls_back(self):
        """OpenRouter schema error falls back to text mode."""
        client = make_client(provider="openrouter")
        mock = MagicMock()

        # First call raises BadRequestError with schema message
        # Second call (text fallback) succeeds
        mock.chat.completions.create.side_effect = [
            openai.BadRequestError(
                message="json_schema not supported",
                response=Mock(status_code=400),
                body=None,
            ),
            make_mock_completion("A"),
        ]
        client._sync_client = mock

        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])
        result = client.complete("Test", question=question)
        assert result.answer == "A"

    def test_structured_output_not_supported_vllm_raises(self):
        """vLLM schema error raises StructuredOutputNotSupported."""
        client = make_client(provider="vllm")
        client._sync_client = MagicMock()
        client._sync_client.chat.completions.create.side_effect = openai.BadRequestError(
            message="json schema not supported",
            response=Mock(status_code=400),
            body=None,
        )
        with pytest.raises(StructuredOutputNotSupported):
            question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])
            client.complete("Test", question=question)


# ─── LLMResponse Tests ──────────────────────────────────────────────────────


class TestLLMResponseFromText:
    """Tests for plain text parsing (anthology style)."""

    def test_parses_single_letter(self):
        response = LLMResponse.from_text("A")
        assert response.answer == "A"

    def test_parses_parenthesized_letter(self):
        response = LLMResponse.from_text("(A)")
        assert response.answer == "A"

    def test_parses_letter_with_period(self):
        response = LLMResponse.from_text("A. This is my reasoning")
        assert response.answer == "A"

    def test_parses_letter_with_colon(self):
        response = LLMResponse.from_text("A: Because this is correct")
        assert response.answer == "A"

    def test_parses_answer_prefix(self):
        response = LLMResponse.from_text("Answer: A")
        assert response.answer == "A"

    def test_parses_answer_with_parentheses(self):
        response = LLMResponse.from_text("Answer: (B)")
        assert response.answer == "B"

    def test_parses_lowercase_letter_with_delimiter(self):
        response = LLMResponse.from_text("c.")
        assert response.answer == "C"

    def test_parses_letter_in_text(self):
        response = LLMResponse.from_text("(D) because this is the correct choice")
        assert response.answer == "D"

    def test_parses_bracket_style(self):
        response = LLMResponse.from_text("[E]")
        assert response.answer == "E"

    def test_stores_raw_text(self):
        raw = "(B) This is my full reasoning for choosing B."
        response = LLMResponse.from_text(raw)
        assert response.raw == raw

    def test_invalid_letter_returns_raw(self):
        response = LLMResponse.from_text("This has no valid answer letter like X or Z")
        assert len(response.answer) <= 100

    def test_empty_text_returns_empty(self):
        response = LLMResponse.from_text("")
        assert response.answer == ""
