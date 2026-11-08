"""Secret redaction for logs and tests (pure; no Home Assistant imports)."""

from __future__ import annotations

import logging
from typing import Any

# keys whose values are secrets, wherever they appear in the vault
SECRET_KEYS = frozenset(
    {
        "access_token",
        "refresh_token",
        "verifier",
        "api_key",
        "password",
        "username",
    }
)
_MIN_SECRET_LEN = 6


def collect_secrets(data: Any) -> set[str]:
    """Every secret string in a vault structure (for redaction and tests)."""
    found: set[str] = set()
    if isinstance(data, dict):
        for key, value in data.items():
            if (
                key in SECRET_KEYS
                and isinstance(value, str)
                and len(value) >= _MIN_SECRET_LEN
            ):
                found.add(value)
            elif key == "pending" and isinstance(value, dict):
                found.update(
                    k for k in value if isinstance(k, str) and len(k) >= _MIN_SECRET_LEN
                )
                found |= collect_secrets(value)
            else:
                found |= collect_secrets(value)
    elif isinstance(data, list):
        for item in data:
            found |= collect_secrets(item)
    return found


class SecretRedactor(logging.Filter):
    """Replaces any current secret in a log record by ***."""

    def __init__(self, source: Any) -> None:
        super().__init__()
        self._source = source

    def filter(self, record: logging.LogRecord) -> bool:
        secrets = collect_secrets(
            self._source() if callable(self._source) else self._source
        )
        if not secrets:
            return True
        try:
            text = record.getMessage()
        except Exception:  # noqa: BLE001 - a broken record is not ours to fix
            return True
        if any(s in text for s in secrets):
            for s in secrets:
                text = text.replace(s, "***")
            record.msg = text
            record.args = None
        if record.exc_text and any(s in record.exc_text for s in secrets):
            record.exc_text = "***"
        return True
