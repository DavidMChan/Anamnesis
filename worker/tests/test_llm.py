"""
Tests for LLM client module.
All LLM calls are mocked.
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
import json
import httpx

from src.llm import (
    LLMClient,
    LLMResponse,
    OpenRouterClient,
    VLLMClient,
    LLMError,
    RetryableError,
    NonRetryableError,
)


class TestOpenRouterClient:
    """Tests for OpenRouter API client."""

    def test_sends_correct_headers(self):
        """OpenRouter client sends correct headers including API key."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "A"}'}}]
            }
            mock_client.post.return_value = mock_response

            client = OpenRouterClient(
                api_key="test-api-key",
                model="anthropic/claude-3-haiku",
            )
            client.complete("Test prompt", {})

            # Check headers were passed correctly
            call_args = mock_client.post.call_args
            headers = call_args.kwargs.get("headers", {})
            assert "Authorization" in headers
            assert headers["Authorization"] == "Bearer test-api-key"

    def test_sends_correct_payload(self):
        """OpenRouter client sends correct payload structure."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "B"}'}}]
            }
            mock_client.post.return_value = mock_response

            client = OpenRouterClient(
                api_key="test-key",
                model="anthropic/claude-3-haiku",
                temperature=0.0,
                max_tokens=64,
            )
            client.complete("Test prompt", {})

            call_args = mock_client.post.call_args
            payload = call_args.kwargs.get("json", {})

            assert payload["model"] == "anthropic/claude-3-haiku"
            assert payload["temperature"] == 0.0
            assert payload["max_tokens"] == 64
            assert any("Test prompt" in str(msg) for msg in payload.get("messages", []))

    def test_parses_json_response(self):
        """OpenRouter client parses structured JSON response correctly."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "C"}'}}]
            }
            mock_client.post.return_value = mock_response

            client = OpenRouterClient(api_key="test-key", model="test-model")
            result = client.complete("Test", {})

            assert isinstance(result, LLMResponse)
            assert result.answer == "C"

    def test_uses_response_format_for_structured_output(self):
        """OpenRouter client sends response_format with json_schema for structured outputs."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "A"}'}}]
            }
            mock_client.post.return_value = mock_response

            client = OpenRouterClient(api_key="test-key", model="test-model")
            client.complete("Test", {})

            call_args = mock_client.post.call_args
            payload = call_args.kwargs.get("json", {})
            # Should include response_format with json_schema type
            assert "response_format" in payload
            assert payload["response_format"]["type"] == "json_schema"
            assert "json_schema" in payload["response_format"]
            assert payload["response_format"]["json_schema"]["strict"] == True


class TestVLLMClient:
    """Tests for vLLM API client."""

    def test_sends_correct_payload(self):
        """vLLM client sends correct payload to local endpoint."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "A"}'}}]
            }
            mock_client.post.return_value = mock_response

            client = VLLMClient(
                endpoint="http://localhost:8000/v1",
                model="meta-llama/Llama-3-70b",
                temperature=0.0,
                max_tokens=64,
            )
            client.complete("Test prompt", {})

            call_args = mock_client.post.call_args
            # Should call the vLLM endpoint
            assert "localhost:8000" in str(call_args)

            payload = call_args.kwargs.get("json", {})
            assert payload["model"] == "meta-llama/Llama-3-70b"
            assert payload["temperature"] == 0.0

    def test_vllm_uses_guided_json(self):
        """vLLM client uses guided_json in extra_body for structured outputs."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "B"}'}}]
            }
            mock_client.post.return_value = mock_response

            client = VLLMClient(
                endpoint="http://localhost:8000/v1",
                model="test-model",
            )
            result = client.complete("Test", {})

            assert result.answer == "B"

            # Verify guided_json is in extra_body
            call_args = mock_client.post.call_args
            payload = call_args.kwargs.get("json", {})
            assert "extra_body" in payload
            assert "guided_json" in payload["extra_body"]


class TestRetryLogic:
    """Tests for retry logic on transient failures."""

    def test_retries_on_rate_limit(self):
        """Client retries on 429 rate limit errors."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            # First call fails with 429, second succeeds
            fail_response = Mock()
            fail_response.status_code = 429
            fail_response.json.return_value = {"error": {"message": "Rate limited"}}

            success_response = Mock()
            success_response.status_code = 200
            success_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "A"}'}}]
            }

            mock_client.post.side_effect = [fail_response, success_response]

            client = OpenRouterClient(api_key="test-key", model="test-model", max_retries=3)
            result = client.complete("Test", {})

            assert result.answer == "A"
            assert mock_client.post.call_count == 2

    def test_retries_on_server_error(self):
        """Client retries on 500+ server errors."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            fail_response = Mock()
            fail_response.status_code = 500
            fail_response.json.return_value = {"error": {"message": "Server error"}}

            success_response = Mock()
            success_response.status_code = 200
            success_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "B"}'}}]
            }

            mock_client.post.side_effect = [fail_response, success_response]

            client = OpenRouterClient(api_key="test-key", model="test-model", max_retries=3)
            result = client.complete("Test", {})

            assert result.answer == "B"

    def test_retries_on_timeout(self):
        """Client retries on connection timeouts."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            success_response = Mock()
            success_response.status_code = 200
            success_response.json.return_value = {
                "choices": [{"message": {"content": '{"answer": "C"}'}}]
            }

            # First call times out, second succeeds
            mock_client.post.side_effect = [
                httpx.TimeoutException("Timeout"),
                success_response,
            ]

            client = OpenRouterClient(api_key="test-key", model="test-model", max_retries=3)
            result = client.complete("Test", {})

            assert result.answer == "C"

    def test_raises_after_max_retries(self):
        """Client raises RetryableError after exhausting retries."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            fail_response = Mock()
            fail_response.status_code = 429
            fail_response.json.return_value = {"error": {"message": "Rate limited"}}

            mock_client.post.return_value = fail_response

            client = OpenRouterClient(api_key="test-key", model="test-model", max_retries=3)

            with pytest.raises(RetryableError):
                client.complete("Test", {})

            assert mock_client.post.call_count == 3


class TestNonRetryableErrors:
    """Tests for non-retryable errors."""

    def test_auth_error_not_retried(self):
        """401 authentication errors are not retried."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            fail_response = Mock()
            fail_response.status_code = 401
            fail_response.json.return_value = {"error": {"message": "Invalid API key"}}

            mock_client.post.return_value = fail_response

            client = OpenRouterClient(api_key="bad-key", model="test-model", max_retries=3)

            with pytest.raises(NonRetryableError) as exc_info:
                client.complete("Test", {})

            assert "Invalid API key" in str(exc_info.value) or "401" in str(exc_info.value)
            assert mock_client.post.call_count == 1  # No retries

    def test_invalid_request_not_retried(self):
        """400 invalid request errors are not retried."""
        with patch("httpx.Client") as mock_client_class:
            mock_client = MagicMock()
            mock_client_class.return_value.__enter__ = Mock(return_value=mock_client)
            mock_client_class.return_value.__exit__ = Mock(return_value=False)

            fail_response = Mock()
            fail_response.status_code = 400
            fail_response.json.return_value = {"error": {"message": "Invalid model"}}

            mock_client.post.return_value = fail_response

            client = OpenRouterClient(api_key="test-key", model="bad-model", max_retries=3)

            with pytest.raises(NonRetryableError):
                client.complete("Test", {})

            assert mock_client.post.call_count == 1


