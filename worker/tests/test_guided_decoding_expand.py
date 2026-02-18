"""
Tests for expanded vLLM guided decoding — multiple_select, ranking, and open_response.

Covers:
- Multiple select: regex guided decoding, dynamic options, parsing, deduplication
- Ranking: regex guided decoding, exact count, permutation validation
- Open response: no guided decoding, raw text, relaxed stop sequences
- Parser LLM extension for multiple_select and ranking
- Integration flows: compliance retry, context accumulation, mixed types
- MCQ regression: existing behavior unchanged
"""
import pytest
from unittest.mock import Mock, patch, MagicMock

from src.llm import VLLMClient, LLMResponse
from src.parser import ParserLLM, PARSER_PROMPT_MULTIPLE_SELECT, PARSER_PROMPT_RANKING
from src.prompt import Question
from src.worker import TaskProcessor


# ---------------------------------------------------------------------------
# Helpers (reused from test_guided_decoding.py)
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


def get_payload(mock_client):
    """Extract the JSON payload from the last mock_client.post call."""
    return mock_client.post.call_args.kwargs["json"]


# ===========================================================================
# Multiple Select — Guided Decoding
# ===========================================================================


class TestMultipleSelectGuidedDecoding:
    """Tests for multiple_select: regex guided decoding WITH stop sequences."""

    def test_vllm_multiple_select_uses_guided_regex(self):
        """Multiple select uses structured_outputs.regex."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A, C, D"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="multiple_select", text="Select all?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            client.complete("Test prompt", question=question)

            payload = get_payload(mock_client)
            assert "structured_outputs" in payload
            assert payload["structured_outputs"]["regex"] == "[A-D](, [A-D])*"
        finally:
            patcher.stop()

    def test_vllm_multiple_select_keeps_stop_sequences(self):
        """Multiple select keeps stop sequences so model can naturally terminate."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A, C"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="multiple_select", text="Select?",
                                options=["Opt1", "Opt2", "Opt3"])

            client.complete("Prompt", question=question)

            payload = get_payload(mock_client)
            assert "stop" in payload
            assert payload["stop"] == ["\n", ".", "Question:"]
        finally:
            patcher.stop()

    def test_vllm_multiple_select_max_tokens(self):
        """Multiple select max_tokens is 3 * num_options (upper bound)."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A, B"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="multiple_select", text="Select?",
                                options=["A", "B", "C", "D", "E"])

            client.complete("Prompt", question=question)

            payload = get_payload(mock_client)
            assert payload["max_tokens"] == 15  # 3 * 5
        finally:
            patcher.stop()

    def test_vllm_multiple_select_dynamic_options(self):
        """Regex pattern adjusts to option count."""
        test_cases = [
            (2, "[A-B](, [A-B])*"),
            (3, "[A-C](, [A-C])*"),
            (5, "[A-E](, [A-E])*"),
        ]
        for num_options, expected_regex in test_cases:
            options = [f"Opt{i}" for i in range(num_options)]
            patcher, mock_client = mock_httpx_client(mock_vllm_response("A"))
            try:
                client = make_vllm_client()
                question = Question(qkey="q1", type="multiple_select", text="Select?", options=options)

                client.complete("Prompt", question=question)

                payload = get_payload(mock_client)
                assert payload["structured_outputs"]["regex"] == expected_regex
            finally:
                patcher.stop()

    def test_vllm_multiple_select_parses_comma_list(self):
        """Response 'A, C, D' is parsed as 'A,C,D'."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A, C, D"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="multiple_select", text="Select?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            result = client.complete("Prompt", question=question)

            assert result.answer == "A,C,D"
        finally:
            patcher.stop()

    def test_vllm_multiple_select_deduplicates(self):
        """Response 'A, A, C' is deduplicated to 'A,C'."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A, A, C"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="multiple_select", text="Select?",
                                options=["Opt1", "Opt2", "Opt3"])

            result = client.complete("Prompt", question=question)

            assert result.answer == "A,C"
        finally:
            patcher.stop()

    def test_vllm_multiple_select_single_letter(self):
        """Response 'B' is parsed as 'B' (single selection is valid)."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("B"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="multiple_select", text="Select?",
                                options=["Opt1", "Opt2", "Opt3"])

            result = client.complete("Prompt", question=question)

            assert result.answer == "B"
        finally:
            patcher.stop()


