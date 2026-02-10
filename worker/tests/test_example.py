"""Example test to verify pytest is working"""


def test_example():
    """Example test to verify pytest is working"""
    assert 1 + 1 == 2


def test_string_operations():
    """Test basic string operations"""
    greeting = "Hello, World!"
    assert "Hello" in greeting
    assert len(greeting) == 13


def test_list_operations():
    """Test basic list operations"""
    items = [1, 2, 3]
    assert len(items) == 3
    assert 2 in items
