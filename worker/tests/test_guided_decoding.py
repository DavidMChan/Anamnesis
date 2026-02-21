"""
Tests for vLLM guided decoding (Tier 1) and parser LLM fallback (Tier 2).

Tier 1: vLLM structured_outputs via extra_body constrains generation to valid letters
Tier 2: Parser LLM (cheap instruction-tuned model) extracts answer from verbose response
"""
import pytest
from unittest.mock import Mock, patch, MagicMock, AsyncMock

from src.llm import UnifiedLLMClient, LLMResponse
from src.parser import ParserLLM
from src.prompt import Question
from src.worker import TaskProcessor


# ─── Helpers ─────────────────────────────────────────────────────────────────


def make_mock_completion(content: str):
    """Create a mock OpenAI ChatCompletion response."""
    choice = Mock()
    choice.message = Mock()
    choice.message.content = content
    completion = Mock()
    completion.choices = [choice]
    return completion


def make_vllm_client(**kwargs) -> UnifiedLLMClient:
    """Create a UnifiedLLMClient configured for vLLM with mocked internals."""
    defaults = dict(
        base_url="http://localhost:8000/v1",
        api_key="test",
        model="meta-llama/Llama-3-70b",
        provider="vllm",
        temperature=1.0,
        max_tokens=128,
    )
    defaults.update(kwargs)

    with patch("src.llm.OpenAI"), patch("src.llm.AsyncOpenAI"):
        client = UnifiedLLMClient(**defaults)
    return client


def setup_sync_response(client: UnifiedLLMClient, content: str):
    """Set up a sync mock response on the client, return the mock."""
    mock_sync = MagicMock()
    mock_sync.chat.completions.create.return_value = make_mock_completion(content)
    client._sync_client = mock_sync
    return mock_sync


# ===========================================================================
# Tier 1 — vLLM Guided Decoding
# ===========================================================================


class TestVLLMGuidedDecoding:
    """Tests for vLLM structured_outputs.choice integration via OpenAI SDK."""

    def test_vllm_mcq_uses_guided_choice(self):
        """UnifiedLLMClient sends extra_body with choice constraint for MCQ."""
        client = make_vllm_client()
        mock = setup_sync_response(client, "B")
        question = Question(qkey="q1", type="mcq", text="Fav color?", options=["Red", "Blue", "Green", "Yellow"])

        client.complete("Test prompt", question=question)

        call_kwargs = mock.chat.completions.create.call_args.kwargs
        assert "extra_body" in call_kwargs
        assert call_kwargs["extra_body"]["structured_outputs"]["choice"] == ["A", "B", "C", "D"]

    def test_vllm_mcq_guided_max_tokens_1(self):
        """MCQ guided decoding requests use max_tokens=1."""
        client = make_vllm_client()
        mock = setup_sync_response(client, "A")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

        client.complete("Prompt", question=question)

        call_kwargs = mock.chat.completions.create.call_args.kwargs
        assert call_kwargs["max_tokens"] == 1

    def test_vllm_non_mcq_no_guided_choice(self):
        """open_response uses NO structured_outputs; multi-select/ranking use regex."""
        # open_response: no structured_outputs
        client = make_vllm_client()
        mock = setup_sync_response(client, "Some text")
        question = Question(qkey="q1", type="open_response", text="Q?", options=None)

        client.complete("Prompt", question=question)

        call_kwargs = mock.chat.completions.create.call_args.kwargs
        assert "extra_body" not in call_kwargs

        # multiple_select and ranking use regex, not choice
        for qtype in ["multiple_select", "ranking"]:
            client = make_vllm_client()
            mock = setup_sync_response(client, "A, B")
            question = Question(qkey="q1", type=qtype, text="Q?", options=["A", "B"])

            client.complete("Prompt", question=question)

            call_kwargs = mock.chat.completions.create.call_args.kwargs
            assert "extra_body" in call_kwargs, f"extra_body should be in kwargs for {qtype}"
            assert "regex" in call_kwargs["extra_body"]["structured_outputs"]

    def test_vllm_guided_decoding_returns_valid_letter(self):
        """Response from guided decoding is correctly parsed as single letter."""
        client = make_vllm_client()
        setup_sync_response(client, "C")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["X", "Y", "Z"])

        result = client.complete("Prompt", question=question)

        assert result.answer == "C"
        assert result.raw == "C"

    def test_vllm_guided_decoding_disabled_flag(self):
        """When use_guided_decoding=False, no extra_body is sent."""
        client = make_vllm_client(use_guided_decoding=False)
        mock = setup_sync_response(client, "(A)")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

        client.complete("Prompt", question=question)

        call_kwargs = mock.chat.completions.create.call_args.kwargs
        assert "extra_body" not in call_kwargs
        assert call_kwargs["max_tokens"] == 128  # default, not 1

    def test_vllm_guided_choice_dynamic_options(self):
        """Choice list matches actual number of options."""
        test_cases = [
            (["Yes", "No"], ["A", "B"]),
            (["A", "B", "C", "D", "E"], ["A", "B", "C", "D", "E"]),
            (["Very likely", "Somewhat likely", "Not likely"], ["A", "B", "C"]),
        ]
        for options, expected_choices in test_cases:
            client = make_vllm_client()
            mock = setup_sync_response(client, "A")
            question = Question(qkey="q1", type="mcq", text="Q?", options=options)

            client.complete("Prompt", question=question)

            call_kwargs = mock.chat.completions.create.call_args.kwargs
            assert call_kwargs["extra_body"]["structured_outputs"]["choice"] == expected_choices, \
                f"Expected {expected_choices} for {len(options)} options"

    def test_vllm_no_question_uses_text_mode(self):
        """When no question is passed, uses text parsing (backward compat)."""
        client = make_vllm_client()
        mock = setup_sync_response(client, "(B) because...")

        result = client.complete("Prompt")

        call_kwargs = mock.chat.completions.create.call_args.kwargs
        assert "extra_body" not in call_kwargs
        assert result.answer == "B"

    def test_vllm_uses_chat_completions_api(self):
        """vLLM now uses chat.completions.create (not raw /v1/completions)."""
        client = make_vllm_client()
        mock = setup_sync_response(client, "A")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

        client.complete("Prompt", question=question)

        # It calls chat.completions.create (not /v1/completions directly)
        mock.chat.completions.create.assert_called_once()