# ===========================================================================
# Ranking — Guided Decoding
# ===========================================================================


class TestRankingGuidedDecoding:
    """Tests for vLLM regex guided decoding with ranking questions."""

    def test_vllm_ranking_uses_guided_regex(self):
        """VLLMClient sends structured_outputs.regex with correct pattern for ranking."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("B, A, C, D"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="ranking", text="Rank these?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            client.complete("Test prompt", question=question)

            payload = get_payload(mock_client)
            assert "structured_outputs" in payload
            assert "regex" in payload["structured_outputs"]
            assert payload["structured_outputs"]["regex"] == "[A-D](, [A-D]){3}"
        finally:
            patcher.stop()

    def test_vllm_ranking_enforces_exact_count(self):
        """Regex pattern requires exactly N letters."""
        test_cases = [
            (2, "[A-B](, [A-B]){1}"),
            (3, "[A-C](, [A-C]){2}"),
            (5, "[A-E](, [A-E]){4}"),
        ]
        for num_options, expected_regex in test_cases:
            options = [f"Opt{i}" for i in range(num_options)]
            patcher, mock_client = mock_httpx_client(mock_vllm_response("A"))
            try:
                client = make_vllm_client()
                question = Question(qkey="q1", type="ranking", text="Rank?", options=options)

                client.complete("Prompt", question=question)

                payload = get_payload(mock_client)
                assert payload["structured_outputs"]["regex"] == expected_regex, \
                    f"Expected {expected_regex} for {num_options} options"
            finally:
                patcher.stop()

    def test_vllm_ranking_parses_complete_permutation(self):
        """Response 'B, A, C, D' is parsed as 'B,A,C,D'."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("B, A, C, D"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="ranking", text="Rank?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            result = client.complete("Prompt", question=question)

            assert result.answer == "B,A,C,D"
        finally:
            patcher.stop()

    def test_vllm_ranking_rejects_duplicates(self):
        """Response 'A, A, C, D' returns empty answer (triggers compliance retry)."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A, A, C, D"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="ranking", text="Rank?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            result = client.complete("Prompt", question=question)

            # After dedup: A, C, D — missing B, so require_all fails → empty
            assert result.answer == ""
        finally:
            patcher.stop()

    def test_vllm_ranking_rejects_incomplete(self):
        """Response 'A, B' (missing letters) returns empty answer."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("A, B"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="ranking", text="Rank?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            result = client.complete("Prompt", question=question)

            assert result.answer == ""
        finally:
            patcher.stop()


# ===========================================================================
# Open Response — Handling
# ===========================================================================


