"""
Tests for expanded guided decoding — multiple_select, ranking, and open_response.

Covers:
- Multiple select: regex guided decoding, dynamic options, parsing, deduplication
- Ranking: regex guided decoding, exact count, permutation validation
- Open response: no guided decoding, raw text
- Parser LLM extension for multiple_select and ranking
- Integration flows: compliance retry, context accumulation, mixed types
- MCQ regression: existing behavior unchanged
"""
import json
import pytest
from unittest.mock import Mock, patch, MagicMock

from src.llm import UnifiedLLMClient
from src.response import LLMResponse
from src.parser import ParserLLM, PARSER_PROMPT_MULTIPLE_SELECT, PARSER_PROMPT_RANKING
from src.prompt import Question
from src.worker import TaskProcessor


# ─── Helpers ─────────────────────────────────────────────────────────────────


def make_mock_chat_completion(content: str):
    """Create a mock OpenAI ChatCompletion response (for ParserLLM tests)."""
    choice = Mock()
    choice.message = Mock()
    choice.message.content = content
    completion = Mock()
    completion.choices = [choice]
    return completion


def make_vllm_client(**kwargs) -> UnifiedLLMClient:
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


def setup_sync_response(client, content):
    """Set up sync mock responses for both /v1/completions and /v1/chat/completions."""
    mock_sync = MagicMock()
    # /v1/completions (default mode)
    text_choice = Mock()
    text_choice.text = content
    mock_sync.completions.create.return_value = Mock(choices=[text_choice])
    # /v1/chat/completions (chat template mode)
    chat_choice = Mock()
    chat_choice.message = Mock(content=content)
    mock_sync.chat.completions.create.return_value = Mock(choices=[chat_choice])
    client._sync_client = mock_sync
    return mock_sync


def get_call_kwargs(mock, chat=False):
    if chat:
        return mock.chat.completions.create.call_args.kwargs
    return mock.completions.create.call_args.kwargs


# ===========================================================================
# Multiple Select — Guided Decoding
# ===========================================================================


class TestMultipleSelectGuidedDecoding:
    """Tests for multiple_select: JSON schema via response_format (vLLM supports both API modes)."""

    def test_vllm_multiple_select_uses_json_schema(self):
        """Multiple select uses response_format with json_schema (via extra_body in completions mode)."""
        client = make_vllm_client()
        json_resp = '{"choice_A": true, "choice_B": false, "choice_C": true, "choice_D": true}'
        mock = setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="multiple_select", text="Select all?",
                            options=["Opt1", "Opt2", "Opt3", "Opt4"])

        client.complete("Test prompt", question=question)

        kwargs = get_call_kwargs(mock)
        rf = kwargs["extra_body"]["response_format"]
        assert rf["type"] == "json_schema"
        schema = rf["json_schema"]["schema"]
        assert "choice_A" in schema["properties"]
        assert "choice_D" in schema["properties"]
        assert schema["properties"]["choice_A"]["type"] == "boolean"

    def test_vllm_multiple_select_default_max_tokens(self):
        """Multiple select uses default max_tokens (schema constrains output)."""
        client = make_vllm_client()
        json_resp = '{"choice_A": true, "choice_B": false, "choice_C": false, "choice_D": false, "choice_E": false}'
        mock = setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="multiple_select", text="Select?",
                            options=["A", "B", "C", "D", "E"])

        client.complete("Prompt", question=question)

        kwargs = get_call_kwargs(mock)
        assert kwargs["max_tokens"] == 128  # default, not 3 * 5

    def test_vllm_multiple_select_dynamic_options(self):
        """JSON schema properties adjust to option count."""
        test_cases = [
            (2, ["choice_A", "choice_B"]),
            (3, ["choice_A", "choice_B", "choice_C"]),
            (5, ["choice_A", "choice_B", "choice_C", "choice_D", "choice_E"]),
        ]
        for num_options, expected_keys in test_cases:
            options = [f"Opt{i}" for i in range(num_options)]
            all_false = {f"choice_{chr(65+i)}": False for i in range(num_options)}
            all_false["choice_A"] = True
            json_resp = json.dumps(all_false)
            client = make_vllm_client()
            mock = setup_sync_response(client, json_resp)
            question = Question(qkey="q1", type="multiple_select", text="Select?", options=options)

            client.complete("Prompt", question=question)

            kwargs = get_call_kwargs(mock)
            schema = kwargs["extra_body"]["response_format"]["json_schema"]["schema"]
            assert sorted(schema["properties"].keys()) == sorted(expected_keys)

    def test_vllm_multiple_select_parses_boolean_map(self):
        """Boolean map is parsed as 'A,C,D'."""
        client = make_vllm_client()
        json_resp = '{"choice_A": true, "choice_B": false, "choice_C": true, "choice_D": true}'
        setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="multiple_select", text="Select?",
                            options=["Opt1", "Opt2", "Opt3", "Opt4"])

        result = client.complete("Prompt", question=question)
        assert result.answer == "A,C,D"

    def test_vllm_multiple_select_all_false(self):
        """All-false boolean map returns empty answer."""
        client = make_vllm_client()
        json_resp = '{"choice_A": false, "choice_B": false, "choice_C": false}'
        setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="multiple_select", text="Select?",
                            options=["Opt1", "Opt2", "Opt3"])

        result = client.complete("Prompt", question=question)
        assert result.answer == ""

    def test_vllm_multiple_select_single_true(self):
        """Single true in boolean map is parsed correctly."""
        client = make_vllm_client()
        json_resp = '{"choice_A": false, "choice_B": true, "choice_C": false}'
        setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="multiple_select", text="Select?",
                            options=["Opt1", "Opt2", "Opt3"])

        result = client.complete("Prompt", question=question)
        assert result.answer == "B"


