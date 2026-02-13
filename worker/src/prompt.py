"""
Prompt construction module following Anthology format.
No system prompt - backstory + formatted question concatenated.
"""
from dataclasses import dataclass
from typing import Optional, List


@dataclass
class Question:
    """Survey question data structure."""
    qkey: str
    type: str  # 'mcq', 'multiple_select', 'open_response', 'ranking'
    text: str
    options: Optional[List[str]] = None

    @classmethod
    def from_dict(cls, data: dict) -> "Question":
        """Create Question from a dictionary."""
        return cls(
            qkey=data.get("qkey", ""),
            type=data.get("type", "mcq"),
            text=data.get("text", ""),
            options=data.get("options"),
        )


def format_mcq_question(question: Question) -> str:
    """
    Format a multiple choice question following anthology style.

    Format:
        Question: {question_text}
        (A) Option 1
        (B) Option 2
        ...

        Select one answer.

        Answer:
    """
    if not question.options:
        raise ValueError(f"MCQ question {question.qkey} has no options")

    # Build choice string with (A), (B), etc.
    choice_lines = []
    for idx, option in enumerate(question.options):
        letter = chr(65 + idx)  # 65 = 'A'
        choice_lines.append(f"({letter}) {option}")

    choices_str = "\n".join(choice_lines)

    return f"Question: {question.text}\n{choices_str}\n\nSelect one answer.\n\nAnswer:"


def format_open_response_question(question: Question) -> str:
    """
    Format an open response question.

    Format:
        Question: {question_text}

        Provide a free-form text response.

        Answer:
    """
    return f"Question: {question.text}\n\nProvide a free-form text response.\n\nAnswer:"


def format_multiple_select_question(question: Question) -> str:
    """
    Format a multiple select question.

    Format:
        Question: {question_text}
        (A) Option 1
        (B) Option 2
        ...

        Select all that apply.

        Answer:
    """
    if not question.options:
        raise ValueError(f"Multiple select question {question.qkey} has no options")

    # Build choice string with (A), (B), etc.
    choice_lines = []
    for idx, option in enumerate(question.options):
        letter = chr(65 + idx)  # 65 = 'A'
        choice_lines.append(f"({letter}) {option}")

    choices_str = "\n".join(choice_lines)

    return f"Question: {question.text}\n{choices_str}\n\nSelect all that apply.\n\nAnswer:"


def format_ranking_question(question: Question) -> str:
    """
    Format a ranking question.

    Format:
        Question: {question_text}
        (A) Option 1
        (B) Option 2
        ...

        Rank all options from most to least preferred (e.g., A, C, B, D).

        Answer:
    """
    if not question.options:
        raise ValueError(f"Ranking question {question.qkey} has no options")

    # Build choice string with (A), (B), etc.
    choice_lines = []
    for idx, option in enumerate(question.options):
        letter = chr(65 + idx)  # 65 = 'A'
        choice_lines.append(f"({letter}) {option}")

    choices_str = "\n".join(choice_lines)

    return f"Question: {question.text}\n{choices_str}\n\nRank all options from most to least preferred (e.g., A, C, B, D).\n\nAnswer:"


def format_question(question: Question) -> str:
    """Format a question based on its type."""
    if question.type == "mcq":
        return format_mcq_question(question)
    elif question.type == "multiple_select":
        return format_multiple_select_question(question)
    elif question.type == "open_response":
        return format_open_response_question(question)
    elif question.type == "ranking":
        return format_ranking_question(question)
    else:
        # Default to open response
        return format_open_response_question(question)


def build_survey_prompt(
    backstory: Optional[str],
    questions: List[Question],
) -> str:
    """
    Build the full survey prompt with backstory and questions.

    Following anthology format:
    - No system prompt
    - Backstory text first (if present)
    - Then formatted questions in series

    Args:
        backstory: The backstory text (can be None or empty)
        questions: List of Question objects

    Returns:
        Complete prompt string
    """
    parts = []

    # Add backstory if present
    if backstory and backstory.strip():
        parts.append(backstory.strip())

    # Add each question
    for question in questions:
        formatted_q = format_question(question)
        parts.append(formatted_q)

    # Join with double newline
    return "\n\n".join(parts)


def build_single_question_prompt(
    backstory: Optional[str],
    question: Question,
) -> str:
    """
    Build a prompt for a single question.

    Args:
        backstory: The backstory text
        question: Single Question object

    Returns:
        Prompt string for one question
    """
    return build_survey_prompt(backstory, [question])


# Response schema for structured outputs (strict mode compatible)
def get_response_schema(question: Question) -> dict:
    """
    Get the appropriate response schema for a question type.

    Note: For strict mode, all properties must be in required,
    so we only include the answer field.
    """
    if question.type == "mcq":
        # Generate enum based on number of options
        num_options = len(question.options) if question.options else 4
        letters = [chr(65 + i) for i in range(num_options)]
        return {
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string",
                    "enum": letters,
                    "description": "The selected answer letter"
                }
            },
            "required": ["answer"],
            "additionalProperties": False
        }
    elif question.type == "multiple_select":
        num_options = len(question.options) if question.options else 4
        letters = [chr(65 + i) for i in range(num_options)]
        return {
            "type": "object",
            "properties": {
                "answers": {
                    "type": "array",
                    "items": {"type": "string", "enum": letters},
                    "description": "Array of selected answer letters"
                }
            },
            "required": ["answers"],
            "additionalProperties": False
        }
    elif question.type == "ranking":
        num_options = len(question.options) if question.options else 4
        letters = [chr(65 + i) for i in range(num_options)]
        return {
            "type": "object",
            "properties": {
                "ranking": {
                    "type": "array",
                    "items": {"type": "string", "enum": letters},
                    "description": "Array of answer letters in ranked order (first = highest)"
                }
            },
            "required": ["ranking"],
            "additionalProperties": False
        }
    else:
        # Open response
        return {
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string",
                    "description": "Free-form text response"
                }
            },
            "required": ["answer"],
            "additionalProperties": False
        }