class TestOpenResponseHandling:
    """Tests for open response questions (no guided decoding)."""

    def test_vllm_open_response_no_guided_decoding(self):
        """Open response questions do NOT use structured_outputs."""
        patcher, mock_client = mock_httpx_client(
            mock_vllm_response("I think climate change is a serious issue")
        )
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="open_response", text="What do you think?")

            client.complete("Prompt", question=question)

            payload = get_payload(mock_client)
            assert "structured_outputs" not in payload
        finally:
            patcher.stop()

    def test_vllm_open_response_uses_raw_text(self):
        """Raw response text is used directly as the answer."""
        text = "I think climate change is a serious issue that requires immediate action"
        patcher, mock_client = mock_httpx_client(mock_vllm_response(text))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="open_response", text="What do you think?")

            result = client.complete("Prompt", question=question)

            assert result.answer == text
        finally:
            patcher.stop()

    def test_vllm_open_response_stop_sequences(self):
        """Only 'Question:' is used as stop sequence (not '\\n' or '.')."""
        patcher, mock_client = mock_httpx_client(
            mock_vllm_response("Some response text")
        )
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="open_response", text="Your thoughts?")

            client.complete("Prompt", question=question)

            payload = get_payload(mock_client)
            assert payload["stop"] == ["Question:"]
        finally:
            patcher.stop()

    def test_vllm_open_response_no_compliance_retry(self):
        """Open response skips compliance forcing (any non-empty text is valid)."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        # Single non-empty response — should accept immediately
        mock_llm.complete.return_value = LLMResponse(
            answer="This is my opinion on the topic",
            raw="This is my opinion on the topic",
        )

        processor = TaskProcessor(db=mock_db, llm=mock_llm)
        questions = [Question(qkey="q1", type="open_response", text="Your thoughts?")]

        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == "This is my opinion on the topic"
        assert mock_llm.complete.call_count == 1  # No retries

    def test_vllm_open_response_empty_retries(self):
        """Empty response still triggers retry (model produced nothing)."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        # First call: empty, second call: has content
        mock_llm.complete.side_effect = [
            LLMResponse(answer="", raw=""),
            LLMResponse(answer="Now I have something to say", raw="Now I have something to say"),
        ]

        processor = TaskProcessor(db=mock_db, llm=mock_llm)
        questions = [Question(qkey="q1", type="open_response", text="Your thoughts?")]

        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == "Now I have something to say"
        assert mock_llm.complete.call_count == 2


# ===========================================================================
# MCQ Regression
# ===========================================================================


class TestMCQRegression:
    """Ensure MCQ guided decoding is unchanged."""

    def test_vllm_mcq_still_uses_choice(self):
        """MCQ guided decoding unchanged (still uses structured_outputs.choice)."""
        patcher, mock_client = mock_httpx_client(mock_vllm_response("B"))
        try:
            client = make_vllm_client()
            question = Question(qkey="q1", type="mcq", text="Fav color?",
                                options=["Red", "Blue", "Green", "Yellow"])

            client.complete("Prompt", question=question)

            payload = get_payload(mock_client)
            assert "structured_outputs" in payload
            assert "choice" in payload["structured_outputs"]
            assert payload["structured_outputs"]["choice"] == ["A", "B", "C", "D"]
            assert payload["max_tokens"] == 1
        finally:
            patcher.stop()


# ===========================================================================
# Parser LLM Extension (Tier 2)
# ===========================================================================


class TestParserLLMExtension:
    """Tests for parser LLM handling multiple_select and ranking."""

    def test_parser_llm_multiple_select(self):
        """Parser LLM extracts comma-separated letters for multiple_select."""
        patcher, mock_client = mock_httpx_client(Mock(
            status_code=200,
            json=Mock(return_value={
                "choices": [{"message": {"content": "A, C, D"}}]
            }),
        ))
        try:
            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="multiple_select", text="Select all?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            result = parser.parse("I prefer options one, three, and four", question)

            assert result == "A,C,D"
        finally:
            patcher.stop()

    def test_parser_llm_ranking(self):
        """Parser LLM extracts ordered comma-separated letters for ranking."""
        patcher, mock_client = mock_httpx_client(Mock(
            status_code=200,
            json=Mock(return_value={
                "choices": [{"message": {"content": "B, A, C, D"}}]
            }),
        ))
        try:
            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="ranking", text="Rank these?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            result = parser.parse("I'd rank them second, first, third, fourth", question)

            assert result == "B,A,C,D"
        finally:
            patcher.stop()

    def test_parser_llm_prompt_format_multiple_select(self):
        """Parser prompt instructs 'Answer as comma-separated letters' for multiple_select."""
        patcher, mock_client = mock_httpx_client(Mock(
            status_code=200,
            json=Mock(return_value={
                "choices": [{"message": {"content": "A, C"}}]
            }),
        ))
        try:
            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="multiple_select", text="Which apply?",
                                options=["Opt1", "Opt2", "Opt3"])

            parser.parse("Opts one and three", question)

            payload = mock_client.post.call_args.kwargs["json"]
            prompt_text = payload["messages"][0]["content"]

            assert "comma-separated uppercase letters" in prompt_text
            assert "Which apply?" in prompt_text
            assert "(A) Opt1" in prompt_text
        finally:
            patcher.stop()

    def test_parser_llm_prompt_format_ranking(self):
        """Parser prompt instructs 'Answer as ordered comma-separated letters' for ranking."""
        patcher, mock_client = mock_httpx_client(Mock(
            status_code=200,
            json=Mock(return_value={
                "choices": [{"message": {"content": "B, A, C"}}]
            }),
        ))
        try:
            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="ranking", text="Rank these?",
                                options=["Opt1", "Opt2", "Opt3"])

            parser.parse("Second, first, third", question)

            payload = mock_client.post.call_args.kwargs["json"]
            prompt_text = payload["messages"][0]["content"]

            assert "ordered comma-separated uppercase letters" in prompt_text
            assert "most to least preferred" in prompt_text
            assert "Rank these?" in prompt_text
        finally:
            patcher.stop()