# ===========================================================================
# Ranking — Guided Decoding
# ===========================================================================


class TestRankingGuidedDecoding:
    """Tests for vLLM JSON schema guided decoding with ranking questions."""

    def test_vllm_ranking_uses_json_schema(self):
        """UnifiedLLMClient sends response_format with json_schema for ranking (via extra_body in completions mode)."""
        client = make_vllm_client()
        json_resp = '{"ranking": ["B", "A", "C", "D"]}'
        mock = setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="ranking", text="Rank these?",
                            options=["Opt1", "Opt2", "Opt3", "Opt4"])

        client.complete("Test prompt", question=question)

        kwargs = get_call_kwargs(mock)
        rf = kwargs["extra_body"]["response_format"]
        assert rf["type"] == "json_schema"
        schema = rf["json_schema"]["schema"]
        assert "ranking" in schema["properties"]
        assert schema["properties"]["ranking"]["minItems"] == 4
        assert schema["properties"]["ranking"]["maxItems"] == 4

    def test_vllm_ranking_enforces_exact_count_in_schema(self):
        """JSON schema minItems/maxItems matches option count."""
        test_cases = [
            (2, 2),
            (3, 3),
            (5, 5),
        ]
        for num_options, expected_count in test_cases:
            options = [f"Opt{i}" for i in range(num_options)]
            letters = [chr(65 + i) for i in range(num_options)]
            json_resp = json.dumps({"ranking": letters})
            client = make_vllm_client()
            mock = setup_sync_response(client, json_resp)
            question = Question(qkey="q1", type="ranking", text="Rank?", options=options)

            client.complete("Prompt", question=question)

            kwargs = get_call_kwargs(mock)
            schema = kwargs["extra_body"]["response_format"]["json_schema"]["schema"]
            assert schema["properties"]["ranking"]["minItems"] == expected_count
            assert schema["properties"]["ranking"]["maxItems"] == expected_count

    def test_vllm_ranking_parses_complete_permutation(self):
        """Response '{"ranking": ["B","A","C","D"]}' is parsed as 'B,A,C,D'."""
        client = make_vllm_client()
        json_resp = '{"ranking": ["B", "A", "C", "D"]}'
        setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="ranking", text="Rank?",
                            options=["Opt1", "Opt2", "Opt3", "Opt4"])

        result = client.complete("Prompt", question=question)
        assert result.answer == "B,A,C,D"

    def test_vllm_ranking_rejects_duplicates(self):
        """Ranking with duplicates returns empty (triggers compliance retry)."""
        client = make_vllm_client()
        json_resp = '{"ranking": ["A", "A", "C", "D"]}'
        setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="ranking", text="Rank?",
                            options=["Opt1", "Opt2", "Opt3", "Opt4"])

        result = client.complete("Prompt", question=question)
        assert result.answer == ""

    def test_vllm_ranking_rejects_incomplete(self):
        """Ranking with missing letters returns empty."""
        client = make_vllm_client()
        json_resp = '{"ranking": ["A", "B"]}'
        setup_sync_response(client, json_resp)
        question = Question(qkey="q1", type="ranking", text="Rank?",
                            options=["Opt1", "Opt2", "Opt3", "Opt4"])

        result = client.complete("Prompt", question=question)
        assert result.answer == ""


