"""
Tests for prompt construction module.
Following anthology format for MCQ questions.
"""
import pytest
from src.prompt import (
    format_mcq_question,
    format_open_response_question,
    build_survey_prompt,
    Question,
)


class TestFormatMCQQuestion:
    """Tests for MCQ question formatting (anthology style)."""

    def test_mcq_with_four_options(self):
        """MCQ with 4 options formats correctly with (A), (B), (C), (D)."""
        question = Question(
            qkey="q1",
            type="mcq",
            text="What is your favorite color?",
            options=["Red", "Blue", "Green", "Yellow"],
        )

        result = format_mcq_question(question)

        expected = (
            "Question: What is your favorite color?\n"
            "(A) Red\n"
            "(B) Blue\n"
            "(C) Green\n"
            "(D) Yellow\n"
            "\n"
            "Answer:"
        )
        assert result == expected

    def test_mcq_with_two_options(self):
        """MCQ with 2 options formats correctly."""
        question = Question(
            qkey="q2",
            type="mcq",
            text="Do you agree?",
            options=["Yes", "No"],
        )

        result = format_mcq_question(question)

        expected = (
            "Question: Do you agree?\n"
            "(A) Yes\n"
            "(B) No\n"
            "\n"
            "Answer:"
        )
        assert result == expected

    def test_mcq_with_long_options(self):
        """MCQ with longer option text formats correctly."""
        question = Question(
            qkey="q3",
            type="mcq",
            text="Which statement best describes your view?",
            options=[
                "Strongly agree with the proposal",
                "Somewhat agree with the proposal",
                "Somewhat disagree with the proposal",
                "Strongly disagree with the proposal",
            ],
        )

        result = format_mcq_question(question)

        assert "(A) Strongly agree with the proposal" in result
        assert "(D) Strongly disagree with the proposal" in result
        assert result.endswith("Answer:")

    def test_mcq_preserves_question_text_exactly(self):
        """Question text should be preserved exactly as provided."""
        question = Question(
            qkey="q1",
            type="mcq",
            text="Do you think that the government should do more to help people?",
            options=["Yes", "No"],
        )

        result = format_mcq_question(question)

        assert "Do you think that the government should do more to help people?" in result


class TestFormatOpenResponseQuestion:
    """Tests for open response question formatting."""

    def test_open_response_basic(self):
        """Open response question formats correctly."""
        question = Question(
            qkey="q1",
            type="open_response",
            text="What are your thoughts on climate change?",
            options=None,
        )

        result = format_open_response_question(question)

        expected = (
            "Question: What are your thoughts on climate change?\n"
            "\n"
            "Answer:"
        )
        assert result == expected

    def test_open_response_preserves_text(self):
        """Open response preserves question text exactly."""
        question = Question(
            qkey="q1",
            type="open_response",
            text="Please describe your experience.",
            options=None,
        )

        result = format_open_response_question(question)

        assert "Please describe your experience." in result


class TestBuildSurveyPrompt:
    """Tests for building the full survey prompt with backstory."""

    def test_backstory_plus_single_question(self):
        """Single question appended after backstory."""
        backstory = "I am a 35 year old teacher from California."
        questions = [
            Question(
                qkey="q1",
                type="mcq",
                text="Do you support public education funding?",
                options=["Yes", "No"],
            )
        ]

        result = build_survey_prompt(backstory, questions)

        # Backstory should come first
        assert result.startswith("I am a 35 year old teacher from California.")
        # Then the question
        assert "Question: Do you support public education funding?" in result
        assert "(A) Yes" in result
        assert "(B) No" in result
        assert result.endswith("Answer:")

    def test_backstory_plus_multiple_questions_in_series(self):
        """Multiple questions formatted in series (one after another)."""
        backstory = "I am a software engineer."
        questions = [
            Question(
                qkey="q1",
                type="mcq",
                text="Question 1?",
                options=["A", "B"],
            ),
            Question(
                qkey="q2",
                type="mcq",
                text="Question 2?",
                options=["C", "D"],
            ),
        ]

        result = build_survey_prompt(backstory, questions)

        # Both questions should be present
        assert "Question: Question 1?" in result
        assert "Question: Question 2?" in result
        # Q1 should come before Q2
        q1_pos = result.find("Question: Question 1?")
        q2_pos = result.find("Question: Question 2?")
        assert q1_pos < q2_pos

    def test_empty_backstory_handled_gracefully(self):
        """Empty backstory should not cause errors."""
        backstory = ""
        questions = [
            Question(
                qkey="q1",
                type="mcq",
                text="Test question?",
                options=["Yes", "No"],
            )
        ]

        result = build_survey_prompt(backstory, questions)

        # Should still have the question
        assert "Question: Test question?" in result
        assert "(A) Yes" in result
        # Should start with the question (no leading backstory)
        assert result.strip().startswith("Question:")

    def test_none_backstory_handled_gracefully(self):
        """None backstory should be handled like empty string."""
        backstory = None
        questions = [
            Question(
                qkey="q1",
                type="mcq",
                text="Test question?",
                options=["Yes", "No"],
            )
        ]

        result = build_survey_prompt(backstory, questions)

        assert "Question: Test question?" in result

    def test_mixed_question_types(self):
        """Prompt with mixed MCQ and open response questions."""
        backstory = "I am a participant."
        questions = [
            Question(
                qkey="q1",
                type="mcq",
                text="Choose one:",
                options=["A", "B"],
            ),
            Question(
                qkey="q2",
                type="open_response",
                text="Explain your choice:",
                options=None,
            ),
        ]

        result = build_survey_prompt(backstory, questions)

        assert "Question: Choose one:" in result
        assert "(A) A" in result
        assert "Question: Explain your choice:" in result

    def test_whitespace_trimmed(self):
        """Extra whitespace in backstory should be trimmed."""
        backstory = "  I am a participant.  \n\n"
        questions = [
            Question(
                qkey="q1",
                type="mcq",
                text="Test?",
                options=["Yes", "No"],
            )
        ]

        result = build_survey_prompt(backstory, questions)

        # Should not have excessive whitespace at start
        assert not result.startswith(" ")
        assert not result.startswith("\n\n")


class TestQuestionDataclass:
    """Tests for the Question dataclass."""

    def test_question_creation(self):
        """Question can be created with all fields."""
        q = Question(
            qkey="q1",
            type="mcq",
            text="Test?",
            options=["A", "B"],
        )
        assert q.qkey == "q1"
        assert q.type == "mcq"
        assert q.text == "Test?"
        assert q.options == ["A", "B"]

    def test_question_from_dict(self):
        """Question can be created from a dictionary."""
        data = {
            "qkey": "q1",
            "type": "mcq",
            "text": "Test?",
            "options": ["A", "B"],
        }
        q = Question.from_dict(data)
        assert q.qkey == "q1"
        assert q.text == "Test?"

    def test_question_optional_options(self):
        """Question options can be None for open response."""
        q = Question(
            qkey="q1",
            type="open_response",
            text="Test?",
            options=None,
        )
        assert q.options is None