class TestLLMClientFactory:
    """Tests for LLMClient factory method."""

    def test_creates_openrouter_client(self):
        """Factory creates OpenRouter client for openrouter provider."""
        client = LLMClient.create(
            provider="openrouter",
            api_key="test-key",
            model="anthropic/claude-3-haiku",
        )
        assert isinstance(client, OpenRouterClient)

    def test_creates_vllm_client(self):
        """Factory creates vLLM client for vllm provider."""
        client = LLMClient.create(
            provider="vllm",
            endpoint="http://localhost:8000/v1",
            model="meta-llama/Llama-3-70b",
        )
        assert isinstance(client, VLLMClient)

    def test_invalid_provider_raises(self):
        """Invalid provider raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            LLMClient.create(provider="invalid", api_key="test")

        assert "provider" in str(exc_info.value).lower()


class TestLLMResponse:
    """Tests for LLMResponse dataclass."""

    def test_response_from_json(self):
        """LLMResponse can be created from JSON string."""
        json_str = '{"answer": "A", "reasoning": "Because option A is correct."}'
        response = LLMResponse.from_json(json_str)

        assert response.answer == "A"
        assert response.reasoning == "Because option A is correct."

    def test_response_answer_only(self):
        """LLMResponse works with answer only (no reasoning)."""
        json_str = '{"answer": "B"}'
        response = LLMResponse.from_json(json_str)

        assert response.answer == "B"
        assert response.reasoning is None

    def test_response_raw_content(self):
        """LLMResponse stores raw content for debugging."""
        json_str = '{"answer": "C"}'
        response = LLMResponse.from_json(json_str)

        assert response.raw == json_str


class TestLLMResponseFromText:
    """Tests for plain text parsing (anthology style)."""

    def test_parses_single_letter(self):
        """Parses single letter at start."""
        response = LLMResponse.from_text("A")
        assert response.answer == "A"

    def test_parses_parenthesized_letter(self):
        """Parses (A) style response."""
        response = LLMResponse.from_text("(A)")
        assert response.answer == "A"

    def test_parses_letter_with_period(self):
        """Parses A. style response."""
        response = LLMResponse.from_text("A. This is my reasoning")
        assert response.answer == "A"

    def test_parses_letter_with_colon(self):
        """Parses A: style response."""
        response = LLMResponse.from_text("A: Because this is correct")
        assert response.answer == "A"

    def test_parses_answer_prefix(self):
        """Parses 'Answer: A' style response."""
        response = LLMResponse.from_text("Answer: A")
        assert response.answer == "A"

    def test_parses_answer_with_parentheses(self):
        """Parses 'Answer: (B)' style response."""
        response = LLMResponse.from_text("Answer: (B)")
        assert response.answer == "B"

    def test_parses_lowercase_letter(self):
        """Parses lowercase letter and converts to uppercase."""
        response = LLMResponse.from_text("c")
        assert response.answer == "C"

    def test_parses_letter_in_text(self):
        """Parses (D) in text when at start."""
        response = LLMResponse.from_text("(D) because this is the correct choice")
        assert response.answer == "D"

    def test_parses_bracket_style(self):
        """Parses [E] style response."""
        response = LLMResponse.from_text("[E]")
        assert response.answer == "E"

    def test_stores_raw_text(self):
        """Stores original raw text."""
        raw = "(B) This is my full reasoning for choosing B."
        response = LLMResponse.from_text(raw)
        assert response.raw == raw

    def test_invalid_letter_returns_raw(self):
        """Invalid response returns first 100 chars of raw text."""
        response = LLMResponse.from_text("This has no valid answer letter like X or Z")
        # Should return truncated raw text since X and Z are not valid MCQ options
        assert len(response.answer) <= 100

    def test_empty_text_returns_empty(self):
        """Empty text returns empty answer."""
        response = LLMResponse.from_text("")
        assert response.answer == ""