# ===========================================================================
# Tier 2 — Parser LLM Fallback
# ===========================================================================


class TestParserLLM:
    """Tests for the parser LLM fallback."""

    def test_parser_llm_extracts_letter(self):
        """ParserLLM correctly extracts letter from verbose response."""
        with patch("src.parser.OpenAI") as MockOpenAI, patch("src.parser.AsyncOpenAI"):
            mock_sync = MagicMock()
            mock_sync.chat.completions.create.return_value = make_mock_completion("Answer: B")
            MockOpenAI.return_value = mock_sync

            parser = ParserLLM(api_key="test-key", model="google/gemini-2.0-flash-001")
            question = Question(qkey="q1", type="mcq", text="Fav color?", options=["Red", "Blue"])

            result = parser.parse("I think blue is the best color", question)
            assert result == "B"

    def test_parser_llm_returns_empty_on_X(self):
        """ParserLLM returns empty string when parser responds with 'X'."""
        with patch("src.parser.OpenAI") as MockOpenAI, patch("src.parser.AsyncOpenAI"):
            mock_sync = MagicMock()
            mock_sync.chat.completions.create.return_value = make_mock_completion("Answer: X")
            MockOpenAI.return_value = mock_sync

            parser = ParserLLM(api_key="test-key", model="google/gemini-2.0-flash-001")
            question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

            result = parser.parse("I have no idea what to choose", question)
            assert result == ""

    def test_parser_llm_not_configured_skips(self):
        """When parser LLM not configured (no api_key), parse returns empty."""
        parser = ParserLLM(api_key="", model="")
        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])
        result = parser.parse("Some verbose response", question)
        assert result == ""

    def test_parser_llm_prompt_format(self):
        """Parser prompt includes question text, options, and raw response."""
        with patch("src.parser.OpenAI") as MockOpenAI, patch("src.parser.AsyncOpenAI"):
            mock_sync = MagicMock()
            mock_sync.chat.completions.create.return_value = make_mock_completion("Answer: A")
            MockOpenAI.return_value = mock_sync

            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="mcq", text="What is your age?",
                                options=["18-25", "26-35", "36-50"])

            parser.parse("I'm in my early twenties", question)

            call_kwargs = mock_sync.chat.completions.create.call_args.kwargs
            prompt_text = call_kwargs["messages"][0]["content"]

            assert "What is your age?" in prompt_text
            assert "(A) 18-25" in prompt_text
            assert "(B) 26-35" in prompt_text
            assert "(C) 36-50" in prompt_text
            assert "I'm in my early twenties" in prompt_text
            assert "Answer ONLY as a single upper-case character" in prompt_text

    def test_parser_llm_handles_raw_letter_response(self):
        """Parser handles response without 'Answer:' prefix."""
        with patch("src.parser.OpenAI") as MockOpenAI, patch("src.parser.AsyncOpenAI"):
            mock_sync = MagicMock()
            mock_sync.chat.completions.create.return_value = make_mock_completion("A")
            MockOpenAI.return_value = mock_sync

            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

            result = parser.parse("Yes definitely", question)
            assert result == "A"


