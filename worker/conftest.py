import pytest
from unittest.mock import MagicMock


@pytest.fixture
def mock_supabase():
    """Mock Supabase client"""
    client = MagicMock()
    client.table.return_value.select.return_value.execute.return_value = MagicMock(data=[])
    return client


@pytest.fixture
def mock_rabbitmq():
    """Mock RabbitMQ connection"""
    connection = MagicMock()
    channel = MagicMock()
    connection.channel.return_value = channel
    return connection, channel
