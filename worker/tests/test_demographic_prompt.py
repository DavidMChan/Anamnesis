"""
Tests for build_demographic_prompt in src.prompt.
Mirrors frontend/tests/demographicPrompt.test.ts for cross-language consistency.
"""
import pytest
from src.prompt import build_demographic_prompt


class TestBuildDemographicPrompt:
    """Tests for build_demographic_prompt function."""

    def test_empty_filters_returns_person(self):
        assert build_demographic_prompt({}) == "You are a person."

    def test_age_range_min_max(self):
        assert build_demographic_prompt({"c_age": {"min": 29, "max": 30}}) == (
            "You are a 29-30 year old."
        )

    def test_single_gender_value(self):
        assert build_demographic_prompt({"c_gender": ["female"]}) == "You are a female."

    def test_age_and_gender_together(self):
        result = build_demographic_prompt(
            {"c_age": {"min": 29, "max": 30}, "c_gender": ["female"]}
        )
        assert result == "You are a 29-30 year old female."

    def test_age_min_only(self):
        assert build_demographic_prompt({"c_age": {"min": 25}}) == "You are a 25+ year old."

    def test_multiple_gender_values_joined_with_or(self):
        assert build_demographic_prompt({"c_gender": ["male", "female"]}) == (
            "You are a male or female."
        )

    def test_c_prefix_stripped(self):
        result = build_demographic_prompt({"c_education": ["college"]})
        assert result == "You are a college."

    def test_age_key_detected_by_age_substring(self):
        result = build_demographic_prompt({"c_age_group": {"min": 18, "max": 24}})
        assert "year old" in result

    def test_unknown_arbitrary_key_no_crash(self):
        result = build_demographic_prompt({"c_income": ["high"]})
        assert result == "You are a high."

    def test_age_max_only(self):
        assert build_demographic_prompt({"c_age": {"max": 65}}) == "You are a under 65 year old."

    def test_non_age_range_min_max(self):
        result = build_demographic_prompt({"c_income": {"min": 50000, "max": 100000}})
        assert result == "You are a 50000-100000 income."

    def test_non_age_min_only(self):
        result = build_demographic_prompt({"c_income": {"min": 50000}})
        assert result == "You are a 50000+ income."

    def test_sorted_key_order(self):
        # c_age < c_gender alphabetically — age descriptor first
        result = build_demographic_prompt({"c_gender": ["male"], "c_age": {"min": 30, "max": 40}})
        age_pos = result.find("30-40")
        gender_pos = result.find("male")
        assert age_pos < gender_pos

    def test_none_value_skipped(self):
        result = build_demographic_prompt({"c_age": None, "c_gender": ["female"]})
        assert result == "You are a female."

    def test_empty_list_skipped(self):
        result = build_demographic_prompt({"c_gender": [], "c_age": {"min": 25}})
        assert result == "You are a 25+ year old."