# ===========================================================================
# Integration — Fallback Chain (No Tier 3)
# ===========================================================================


class TestFallbackChain:
    """Tests for the two-tier fallback chain in the worker."""

    def test_compliance_forcing_with_guided_decoding(self):
        """Compliance forcing loop uses guided decoding on each retry."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
        mock_llm.use_guided_decoding = True

        # First call returns empty (guided decoding failed somehow), second succeeds
        mock_llm.complete.side_effect = [
            LLMResponse(answer="", raw=""),
            LLMResponse(answer="A", raw="A"),
        ]

        processor = TaskProcessor(db=mock_db, llm=mock_llm)

        questions = [Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])]
        results = processor.process_questions_in_series("Backstory", questions)

        assert mock_llm.complete.call_count == 2
        assert results["q1"] == "A"

        for c in mock_llm.complete.call_args_list:
            assert "question" in c.kwargs or len(c.args) > 1

    def test_fallback_chain_guided_then_parser(self):
        """When guided decoding returns empty, tries parser LLM (Tier 2)."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
        mock_llm.use_guided_decoding = True

        # Guided decoding returns empty (unparseable)
        mock_llm.complete.return_value = LLMResponse(
            answer="", raw="I think blue is a wonderful color"
        )

        # Parser LLM extracts "B"
        mock_parser = Mock(spec=ParserLLM)
        mock_parser.parse.return_value = "B"

        processor = TaskProcessor(db=mock_db, llm=mock_llm, parser_llm=mock_parser)

        questions = [Question(qkey="q1", type="mcq", text="Fav color?", options=["Red", "Blue"])]
        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == "B"
        mock_parser.parse.assert_called()

    def test_no_tier3_match_option_text(self):
        """Tier 3 (match_option_text) is removed — no text matching fallback."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
        mock_llm.use_guided_decoding = True

        # Guided decoding returns empty
        mock_llm.complete.return_value = LLMResponse(
            answer="", raw="I would say No to this"
        )

        # No parser LLM configured
        processor = TaskProcessor(db=mock_db, llm=mock_llm, parser_llm=None)

        questions = [Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])]
        results = processor.process_questions_in_series("Backstory", questions)

        # Without parser LLM and without Tier 3, all retries exhaust → empty
        assert results["q1"] == ""
        assert mock_llm.complete.call_count == 10  # All compliance retries exhausted

    def test_context_accumulation_with_guided_answer(self):
        """Context accumulation works when guided decoding returns just a letter."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
        mock_llm.use_guided_decoding = True

        mock_llm.complete.side_effect = [
            LLMResponse(answer="A", raw="A"),
            LLMResponse(answer="B", raw="B"),
        ]

        processor = TaskProcessor(db=mock_db, llm=mock_llm)

        questions = [
            Question(qkey="q1", type="mcq", text="Q1?", options=["Yes", "No"]),
            Question(qkey="q2", type="mcq", text="Q2?", options=["Up", "Down"]),
        ]
        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == "A"
        assert results["q2"] == "B"

        second_call_prompt = mock_llm.complete.call_args_list[1].args[0]
        assert "A" in second_call_prompt
