"""Pairing codes, guest tokens and their hashes.

No Home Assistant imports: this module is tested on its own.
Only SHA-256 hashes of codes and tokens are ever stored.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from .const import PAIR_ALPHABET, PAIR_CODE_LENGTH

_ALPHABET_SET = frozenset(PAIR_ALPHABET)


def new_pair_code() -> str:
    """Random pairing code, 12 symbols without look-alike characters."""
    return "".join(secrets.choice(PAIR_ALPHABET) for _ in range(PAIR_CODE_LENGTH))


def format_pair_code(code: str) -> str:
    """XXXX-XXXX-XXXX for display and the manual fallback."""
    return "-".join(code[i : i + 4] for i in range(0, len(code), 4))


def normalize_pair_code(raw: object) -> str | None:
    """Uppercase, drop dashes and spaces; None unless it is a well-formed code."""
    if not isinstance(raw, str) or len(raw) > 64:
        return None
    code = raw.upper().replace("-", "").replace(" ", "")
    if len(code) != PAIR_CODE_LENGTH or not set(code) <= _ALPHABET_SET:
        return None
    return code


def new_token() -> str:
    """Guest token handed to the device once, at pairing."""
    return secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    """SHA-256 hex of a code or token."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def hashes_equal(a: str, b: str) -> bool:
    """Constant-time comparison of two hex digests."""
    return hmac.compare_digest(a.encode("ascii"), b.encode("ascii"))