# ===========================================================================
# Open Response — Handling
# ===========================================================================


class TestOpenResponseHandling:
    """Tests for open response questions (no guided decoding)."""

    def test_vllm_open_response_no_guided_decoding(self):
        """Open response questions do NOT use extra_body."""
        client = make_vllm_client()
        mock = setup_sync_response(client, "I think climate change is a serious issue")
        question = Question(qkey="q1", type="open_response", text="What do you think?")

        client.complete("Prompt", question=question)

        kwargs = get_call_kwargs(mock)
        assert "extra_body" not in kwargs

    def test_vllm_open_response_uses_raw_text(self):
        """Raw response text is used directly as the answer."""
        text = "I think climate change is a serious issue that requires immediate action"
        client = make_vllm_client()
        setup_sync_response(client, text)
        question = Question(qkey="q1", type="open_response", text="What do you think?")

        result = client.complete("Prompt", question=question)
        assert result.answer == text.strip()

    def test_vllm_open_response_no_compliance_retry(self):
        """Open response skips compliance forcing (any non-empty text is valid)."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
        mock_llm.use_guided_decoding = True

        mock_llm.complete.return_value = LLMResponse(
            answer="This is my opinion on the topic",
            raw="This is my opinion on the topic",
        )

        processor = TaskProcessor(db=mock_db, llm=mock_llm)
        questions = [Question(qkey="q1", type="open_response", text="Your thoughts?")]

        results = processor.process_questions_in_series("Backstory", questions)

        assert results["q1"] == "This is my opinion on the topic"
        assert mock_llm.complete.call_count == 1

    def test_vllm_open_response_empty_retries(self):
        """Empty response still triggers retry (model produced nothing)."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
        mock_llm.use_guided_decoding = True

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
        """MCQ guided decoding unchanged (uses extra_body with choice)."""
        client = make_vllm_client()
        mock = setup_sync_response(client, "B")
        question = Question(qkey="q1", type="mcq", text="Fav color?",
                            options=["Red", "Blue", "Green", "Yellow"])

        client.complete("Prompt", question=question)

        kwargs = get_call_kwargs(mock)  # completions mode by default
        assert kwargs["extra_body"]["structured_outputs"]["choice"] == ["A", "B", "C", "D"]
        assert kwargs["max_tokens"] == 1


# ===========================================================================
# Parser LLM Extension (Tier 2)
# ===========================================================================


class TestParserLLMExtension:
    """Tests for parser LLM handling multiple_select and ranking."""

    def test_parser_llm_multiple_select(self):
        """Parser LLM extracts comma-separated letters for multiple_select."""
        with patch("src.parser.OpenAI") as MockOpenAI, patch("src.parser.AsyncOpenAI"):
            mock_sync = MagicMock()
            mock_sync.chat.completions.create.return_value = make_mock_chat_completion("A, C, D")
            MockOpenAI.return_value = mock_sync

            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="multiple_select", text="Select all?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            result = parser.parse("I prefer options one, three, and four", question)
            assert result == "A,C,D"

    def test_parser_llm_ranking(self):
        """Parser LLM extracts ordered letters for ranking."""
        with patch("src.parser.OpenAI") as MockOpenAI, patch("src.parser.AsyncOpenAI"):
            mock_sync = MagicMock()
            mock_sync.chat.completions.create.return_value = make_mock_chat_completion("B, A, C, D")
            MockOpenAI.return_value = mock_sync

            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="ranking", text="Rank these?",
                                options=["Opt1", "Opt2", "Opt3", "Opt4"])

            result = parser.parse("I'd rank them second, first, third, fourth", question)
            assert result == "B,A,C,D"

    def test_parser_llm_prompt_format_multiple_select(self):
        """Parser prompt instructs 'Answer as comma-separated letters' for multiple_select."""
        with patch("src.parser.OpenAI") as MockOpenAI, patch("src.parser.AsyncOpenAI"):
            mock_sync = MagicMock()
            mock_sync.chat.completions.create.return_value = make_mock_chat_completion("A, C")
            MockOpenAI.return_value = mock_sync

            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="multiple_select", text="Which apply?",
                                options=["Opt1", "Opt2", "Opt3"])

            parser.parse("Opts one and three", question)

            call_kwargs = mock_sync.chat.completions.create.call_args.kwargs
            prompt_text = call_kwargs["messages"][0]["content"]

            assert "comma-separated uppercase letters" in prompt_text
            assert "Which apply?" in prompt_text
            assert "(A) Opt1" in prompt_text

    def test_parser_llm_prompt_format_ranking(self):
        """Parser prompt instructs 'Answer as ordered comma-separated letters' for ranking."""
        with patch("src.parser.OpenAI") as MockOpenAI, patch("src.parser.AsyncOpenAI"):
            mock_sync = MagicMock()
            mock_sync.chat.completions.create.return_value = make_mock_chat_completion("B, A, C")
            MockOpenAI.return_value = mock_sync

            parser = ParserLLM(api_key="test-key", model="test-model")
            question = Question(qkey="q1", type="ranking", text="Rank these?",
                                options=["Opt1", "Opt2", "Opt3"])

            parser.parse("Second, first, third", question)

            call_kwargs = mock_sync.chat.completions.create.call_args.kwargs
            prompt_text = call_kwargs["messages"][0]["content"]

            assert "ordered comma-separated uppercase letters" in prompt_text
            assert "most to least preferred" in prompt_text
            assert "Rank these?" in prompt_text


