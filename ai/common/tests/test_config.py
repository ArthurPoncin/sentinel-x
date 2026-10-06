import pytest

from sentinel_common.config import (
    ConfigError,
    env_bool,
    env_float,
    env_int,
    env_required,
    env_secret,
    env_str,
    env_url,
)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for name in ("SETTING", "API_URL", "TOKEN"):
        monkeypatch.delenv(name, raising=False)


def test_reads_a_set_variable_and_falls_back_on_the_default(monkeypatch):
    assert env_str("SETTING") is None
    assert env_str("SETTING", "fallback") == "fallback"
    monkeypatch.setenv("SETTING", " value ")
    assert env_str("SETTING", "fallback") == "value"
    assert env_required("SETTING") == "value"


@pytest.mark.parametrize("value", [None, "", "   "])
def test_a_missing_or_empty_required_variable_is_named(monkeypatch, value):
    if value is not None:
        monkeypatch.setenv("SETTING", value)
    with pytest.raises(ConfigError, match="SETTING is required"):
        env_required("SETTING")


def test_numbers_are_converted_and_bounded(monkeypatch):
    assert env_int("SETTING", 5) == 5
    monkeypatch.setenv("SETTING", "12")
    assert env_int("SETTING", 5, min=1, max=20) == 12
    assert env_float("SETTING", 0.5) == 12.0
    monkeypatch.setenv("SETTING", "0.25")
    assert env_float("SETTING", 0.5, min=0, max=1) == 0.25


@pytest.mark.parametrize(
    ("read", "value"),
    [
        (lambda: env_int("SETTING", 5), "five"),
        (lambda: env_int("SETTING", 5), "1.5"),
        (lambda: env_int("SETTING", 5, min=1), "0"),
        (lambda: env_int("SETTING", 5, max=10), "11"),
        (lambda: env_float("SETTING", 0.5), "nan"),
        (lambda: env_float("SETTING", 0.5), "inf"),
        (lambda: env_float("SETTING", 0.5, min=0, max=1), "1.5"),
        (lambda: env_bool("SETTING", False), "maybe"),
        (lambda: env_url("SETTING"), "api:8080/api/v1/alerts"),
        (lambda: env_url("SETTING"), "ftp://api/api/v1/alerts"),
    ],
)
def test_an_invalid_value_is_named_with_the_variable(monkeypatch, read, value):
    monkeypatch.setenv("SETTING", value)
    with pytest.raises(ConfigError, match="^SETTING: "):
        read()


@pytest.mark.parametrize(
    ("value", "expected"), [("true", True), ("ON", True), ("1", True), ("False", False), ("off", False)]
)
def test_booleans(monkeypatch, value, expected):
    assert env_bool("SETTING", expected) is expected
    monkeypatch.setenv("SETTING", value)
    assert env_bool("SETTING", not expected) is expected


def test_an_url_is_required_unless_it_has_a_default(monkeypatch):
    assert env_url("API_URL", "http://api:8080/api/v1/alerts") == "http://api:8080/api/v1/alerts"
    with pytest.raises(ConfigError, match="API_URL is required"):
        env_url("API_URL")
    monkeypatch.setenv("API_URL", "https://api/api/v1/alerts")
    assert env_url("API_URL") == "https://api/api/v1/alerts"


def test_a_secret_is_checked_without_ever_echoing_it(monkeypatch):
    with pytest.raises(ConfigError, match="TOKEN is required"):
        env_secret("TOKEN")
    for weak in ("short-token", "a token with spaces that is long enough to pass"):
        monkeypatch.setenv("TOKEN", weak)
        with pytest.raises(ConfigError, match="^TOKEN: ") as refused:
            env_secret("TOKEN")
        assert weak not in str(refused.value)
    monkeypatch.setenv("TOKEN", "0123456789abcdef0123456789abcdef")
    assert env_secret("TOKEN") == "0123456789abcdef0123456789abcdef"
