"""Tests for build_demographic_prompt in src.prompt."""
from src.prompt import build_demographic_prompt


class TestBuildDemographicPrompt:

    def test_empty(self):
        assert build_demographic_prompt({}) == "You are a person."

    def test_none_value_skipped(self):
        assert build_demographic_prompt({"c_age": None, "c_gender": ["Female"]}) == (
            "You are a person with these characteristics: Gender: Female."
        )

    def test_empty_list_skipped(self):
        assert build_demographic_prompt({"c_gender": [], "c_age": ["25-34"]}) == (
            "You are a person with these characteristics: Age: 25-34."
        )

    # ── Single values ─────────────────────────────────────────────────────────

    def test_single_value(self):
        assert build_demographic_prompt({"c_age": ["25-34"]}) == (
            "You are a person with these characteristics: Age: 25-34."
        )

    def test_multiple_keys_sorted(self):
        # sorted alphabetically: c_age before c_gender
        assert build_demographic_prompt({"c_gender": ["Male"], "c_age": ["35-44"]}) == (
            "You are a person with these characteristics: Age: 35-44, Gender: Male."
        )

    def test_label_derives_from_key(self):
        result = build_demographic_prompt({"c_annual_income": ["$50,000"]})
        assert "Annual Income: $50,000" in result

    def test_custom_key_works(self):
        # User-defined key — no hardcoded handling needed
        result = build_demographic_prompt({"c_my_custom_demo": ["SomeValue"]})
        assert "My Custom Demo: SomeValue" in result

    # ── Multi-value (group framing) ────────────────────────────────────────────

    def test_multi_value_triggers_group_framing(self):
        result = build_demographic_prompt({"c_gender": ["Male", "Female"]})
        assert result == (
            "You are one person from a group with these characteristics: "
            "Gender: Male or Female. "
            "Answer as if you are one specific person from this group."
        )

    def test_mixed_single_and_multi(self):
        result = build_demographic_prompt({"c_age": ["35-44"], "c_gender": ["Male", "Female"]})
        assert "one person from a group" in result
        assert "Age: 35-44" in result
        assert "Gender: Male or Female" in result

    # ── Min/max dict ──────────────────────────────────────────────────────────

    def test_min_max(self):
        assert build_demographic_prompt({"c_age": {"min": 25, "max": 34}}) == (
            "You are a person with these characteristics: Age: 25-34."
        )

    def test_min_only(self):
        assert build_demographic_prompt({"c_age": {"min": 65}}) == (
            "You are a person with these characteristics: Age: 65+."
        )

    def test_max_only(self):
        assert build_demographic_prompt({"c_age": {"max": 25}}) == (
            "You are a person with these characteristics: Age: under 25."
        )
