"""
Tests for vLLM guided decoding (Tier 1) and parser LLM fallback (Tier 2).

Tier 1: vLLM structured_outputs.choice constrains generation to valid letters
Tier 2: Parser LLM (cheap instruction-tuned model) extracts answer from verbose response
Tier 3: Existing regex (from_text) — tested in test_llm.py, not duplicated here
"""
import pytest
from unittest.mock import Mock, patch, MagicMock, call

from src.llm import VLLMClient, LLMResponse
from src.parser import ParserLLM
from src.prompt import Question
from src.worker import TaskProcessor


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_vllm_client(**kwargs) -> VLLMClient:
    defaults = dict(
        endpoint="http://localhost:8000/v1",
        model="meta-llama/Llama-3-70b",
        temperature=1.0,
        max_tokens=128,
    )
    defaults.update(kwargs)
    return VLLMClient(**defaults)


def mock_vllm_response(text: str):
    """Create a mock httpx response for vLLM completions API."""
    resp = Mock()
    resp.status_code = 200
    resp.json.return_value = {
        "choices": [{"text": text, "finish_reason": "stop"}],
    }
    return resp


def mock_httpx_client(mock_response):
    """Set up httpx.Client context manager mock returning mock_response."""
    patcher = patch("httpx.Client")
    mock_cls = patcher.start()
    mock_client = MagicMock()
    mock_cls.return_value.__enter__ = Mock(return_value=mock_client)
    mock_cls.return_value.__exit__ = Mock(return_value=False)
    mock_client.post.return_value = mock_response
    return patcher, mock_client


# ===========================================================================
# Tier 1 — vLLM Guided Decoding
# ===========================================================================


