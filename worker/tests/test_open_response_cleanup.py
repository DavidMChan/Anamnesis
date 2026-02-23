"""
Tests for clean_open_response() — the open response post-processing pipeline.

Pipeline: clip boundary markers → HTML cleanup → sentence trim → strip.
"""
import pytest

from src.response import clean_open_response


class TestClipBoundaryMarkers:
    """Step 1: Clip at <Q> and Question: markers."""

    def test_clip_at_q_tag(self):
        result = clean_open_response("I think the answer is yes.<Q>Question: What do you...")
        assert result == "I think the answer is yes."

    def test_clip_at_question_colon(self):
        result = clean_open_response("I believe strongly in freedom. Question: How do you feel...")
        assert result == "I believe strongly in freedom."

    def test_case_insensitive_question_clip(self):
        result = clean_open_response("Yes definitely. question: next one")
        assert result == "Yes definitely."

    def test_multiple_q_tags(self):
        """Only clips at the first <Q>."""
        result = clean_open_response("Answer here.<Q>Next<Q>More")
        assert result == "Answer here."

    def test_q_tag_at_start(self):
        result = clean_open_response("<Q>Something after")
        assert result == ""

    def test_question_colon_at_start(self):
        result = clean_open_response("Question: What is your name?")
        assert result == ""

    def test_clip_at_prompt_template_leakage(self):
        """Model regurgitates the consistency prompt after a word count."""
        text = (
            "I believe education is the most important issue facing our country today. "
            "202 words Please answer the following question keeping in mind your previous answers."
        )
        result = clean_open_response(text)
        assert result == "I believe education is the most important issue facing our country today."

    def test_clip_prompt_template_case_insensitive(self):
        result = clean_open_response("Some answer. please answer the following question")
        assert result == "Some answer."


class TestHTMLCleanup:
    """Step 2: HTML entity unescape, <br> to newline, strip tags."""

    def test_html_entity_cleanup(self):
        result = clean_open_response("I don&amp;t think so.")
        assert result == "I don&t think so."

    def test_nbsp_cleanup(self):
        result = clean_open_response("Hello&nbsp;world.")
        assert result == "Hello\xa0world."

    def test_br_tag_cleanup(self):
        result = clean_open_response("Line one<br />Line two<br>Line three.")
        assert result == "Line one\nLine two\nLine three."

    def test_br_slash_variant(self):
        result = clean_open_response("A<br/>B.")
        assert result == "A\nB."

    def test_strip_remaining_html(self):
        result = clean_open_response("This is <b>bold</b> text.")
        assert result == "This is bold text."

    def test_nested_html(self):
        result = clean_open_response("This is <span class='test'><b>nested</b></span> text.")
        assert result == "This is nested text."


class TestSentenceTrim:
    """Step 3: Trim to last sentence boundary when text ends with a fragment."""

    def test_trim_at_last_sentence(self):
        result = clean_open_response(
            "I agree with this policy. The reason is that we should consid"
        )
        assert result == "I agree with this policy."

    def test_no_trim_when_ends_with_period(self):
        result = clean_open_response("I agree with this policy.")
        assert result == "I agree with this policy."

    def test_no_trim_when_ends_with_exclamation(self):
        result = clean_open_response("That's great!")
        assert result == "That's great!"

    def test_no_trim_when_ends_with_question_mark(self):
        result = clean_open_response("Is that right?")
        assert result == "Is that right?"

    def test_no_trim_when_no_punctuation(self):
        """Keep text as-is when no sentence-ending punctuation exists at all."""
        result = clean_open_response("Yes I think so")
        assert result == "Yes I think so"

    def test_trim_at_exclamation(self):
        result = clean_open_response("That's amazing! I also think that the next")
        assert result == "That's amazing!"

    def test_trim_at_question_mark(self):
        result = clean_open_response("Is this real? I wonder if the government")
        assert result == "Is this real?"


class TestFinalCleanup:
    """Step 4: Strip whitespace and edge cases."""

    def test_empty_string(self):
        assert clean_open_response("") == ""

    def test_whitespace_only(self):
        assert clean_open_response("   ") == ""

    def test_strips_leading_trailing_whitespace(self):
        result = clean_open_response("  Hello world.  ")
        assert result == "Hello world."


class TestCombinedPipeline:
    """Multiple pipeline steps applied in correct order."""

    def test_html_plus_clip_plus_trim(self):
        """Full pipeline: unescape + clip + trim to last sentence."""
        text = "I &amp; my friends agree. We think it&apos;s important<Q>Next question"
        result = clean_open_response(text)
        # After clip: "I & my friends agree. We think it's important"
        # Doesn't end with .!?, trim to last period: "I & my friends agree."
        assert result == "I & my friends agree."

    def test_br_plus_sentence_trim(self):
        text = "First point.<br>Second point.<br>Incomplete third"
        result = clean_open_response(text)
        assert result == "First point.\nSecond point."

    def test_clean_text_passes_through(self):
        """Already-clean text is returned unchanged."""
        text = "I think the government should invest more in education."
        assert clean_open_response(text) == text