# ===========================================================================
# Integration Flows
# ===========================================================================


class TestIntegrationFlows:
    """Integration tests for the full pipeline with new question types."""

    def test_compliance_retry_ranking_invalid_permutation(self):
        """When ranking response has duplicates, compliance loop retries."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
        mock_llm.use_guided_decoding = True

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
        mock_llm = Mock(spec=UnifiedLLMClient)
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

        second_prompt = mock_llm.complete.call_args_list[1].args[0]
        assert "A, C, D" in second_prompt

    def test_context_accumulation_open_response(self):
        """Context includes full text response for subsequent questions."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
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

        second_prompt = mock_llm.complete.call_args_list[1].args[0]
        assert open_text in second_prompt

    def test_mixed_question_types_in_series(self):
        """Survey with MCQ + multiple_select + open_response + ranking processes all types."""
        mock_db = Mock()
        mock_llm = Mock(spec=UnifiedLLMClient)
        mock_llm.use_guided_decoding = True

        mock_llm.complete.side_effect = [
            LLMResponse(answer="B", raw="B"),
            LLMResponse(answer="A,C", raw="A, C"),
            LLMResponse(answer="I feel strongly about this", raw="I feel strongly about this"),
            LLMResponse(answer="C,A,B,D", raw="C, A, B, D"),
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
        assert mock_llm.complete.call_count == 4


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
        assert result.answer == ""

    def test_invalid_letters_filtered(self):
        result = LLMResponse.from_comma_separated("A, Z, C", 4)
        assert result.answer == "A,C"

    def test_empty_input(self):
        result = LLMResponse.from_comma_separated("", 4)
        assert result.answer == ""

    def test_one_option_degenerate(self):
        result = LLMResponse.from_comma_separated("A", 1)
        assert result.answer == "A"

    def test_parenthesized_letters(self):
        result = LLMResponse.from_comma_separated("(A), (B), (D)", 5)
        assert result.answer == "A,B,D"

    def test_bracketed_letters(self):
        result = LLMResponse.from_comma_separated("[A], [C]", 4)
        assert result.answer == "A,C"

    def test_mixed_format(self):
        result = LLMResponse.from_comma_separated("A, (C), [D]", 4)
        assert result.answer == "A,C,D"

    def test_letters_with_trailing_period(self):
        result = LLMResponse.from_comma_separated("A, C, D.", 4)
        assert result.answer == "A,C,D"

    def test_option_text_fallback(self):
        options = ["Software engineer/ML", "Data scientist", "Product manager", "Designer"]
        result = LLMResponse.from_comma_separated(
            "Software engineer/ML, Data scientist", 4, options=options
        )
        assert result.answer == "A,B"

    def test_option_text_partial_match(self):
        options = ["Very excited", "Somewhat excited", "Not excited"]
        result = LLMResponse.from_comma_separated(
            "Very excited, Not excited", 3, options=options
        )
        assert result.answer == "A,C"

    def test_option_text_no_match_returns_empty(self):
        options = ["Red", "Blue", "Green"]
        result = LLMResponse.from_comma_separated(
            "I like chocolate", 3, options=options
        )
        assert result.answer == ""
