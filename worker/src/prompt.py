"""
Prompt construction module following Anthology format.

Key design principles (from anthology):
1. No system prompt - backstory + questions concatenated
2. Questions asked in series with context accumulation
3. LLM sees its previous answers when answering follow-up questions
4. Consistency prompt added for follow-up questions
"""
from dataclasses import dataclass
from typing import Optional, List, Tuple, Union


# Consistency prompt for follow-up questions (from anthology)
CONSISTENCY_PROMPT = "Please answer the following question keeping in mind your previous answers."


@dataclass
class MediaAttachment:
    """Media file attached to a question or option."""
    key: str    # Wasabi object key (e.g., "media/abc123.png")
    type: str   # MIME type (e.g., "image/png", "audio/wav")
    name: str   # Original filename for display

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> Optional["MediaAttachment"]:
        """Create MediaAttachment from a dictionary, or None if data is None."""
        if not data:
            return None
        return cls(
            key=data.get("key", ""),
            type=data.get("type", ""),
            name=data.get("name", ""),
        )


# Content part for multimodal messages (OpenAI format)
ContentPart = dict  # {"type": "text", "text": "..."} or {"type": "image_url", "image_url": {...}}

# Prompt can be text-only (str) or multimodal (list of content parts)
Prompt = Union[str, List[ContentPart]]


@dataclass
class QuestionMedia:
    """Pre-downloaded media for a question, ready for LLM."""
    question_media: Optional[Tuple[str, str]] = None  # (base64_data, mime_type)
    option_media: Optional[List[Optional[Tuple[str, str]]]] = None  # parallel to options[]


@dataclass
class Question:
    """Survey question data structure."""
    qkey: str
    type: str  # 'mcq', 'multiple_select', 'open_response', 'ranking'
    text: str
    options: Optional[List[str]] = None
    media: Optional[MediaAttachment] = None
    option_media: Optional[List[Optional[MediaAttachment]]] = None

    @classmethod
    def from_dict(cls, data: dict) -> "Question":
        """Create Question from a dictionary."""
        raw_option_media = data.get("option_media")
        option_media = None
        if raw_option_media and isinstance(raw_option_media, list):
            option_media = [MediaAttachment.from_dict(m) if m else None for m in raw_option_media]

        return cls(
            qkey=data.get("qkey", ""),
            type=data.get("type", "mcq"),
            text=data.get("text", ""),
            options=data.get("options"),
            media=MediaAttachment.from_dict(data.get("media")),
            option_media=option_media,
        )

    @property
    def has_media(self) -> bool:
        """Check if this question has any media attachments."""
        if self.media:
            return True
        if self.option_media:
            return any(m is not None for m in self.option_media)
        return False


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


# ─── JSON schemas for structured outputs ─────────────────────────────────────


def get_response_schema(question: Question) -> dict:
    """Return a JSON schema dict for the question type."""
    num_options = len(question.options) if question.options else 4
    letters = [chr(65 + i) for i in range(num_options)]

    if question.type == "mcq":
        return {
            "type": "object",
            "properties": {
                "answer": {"type": "string", "enum": letters},
            },
            "required": ["answer"],
            "additionalProperties": False,
        }

    elif question.type == "multiple_select":
        props = {f"choice_{l}": {"type": "boolean"} for l in letters}
        return {
            "type": "object",
            "properties": props,
            "required": [f"choice_{l}" for l in letters],
            "additionalProperties": False,
        }

    elif question.type == "ranking":
        return {
            "type": "object",
            "properties": {
                "ranking": {
                    "type": "array",
                    "items": {"type": "string", "enum": letters},
                    "minItems": num_options,
                    "maxItems": num_options,
                },
            },
            "required": ["ranking"],
            "additionalProperties": False,
        }

    else:
        return {
            "type": "object",
            "properties": {
                "answer": {"type": "string"},
            },
            "required": ["answer"],
            "additionalProperties": False,
        }


# ─── Demographic prompt builder ──────────────────────────────────────────────


def build_demographic_prompt(filters: dict) -> str:
    """
    Build a zero-shot demographic prompt text from a DemographicFilter dict.

    Logic (identical to frontend/src/lib/demographicPrompt.ts):
      - Keys processed in sorted order for determinism
      - "c_" prefix stripped → dimension name
      - Keys containing "age" get "year old" suffix
      - {min, max} → "{min}-{max} year old" / "{min}-{max} {dim_name}"
      - {min} only  → "{min}+ year old"     / "{min}+ {dim_name}"
      - {max} only  → "under {max} year old" / "under {max} {dim_name}"
      - list single → value as-is
      - list multi  → joined with " or "

    Returns "You are a {descriptors}." or "You are a person." if empty.
    """
    descriptors = []

    for key in sorted(filters.keys()):
        value = filters[key]
        if value is None:
            continue

        dim_name = key[2:] if key.startswith("c_") else key
        is_age = "age" in dim_name

        if isinstance(value, list):
            if not value:
                continue
            if len(value) == 1:
                descriptors.append(str(value[0]))
            else:
                descriptors.append(" or ".join(str(v) for v in value))
        elif isinstance(value, dict):
            min_val = value.get("min")
            max_val = value.get("max")
            if min_val is not None and max_val is not None:
                descriptors.append(
                    f"{min_val}-{max_val} year old" if is_age else f"{min_val}-{max_val} {dim_name}"
                )
            elif min_val is not None:
                descriptors.append(
                    f"{min_val}+ year old" if is_age else f"{min_val}+ {dim_name}"
                )
            elif max_val is not None:
                descriptors.append(
                    f"under {max_val} year old" if is_age else f"under {max_val} {dim_name}"
                )

    if not descriptors:
        return "You are a person."

    return f"You are a {' '.join(descriptors)}."


# ─── Multimodal prompt building ──────────────────────────────────────────────


def build_multimodal_prompt(
    text_prompt: str,
    question_media: Optional[QuestionMedia] = None,
) -> Prompt:
    """
    Wrap a text prompt with media content parts for multimodal LLMs.

    If no media is provided, returns the text prompt as-is (str).
    If media is present, returns a list of OpenAI-format content parts.

    Media is inserted between the text and the "Answer:" line so the LLM
    sees the images/audio in context with the question.
    """
    if not question_media:
        return text_prompt

    parts: List[ContentPart] = [{"type": "text", "text": text_prompt}]

    # Add question-level media
    if question_media.question_media:
        b64_data, mime_type = question_media.question_media
        if mime_type.startswith("image/"):
            parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{b64_data}"},
            })
        elif mime_type.startswith("audio/"):
            parts.append({
                "type": "input_audio",
                "input_audio": {"data": b64_data, "format": mime_type.split("/")[-1]},
            })

    # Add per-option media
    if question_media.option_media:
        for opt_media in question_media.option_media:
            if opt_media:
                b64_data, mime_type = opt_media
                if mime_type.startswith("image/"):
                    parts.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{b64_data}"},
                    })
                elif mime_type.startswith("audio/"):
                    parts.append({
                        "type": "input_audio",
                        "input_audio": {"data": b64_data, "format": mime_type.split("/")[-1]},
                    })

    return parts
