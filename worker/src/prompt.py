"""
Prompt construction module following Anthology format.

Key design principles (from anthology):
1. No system prompt - backstory + questions concatenated
2. Questions asked in series with context accumulation
3. LLM sees its previous answers when answering follow-up questions
4. Consistency prompt added for follow-up questions
"""
from dataclasses import dataclass
from typing import Optional, List, Tuple, Type

from pydantic import BaseModel, ConfigDict, Field, create_model


# Consistency prompt for follow-up questions (from anthology)
CONSISTENCY_PROMPT = "Please answer the following question keeping in mind your previous answers."


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
        Answer with (A), (B), (C), or (D).
        Answer:
    """
    if not question.options:
        raise ValueError(f"MCQ question {question.qkey} has no options")

    # Build choice string with (A), (B), etc.
    choice_lines = []
    letters = []
    for idx, option in enumerate(question.options):
        letter = chr(65 + idx)  # 65 = 'A'
        letters.append(f"({letter})")
        choice_lines.append(f"({letter}) {option}")

    choices_str = "\n".join(choice_lines)
    answer_forcing = f"Answer with {', '.join(letters[:-1])}, or {letters[-1]}." if len(letters) > 1 else f"Answer with {letters[0]}."

    return f"Question: {question.text}\n{choices_str}\n{answer_forcing}\nAnswer:"


def format_open_response_question(question: Question, max_words: Optional[int] = None) -> str:
    """
    Format an open response question.

    Format:
        Question: {question_text}
        Answer in approximately N words.
        Answer:
    """
    if max_words:
        return f"Question: {question.text}\nAnswer in approximately {max_words} words.\nAnswer:"
    return f"Question: {question.text}\nAnswer:"


def format_multiple_select_question(question: Question) -> str:
    """
    Format a multiple select question.

    Format:
        Question: {question_text}
        (A) Option 1
        (B) Option 2
        ...
        Select all that apply. Answer with comma-separated letters (e.g., A, C, D).
        Answer:
    """
    if not question.options:
        raise ValueError(f"Multiple select question {question.qkey} has no options")

    choice_lines = []
    for idx, option in enumerate(question.options):
        letter = chr(65 + idx)
        choice_lines.append(f"({letter}) {option}")

    choices_str = "\n".join(choice_lines)

    return f"Question: {question.text}\n{choices_str}\nSelect all that apply. Answer with comma-separated letters (e.g., A, C, D).\nAnswer:"


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

    choice_lines = []
    for idx, option in enumerate(question.options):
        letter = chr(65 + idx)
        choice_lines.append(f"({letter}) {option}")

    choices_str = "\n".join(choice_lines)

    return f"Question: {question.text}\n{choices_str}\nRank all options from most to least preferred (e.g., A, C, B, D).\nAnswer:"


def format_question(question: Question, max_words: Optional[int] = None) -> str:
    """Format a question based on its type."""
    if question.type == "mcq":
        return format_mcq_question(question)
    elif question.type == "multiple_select":
        return format_multiple_select_question(question)
    elif question.type == "open_response":
        return format_open_response_question(question, max_words=max_words)
    elif question.type == "ranking":
        return format_ranking_question(question)
    else:
        # Default to open response
        return format_open_response_question(question, max_words=max_words)


def build_initial_prompt(backstory: Optional[str], question: Question, max_words: Optional[int] = None) -> str:
    """
    Build the initial prompt for the first question.

    Format:
        [backstory]

        Question: ...
        Answer:

    Args:
        backstory: The backstory text
        question: First question to ask
        max_words: Suggested word count for open response questions

    Returns:
        Initial prompt string
    """
    parts = []

    if backstory and backstory.strip():
        parts.append(backstory.strip())

    parts.append(format_question(question, max_words=max_words))

    return "\n\n".join(parts)


def append_answer_to_context(context: str, answer: str) -> str:
    """
    Append the LLM's answer to the accumulated context.

    The context should end with "Answer:" and we append the response.

    Args:
        context: Current accumulated context (ends with "Answer:")
        answer: The LLM's answer to append

    Returns:
        Updated context with answer appended
    """
    # Clean up the answer - just the letter/response
    answer = answer.strip()
    return f"{context} {answer}"


def build_followup_prompt(context: str, question: Question, max_words: Optional[int] = None) -> str:
    """
    Build a follow-up question prompt with consistency message.

    This appends the next question to the accumulated context,
    so the LLM can see its previous answers.

    Format:
        [previous context with Q&A]

        Please answer the following question keeping in mind your previous answers.
        Question: ...
        Answer:

    Args:
        context: Accumulated context (backstory + previous Q&As)
        question: Next question to ask
        max_words: Suggested word count for open response questions

    Returns:
        Updated prompt with new question
    """
    formatted_q = format_question(question, max_words=max_words)
    return f"{context}\n\n{CONSISTENCY_PROMPT}\n{formatted_q}"


def build_single_question_prompt(
    backstory: Optional[str],
    question: Question,
) -> str:
    """
    Build a prompt for a single question (no context accumulation).

    For backwards compatibility or single-question surveys.

    Args:
        backstory: The backstory text
        question: Single Question object

    Returns:
        Prompt string for one question
    """
    return build_initial_prompt(backstory, question)


# ─── Pydantic response models for structured outputs ────────────────────────


class _StrictBase(BaseModel):
    """Base for all structured output models (additionalProperties: false)."""
    model_config = ConfigDict(extra="forbid")


class OpenResponseModel(_StrictBase):
    """Open response: free-form text."""
    answer: str


def get_response_model(question: Question) -> Type[BaseModel]:
    """
    Return a Pydantic model class whose JSON schema matches the expected
    structured output for this question type.

    The model is used for:
      1. Schema generation: model.model_json_schema() → response_format
      2. Response parsing: model.model_validate_json(content) → typed object
    """
    num_options = len(question.options) if question.options else 4
    letters = [chr(65 + i) for i in range(num_options)]

    if question.type == "mcq":
        return create_model(
            "MCQResponse",
            __base__=_StrictBase,
            answer=(str, Field(json_schema_extra={"enum": letters})),
        )

    elif question.type == "multiple_select":
        fields = {f"choice_{l}": (bool, ...) for l in letters}
        return create_model("MultipleSelectResponse", __base__=_StrictBase, **fields)

    elif question.type == "ranking":
        return create_model(
            "RankingResponse",
            __base__=_StrictBase,
            ranking=(List[str], Field(
                json_schema_extra={
                    "items": {"type": "string", "enum": letters},
                    "minItems": num_options,
                    "maxItems": num_options,
                },
            )),
        )

    else:
        return OpenResponseModel


def get_response_schema(question: Question) -> dict:
    """Get JSON schema dict for the question type (delegates to Pydantic)."""
    return get_response_model(question).model_json_schema()
