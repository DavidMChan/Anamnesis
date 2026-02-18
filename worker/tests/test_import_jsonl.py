"""Tests for import_jsonl_backstories script."""

import json
import os
import sys
import tempfile

import pytest

# Add scripts directory to path so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from import_jsonl_backstories import parse_demographics, sanitize_text, stream_jsonl


# ==================== Test fixtures ====================


def make_record(**overrides):
    """Create a minimal JSONL record with defaults."""
    record = {
        "virtual_subject_vuid": "test_vuid_001",
        "virtual_subject_backstory": "This is a test backstory.",
        "c_age_question_options": ["18-24", "25-34", "35-44", "45-54"],
        "c_age_top_choice": 2,
        "c_age_choices": {"0": 0.0, "1": 0.1, "2": 0.8, "3": 0.1},
        "c_gender_question_options": ["Male", "Female", "Other", "Prefer not to answer"],
        "c_gender_top_choice": 1,
        "c_gender_choices": {"0": 0.2, "1": 0.7, "2": 0.05, "3": 0.05},
    }
    record.update(overrides)
    return record


# ==================== parse_demographics tests ====================


class TestParseDemographics:
    def test_extracts_correct_format(self):
        record = make_record()
        result = parse_demographics(record)

        assert "c_age" in result
        assert result["c_age"]["value"] == "35-44"
        assert result["c_age"]["distribution"] == {
            "18-24": 0.0,
            "25-34": 0.1,
            "35-44": 0.8,
            "45-54": 0.1,
        }

        assert "c_gender" in result
        assert result["c_gender"]["value"] == "Female"
        assert result["c_gender"]["distribution"]["Female"] == 0.7

    def test_handles_missing_options(self):
        record = make_record()
        # Remove age options entirely
        del record["c_age_question_options"]
        result = parse_demographics(record)

        assert "c_age" not in result
        # Gender should still work
        assert "c_gender" in result

    def test_handles_missing_top_choice(self):
        record = make_record()
        del record["c_age_top_choice"]
        result = parse_demographics(record)

        assert "c_age" not in result
        assert "c_gender" in result

    def test_handles_missing_choices(self):
        record = make_record()
        del record["c_age_choices"]
        result = parse_demographics(record)

        # Should still have value from top_choice, just empty distribution
        assert result["c_age"]["value"] == "35-44"
        assert result["c_age"]["distribution"] == {}

    def test_handles_null_fields(self):
        record = make_record(
            c_age_question_options=None,
            c_age_top_choice=None,
            c_age_choices=None,
        )
        result = parse_demographics(record)
        assert "c_age" not in result

    def test_handles_out_of_range_top_choice(self):
        record = make_record(c_age_top_choice=99)
        result = parse_demographics(record)

        assert result["c_age"]["value"] is None
        # Distribution should still be built
        assert len(result["c_age"]["distribution"]) == 4

    def test_handles_out_of_range_choice_index(self):
        record = make_record(
            c_age_choices={"0": 0.5, "1": 0.3, "99": 0.2},
        )
        result = parse_demographics(record)

        # Index 99 should be skipped
        assert len(result["c_age"]["distribution"]) == 2
        assert "18-24" in result["c_age"]["distribution"]
        assert "25-34" in result["c_age"]["distribution"]

    def test_handles_empty_record(self):
        result = parse_demographics({})
        assert result == {}

    def test_all_11_fields_when_present(self):
        """All 11 demographic fields are extracted when present."""
        from import_jsonl_backstories import DEMO_FIELDS

        record = {}
        for field in DEMO_FIELDS:
            record[f"{field}_question_options"] = ["A", "B"]
            record[f"{field}_top_choice"] = 0
            record[f"{field}_choices"] = {"0": 0.6, "1": 0.4}

        result = parse_demographics(record)
        assert len(result) == 11
        for field in DEMO_FIELDS:
            assert field in result
            assert result[field]["value"] == "A"


# ==================== sanitize_text tests ====================


class TestSanitizeText:
    def test_removes_null_characters(self):
        assert sanitize_text("hello\u0000world") == "helloworld"

    def test_preserves_normal_text(self):
        text = "Hello, this is a normal backstory with unicode: café"
        assert sanitize_text(text) == text

    def test_removes_multiple_nulls(self):
        assert sanitize_text("\u0000a\u0000b\u0000") == "ab"

    def test_empty_string(self):
        assert sanitize_text("") == ""


# ==================== stream_jsonl tests ====================


class TestStreamJsonl:
    def _write_jsonl(self, records):
        """Write records to a temp JSONL file and return the path."""
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
        for record in records:
            f.write(json.dumps(record) + "\n")
        f.close()
        return f.name

    def test_basic_streaming(self):
        path = self._write_jsonl([make_record(virtual_subject_vuid="v1")])
        rows = list(stream_jsonl(path))
        os.unlink(path)

        assert len(rows) == 1
        assert rows[0]["vuid"] == "v1"
        assert rows[0]["source_type"] == "alterity"
        assert rows[0]["is_public"] is True
        assert "c_age" in rows[0]["demographics"]

    def test_dedup_by_vuid(self):
        records = [
            make_record(virtual_subject_vuid="v1", virtual_subject_backstory="first"),
            make_record(virtual_subject_vuid="v1", virtual_subject_backstory="second"),
            make_record(virtual_subject_vuid="v2", virtual_subject_backstory="third"),
        ]
        path = self._write_jsonl(records)
        rows = list(stream_jsonl(path))
        os.unlink(path)

        assert len(rows) == 2
        assert rows[0]["vuid"] == "v1"
        assert rows[0]["backstory_text"] == "first"  # First occurrence wins
        assert rows[1]["vuid"] == "v2"

    def test_limit(self):
        records = [
            make_record(virtual_subject_vuid=f"v{i}") for i in range(10)
        ]
        path = self._write_jsonl(records)
        rows = list(stream_jsonl(path, limit=3))
        os.unlink(path)

        assert len(rows) == 3

    def test_skips_empty_backstory(self):
        records = [
            make_record(virtual_subject_vuid="v1", virtual_subject_backstory=""),
            make_record(virtual_subject_vuid="v2", virtual_subject_backstory="  "),
            make_record(virtual_subject_vuid="v3", virtual_subject_backstory="real"),
        ]
        path = self._write_jsonl(records)
        rows = list(stream_jsonl(path))
        os.unlink(path)

        assert len(rows) == 1
        assert rows[0]["vuid"] == "v3"

    def test_skips_missing_vuid(self):
        records = [
            {"virtual_subject_backstory": "no vuid here"},
            make_record(virtual_subject_vuid="v1"),
        ]
        path = self._write_jsonl(records)
        rows = list(stream_jsonl(path))
        os.unlink(path)

        assert len(rows) == 1
        assert rows[0]["vuid"] == "v1"

    def test_skips_invalid_json(self):
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
        f.write(json.dumps(make_record(virtual_subject_vuid="v1")) + "\n")
        f.write("this is not valid json\n")
        f.write(json.dumps(make_record(virtual_subject_vuid="v2")) + "\n")
        f.close()

        rows = list(stream_jsonl(f.name))
        os.unlink(f.name)

        assert len(rows) == 2

    def test_sanitizes_backstory_text(self):
        records = [
            make_record(
                virtual_subject_vuid="v1",
                virtual_subject_backstory="hello\u0000world",
            )
        ]
        path = self._write_jsonl(records)
        rows = list(stream_jsonl(path))
        os.unlink(path)

        assert rows[0]["backstory_text"] == "helloworld"