# ===========================================================================
# Integration Flows
# ===========================================================================


class TestIntegrationFlows:
    """Integration tests for the full pipeline with new question types."""

    def test_compliance_retry_ranking_invalid_permutation(self):
        """When ranking response has duplicates, compliance loop retries."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        # First: invalid (duplicates → empty), second: valid permutation
        mock_llm.complete.side_effect = [
            LLMResponse(answer="", raw="A, A, C, D"),
            LLMResponse(answer="B,A,C,D", raw="B, A, C, D"),
        ]

        processor = TaskProcessor(db=mock_db, llm=mock_llm)
        questions = [Question(qkey="q1", type="ranking", text="Rank?",
                              options=["Opt1", "Opt2", "Opt3", "Opt4"])]

        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == "B,A,C,D"
        assert mock_llm.complete.call_count == 2

    def test_context_accumulation_multiple_select(self):
        """Context includes full 'A, C, D' answer for subsequent questions."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        mock_llm.complete.side_effect = [
            LLMResponse(answer="A,C,D", raw="A, C, D"),
            LLMResponse(answer="B", raw="B"),
        ]

        processor = TaskProcessor(db=mock_db, llm=mock_llm)
        questions = [
            Question(qkey="q1", type="multiple_select", text="Select?",
                     options=["Opt1", "Opt2", "Opt3", "Opt4"]),
            Question(qkey="q2", type="mcq", text="Next Q?", options=["Yes", "No"]),
        ]

        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == "A,C,D"
        assert results["q2"] == "B"

        # Second call's prompt should contain the raw answer from first question
        second_prompt = mock_llm.complete.call_args_list[1].args[0]
        assert "A, C, D" in second_prompt

    def test_context_accumulation_open_response(self):
        """Context includes full text response for subsequent questions."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        open_text = "I believe strongly in renewable energy"
        mock_llm.complete.side_effect = [
            LLMResponse(answer=open_text, raw=open_text),
            LLMResponse(answer="A", raw="A"),
        ]

        processor = TaskProcessor(db=mock_db, llm=mock_llm)
        questions = [
            Question(qkey="q1", type="open_response", text="Your view?"),
            Question(qkey="q2", type="mcq", text="Next Q?", options=["Yes", "No"]),
        ]

        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == open_text
        assert results["q2"] == "A"

        # Second call's prompt should contain the open response text
        second_prompt = mock_llm.complete.call_args_list[1].args[0]
        assert open_text in second_prompt

    def test_mixed_question_types_in_series(self):
        """Survey with MCQ + multiple_select + open_response + ranking processes all types."""
        mock_db = Mock()
        mock_llm = Mock(spec=VLLMClient)
        mock_llm.use_guided_decoding = True

        mock_llm.complete.side_effect = [
            LLMResponse(answer="B", raw="B"),                              # MCQ
            LLMResponse(answer="A,C", raw="A, C"),                         # multiple_select
            LLMResponse(answer="I feel strongly about this", raw="I feel strongly about this"),  # open_response
            LLMResponse(answer="C,A,B,D", raw="C, A, B, D"),             # ranking
        ]

        processor = TaskProcessor(db=mock_db, llm=mock_llm)
        questions = [
            Question(qkey="q1", type="mcq", text="MCQ?", options=["Yes", "No"]),
            Question(qkey="q2", type="multiple_select", text="Select?",
                     options=["Opt1", "Opt2", "Opt3"]),
            Question(qkey="q3", type="open_response", text="Explain?"),
            Question(qkey="q4", type="ranking", text="Rank?",
                     options=["Opt1", "Opt2", "Opt3", "Opt4"]),
        ]

        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == "B"
        assert results["q2"] == "A,C"
        assert results["q3"] == "I feel strongly about this"
        assert results["q4"] == "C,A,B,D"
        assert mock_llm.complete.call_count == 4  # One call per question, no retries


# ===========================================================================
# LLMResponse.from_comma_separated unit tests
# ===========================================================================


class TestFromCommaSeparated:
    """Direct unit tests for the from_comma_separated parser."""

    def test_basic_comma_list(self):
        result = LLMResponse.from_comma_separated("A, C, D", 4)
        assert result.answer == "A,C,D"

    def test_single_letter(self):
        result = LLMResponse.from_comma_separated("B", 3)
        assert result.answer == "B"

    def test_deduplication(self):
        result = LLMResponse.from_comma_separated("A, A, C", 3)
        assert result.answer == "A,C"

    def test_preserves_order(self):
        result = LLMResponse.from_comma_separated("D, B, A, C", 4)
        assert result.answer == "D,B,A,C"

    def test_require_all_complete(self):
        result = LLMResponse.from_comma_separated("B, A, C, D", 4, require_all=True)
        assert result.answer == "B,A,C,D"

    def test_require_all_incomplete(self):
        result = LLMResponse.from_comma_separated("A, B", 4, require_all=True)
        assert result.answer == ""

    def test_require_all_with_duplicates(self):
        result = LLMResponse.from_comma_separated("A, A, C, D", 4, require_all=True)
        assert result.answer == ""  # Missing B after dedup

    def test_invalid_letters_filtered(self):
        result = LLMResponse.from_comma_separated("A, Z, C", 4)
        assert result.answer == "A,C"  # Z is out of range

    def test_empty_input(self):
        result = LLMResponse.from_comma_separated("", 4)
        assert result.answer == ""

    def test_one_option_degenerate(self):
        result = LLMResponse.from_comma_separated("A", 1)
        assert result.answer == "A"

    # --- Robust format handling ---

    def test_parenthesized_letters(self):
        """'(A), (B), (D)' → 'A,B,D'"""
        result = LLMResponse.from_comma_separated("(A), (B), (D)", 5)
        assert result.answer == "A,B,D"

    def test_bracketed_letters(self):
        """'[A], [C]' → 'A,C'"""
        result = LLMResponse.from_comma_separated("[A], [C]", 4)
        assert result.answer == "A,C"

    def test_mixed_format(self):
        """'A, (C), [D]' → 'A,C,D'"""
        result = LLMResponse.from_comma_separated("A, (C), [D]", 4)
        assert result.answer == "A,C,D"

    def test_letters_with_trailing_period(self):
        """'A, C, D.' → 'A,C,D'"""
        result = LLMResponse.from_comma_separated("A, C, D.", 4)
        assert result.answer == "A,C,D"

    def test_option_text_fallback(self):
        """'Software engineer/ML, Data scientist' matched to options."""
        options = ["Software engineer/ML", "Data scientist", "Product manager", "Designer"]
        result = LLMResponse.from_comma_separated(
            "Software engineer/ML, Data scientist", 4, options=options
        )
        assert result.answer == "A,B"

    def test_option_text_partial_match(self):
        """Partial option text matches."""
        options = ["Very excited", "Somewhat excited", "Not excited"]
        result = LLMResponse.from_comma_separated(
            "Very excited, Not excited", 3, options=options
        )
        assert result.answer == "A,C"

    def test_option_text_no_match_returns_empty(self):
        """Completely unrelated text returns empty."""
        options = ["Red", "Blue", "Green"]
        result = LLMResponse.from_comma_separated(
            "I like chocolate", 3, options=options
        )
        assert result.answer == ""