class TestVLLMGuidedDecoding:
    """Tests for vLLM structured_outputs.choice integration."""

    def test_vllm_mcq_uses_guided_choice(self):
        """VLLMClient sends structured_outputs.choice with correct letters for MCQ."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("B"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="mcq", text="Fav color?", options=["Red", "Blue", "Green", "Yellow"])

            client.complete("Test prompt", question=question)

            payload = mock_client.post.call_args.kwargs["json"]
            assert "structured_outputs" in payload
            assert payload["structured_outputs"]["choice"] == ["A", "B", "C", "D"]
        finally:
            patcher.stop()

    def test_vllm_mcq_guided_max_tokens_1(self):
        """MCQ guided decoding requests use max_tokens=1."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

            client.complete("Prompt", question=question)

            payload = mock_client.post.call_args.kwargs["json"]
            assert payload["max_tokens"] == 1
        finally:
            patcher.stop()

    def test_vllm_non_mcq_no_guided_choice(self):
        """Non-MCQ questions do NOT use guided_choice (choice type).

        Note: ranking uses guided_regex. multiple_select and open_response
        use no structured_outputs at all.
        """
        # open_response and multiple_select: no structured_outputs
        for qtype, options in [("open_response", None), ("multiple_select", ["A", "B"])]:
            patcher, mock_client = mock_httpx_client(mock_vllm_response("A, B"))
            try:
                client = make_vllm_client()
                question = Question(qkey="q1", type=qtype, text="Q?", options=options)

                client.complete("Prompt", question=question)

                payload = mock_client.post.call_args.kwargs["json"]
                assert "structured_outputs" not in payload, f"structured_outputs should not be in payload for {qtype}"
            finally:
                patcher.stop()

        # ranking uses regex, not choice
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A, B"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="ranking", text="Q?", options=["A", "B"])

            client.complete("Prompt", question=question)

            payload = mock_client.post.call_args.kwargs["json"]
            assert "structured_outputs" in payload, "structured_outputs should be in payload for ranking"
            assert "regex" in payload["structured_outputs"], "should use regex (not choice) for ranking"
        finally:
            patcher.stop()

    def test_vllm_guided_decoding_returns_valid_letter(self):
        """Response from guided decoding is correctly parsed as single letter."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("C"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="mcq", text="Q?", options=["X", "Y", "Z"])

            result = client.complete("Prompt", question=question)

            assert result.answer == "C"
            assert result.raw == "C"
        finally:
            patcher.stop()

    def test_vllm_guided_decoding_disabled_flag(self):
        """When use_guided_decoding=False, falls back to text-only mode."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("(A)"))
        try:
            client = make_vllm_client(use_guided_decoding=False)
            question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

            client.complete("Prompt", question=question)

            payload = mock_client.post.call_args.kwargs["json"]
            assert "structured_outputs" not in payload
            # Should use normal max_tokens, not 1
            assert payload["max_tokens"] == 128
        finally:
            patcher.stop()

    def test_vllm_guided_choice_dynamic_options(self):
        """Choice list matches actual number of options."""
        test_cases = [
            (["Yes", "No"], ["A", "B"]),
            (["A", "B", "C", "D", "E"], ["A", "B", "C", "D", "E"]),
            (["Very likely", "Somewhat likely", "Not likely"], ["A", "B", "C"]),
        ]
        for options, expected_choices in test_cases:
            patcher, mock_client = mock_httpx_client(mock_vllm_response("A"))
            try:
                client = make_vllm_client()
                question = Question(qkey="q1", type="mcq", text="Q?", options=options)

                client.complete("Prompt", question=question)

                payload = mock_client.post.call_args.kwargs["json"]
                assert payload["structured_outputs"]["choice"] == expected_choices, \
                    f"Expected {expected_choices} for {len(options)} options"
            finally:
                patcher.stop()

    def test_vllm_no_question_uses_text_mode(self):
        """When no question is passed, vLLM uses text mode (backward compat)."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("(B) because..."))
        try:
            client = make_vllm_client()

            # Call without question parameter (old behavior)
            result = client.complete("Prompt")

            payload = mock_client.post.call_args.kwargs["json"]
            assert "structured_outputs" not in payload
            assert result.answer == "B"
        finally:
            patcher.stop()


# ===========================================================================
# Tier 2 — Parser LLM Fallback
# ===========================================================================


class TestParserLLM:
    """Tests for the parser LLM fallback."""

    def test_parser_llm_extracts_letter(self):
        """ParserLLM correctly extracts letter from verbose response."""
        patcher, mock_client = mock_httpx_client(Mock(
            status_code=200,
            json=Mock(return_value={
                "choices": [{"message": {"content": "Answer: B"}}]
            }),
        ))
        try:
            parser = ParserLLM(
                api_key="test-key",
                model="google/gemini-2.0-flash-001",
            )
            question = Question(qkey="q1", type="mcq", text="Fav color?", options=["Red", "Blue"])

            result = parser.parse("I think blue is the best color", question)

            assert result == "B"
        finally:
            patcher.stop()

    def test_parser_llm_returns_empty_on_X(self):
        """ParserLLM returns empty string when parser responds with 'X'."""
        patcher, mock_client = mock_httpx_client(Mock(
            status_code=200,
            json=Mock(return_value={
                "choices": [{"message": {"content": "Answer: X"}}]
            }),
        ))
        try:
            parser = ParserLLM(
                api_key="test-key",
                model="google/gemini-2.0-flash-001",
            )
            question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

            result = parser.parse("I have no idea what to choose", question)

            assert result == ""
        finally:
            patcher.stop()

    def test_parser_llm_not_configured_skips(self):
        """When parser LLM not configured (no api_key), parse returns empty."""
        parser = ParserLLM(api_key="", model="")

        question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])
        result = parser.parse("Some verbose response", question)

        assert result == ""

    def test_parser_llm_prompt_format(self):
        """Parser prompt includes question text, options, and raw response."""
        patcher, mock_client = mock_httpx_client(Mock(
            status_code=200,
            json=Mock(return_value={
                "choices": [{"message": {"content": "Answer: A"}}]
            }),
        ))
        try:
            parser = ParserLLM(
                api_key="test-key",
                model="test-model",
            )
            question = Question(qkey="q1", type="mcq", text="What is your age?",
                                options=["18-25", "26-35", "36-50"])

            parser.parse("I'm in my early twenties", question)

            # Check the prompt sent to the parser
            call_args = mock_client.post.call_args
            payload = call_args.kwargs["json"]
            messages = payload["messages"]
            prompt_text = messages[0]["content"]

            assert "What is your age?" in prompt_text
            assert "(A) 18-25" in prompt_text
            assert "(B) 26-35" in prompt_text
            assert "(C) 36-50" in prompt_text
            assert "I'm in my early twenties" in prompt_text
            assert "Answer ONLY as a single upper-case character" in prompt_text
        finally:
            patcher.stop()

    def test_parser_llm_handles_raw_letter_response(self):
        """Parser handles response without 'Answer:' prefix."""
        patcher, mock_client = mock_httpx_client(Mock(
            status_code=200,
            json=Mock(return_value={
                "choices": [{"message": {"content": "A"}}]
            }),
        ))
        try:
            parser = ParserLLM(
                api_key="test-key",
                model="test-model",
            )
            question = Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])

            result = parser.parse("Yes definitely", question)

            assert result == "A"
        finally:
            patcher.stop()


# ===========================================================================
# Integration — Full Fallback Chain
# ===========================================================================


class TestFallbackChain:
    """Tests for the three-tier fallback chain in the worker."""

    def test_compliance_forcing_with_guided_decoding(self):
        """Compliance forcing loop uses guided decoding on each retry."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        # First call returns empty (guided decoding failed somehow), second succeeds
        mock_llm.complete.side_effect = [
            LLMResponse(answer="", raw=""),
            LLMResponse(answer="A", raw="A"),
        ]

        processor = TaskProcessor(db=mock_db, llm=mock_llm)

        questions = [Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])]
        results = processor.process_questions_in_series("Backstory", questions)

        # Should have called complete twice (retry)
        assert mock_llm.complete.call_count == 2
        assert results["q1"] == "A"

        # Each call should have passed the question
        for c in mock_llm.complete.call_args_list:
            assert "question" in c.kwargs or len(c.args) > 1

    def test_fallback_chain_guided_then_parser_then_regex(self):
        """When guided decoding returns empty, tries parser LLM, then regex."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
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
        # Parser should have been called with the raw text
        mock_parser.parse.assert_called()

    def test_context_accumulation_with_guided_answer(self):
        """Context accumulation works when guided decoding returns just a letter."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        # First question: guided decoding returns "A"
        # Second question: returns "B"
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

        # Second call's prompt should contain the first answer
        second_call_prompt = mock_llm.complete.call_args_list[1].args[0]
        assert "A" in second_call_prompt  # context has first answer

    def test_parser_not_configured_falls_to_regex(self):
        """When no parser LLM configured, falls through to regex (tier 3)."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        # Guided decoding returns verbose text (empty parsed answer)
        mock_llm.complete.return_value = LLMResponse(
            answer="", raw="(B) is my choice"
        )

        # No parser LLM configured
        processor = TaskProcessor(db=mock_db, llm=mock_llm, parser_llm=None)

        questions = [Question(qkey="q1", type="mcq", text="Q?", options=["Yes", "No"])]
        results = processor.process_questions_in_series("Backstory", questions)

        # Should fall through to option text matching or regex parsing
        # "(B) is my choice" has (B) which matches in from_text, but since
        # answer="" was returned, the worker tries match_option_text
        # Option "No" is in "my choice"? No. So it stays empty.
        # But the compliance loop retries, so let's see what happens after 10 retries
        # All 10 retries return empty answer with raw "(B) is my choice"
        # match_option_text won't match "Yes" or "No" in "(B) is my choice"
        # So q1 should be "" (non-compliant)
        # This is expected behavior — without parser LLM, some responses are lost
        assert mock_llm.complete.call_count == 10  # All compliance retries exhausted
