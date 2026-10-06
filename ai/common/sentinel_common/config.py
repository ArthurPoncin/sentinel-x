"""A service's configuration, read from its environment (its `.env` under Docker Compose).

Read once at startup: a missing or invalid variable raises a ConfigError that names it, so the service
stops right away instead of failing on its first Alert. An empty variable counts as unset, as `X=` in a
`.env` file usually means "not filled in".
"""

import math
import os
from urllib.parse import urlsplit


class ConfigError(Exception):
    """A variable of the environment is missing or invalid. The message names it."""


def env_str(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or default


def env_required(name: str) -> str:
    value = env_str(name)
    if value is None:
        raise ConfigError(f"{name} is required")
    return value


def _number(name: str, default, convert, label: str, min, max):
    raw = env_str(name)
    if raw is None:
        return default
    try:
        value = convert(raw)
        # float() also reads "nan" and "inf": neither is a setting.
        if not math.isfinite(value):
            raise ValueError
    except ValueError:
        raise ConfigError(f"{name}: expected {label}, got {raw!r}") from None
    if (min is not None and value < min) or (max is not None and value > max):
        bounds = ([f">= {min}"] if min is not None else []) + ([f"<= {max}"] if max is not None else [])
        raise ConfigError(f"{name}: expected {label} {' and '.join(bounds)}, got {raw!r}")
    return value


def env_int(name: str, default: int, *, min: int | None = None, max: int | None = None) -> int:
    return _number(name, default, int, "an integer", min, max)


def env_float(name: str, default: float, *, min: float | None = None, max: float | None = None) -> float:
    return _number(name, default, float, "a number", min, max)


def env_bool(name: str, default: bool) -> bool:
    raw = env_str(name)
    if raw is None:
        return default
    if raw.lower() in ("true", "on", "1"):
        return True
    if raw.lower() in ("false", "off", "0"):
        return False
    raise ConfigError(f"{name}: expected true or false, got {raw!r}")


def env_url(name: str, default: str | None = None) -> str:
    """An http(s) URL, such as the api's POST /api/v1/alerts."""
    url = env_str(name, default)
    if url is None:
        raise ConfigError(f"{name} is required")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ConfigError(f"{name}: expected an http:// or https:// URL, got {url!r}")
    return url


def env_secret(name: str, min_length: int = 32) -> str:
    """A token or password. Its value never appears in an error: they end up in logs."""
    value = env_required(name)
    if len(value) < min_length:
        raise ConfigError(f"{name}: too short, expected at least {min_length} characters")
    # It travels in a header: a space or a line break there would cut it or forge another header.
    if any(char.isspace() for char in value):
        raise ConfigError(f"{name}: must not contain spaces")
    return value
