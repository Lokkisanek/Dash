"""Guest passes, profiles, pairing codes and the audit log as plain data.

No Home Assistant imports; `now` is passed in so expiry is testable. The HA
storage wrapper is guest_store.py. Only SHA-256 hashes of codes and tokens are
kept (docs/GUEST_PASSES.md, "Data model").
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any
import uuid

from .const import (
    AUDIT_MAX_ENTRIES,
    GUEST_STORAGE_VERSION,
    LAST_SEEN_INTERVAL_SECONDS,
    PAIR_CODE_TTL_SECONDS,
    PASS_KINDS,
    PASS_LABEL_MAX,
    PASS_MAX_SOCKETS,
)
from .guest_codes import (
    format_pair_code,
    hash_secret,
    hashes_equal,
    new_pair_code,
    new_token,
    normalize_pair_code,
)
from .guest_policy import ProfileError, normalize_profile

STATUS_ACTIVE = "active"
STATUS_PENDING = "pending"
STATUS_EXPIRED = "expired"
STATUS_REVOKED = "revoked"

_AUDIT_KEYS = ("pass_id", "profile_id", "entity_id", "service", "reason", "ip")


class GuestError(ValueError):
    """Admin-side error with a machine-readable code."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def iso(dt: datetime) -> str:
    """UTC ISO 8601 with seconds precision."""
    return dt.astimezone(UTC).replace(microsecond=0).isoformat()


def parse_time(value: Any) -> datetime | None:
    """Parse an ISO time; naive times are taken as UTC. None if invalid."""
    if not isinstance(value, str) or not value or len(value) > 40:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _clean_device_name(value: Any) -> str | None:
    """Short printable device name sent by the guest app, or None."""
    if not isinstance(value, str):
        return None
    text = "".join(ch for ch in value if ch.isprintable()).strip()[:60]
    return text or None


def empty_data() -> dict[str, Any]:
    """Fresh storage content."""
    return {"profiles": {}, "passes": {}, "codes": {}, "audit": []}


def migrate(old_version: int, data: Any) -> dict[str, Any]:
    """Bring stored data to GUEST_STORAGE_VERSION. Unknown shapes start empty."""
    if not isinstance(data, dict):
        return empty_data()
    out = empty_data()
    for key in out:
        value = data.get(key)
        if isinstance(value, type(out[key])):
            out[key] = value
    # Version 1 is the first version; future migrations go here.
    del old_version
    return out


class GuestData:
    """All guest-pass state. Mutating methods return what the caller must act on."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        self.data = migrate(GUEST_STORAGE_VERSION, data) if data else empty_data()
        self._token_index: dict[str, str] = {}
        self._reindex()

    # ─── internals ───────────────────────────────────────────────────────────

    def _reindex(self) -> None:
        self._token_index = {
            p["token_hash"]: pid
            for pid, p in self.data["passes"].items()
            if isinstance(p, dict) and isinstance(p.get("token_hash"), str)
        }

    def audit(self, now: datetime, event: str, **fields: Any) -> None:
        """Append to the capped audit ring. Only ids, codes of reasons and IPs."""
        entry = {"ts": iso(now), "event": event}
        for key in _AUDIT_KEYS:
            if fields.get(key) is not None:
                entry[key] = str(fields[key])[:200]
        log = self.data["audit"]
        log.append(entry)
        if len(log) > AUDIT_MAX_ENTRIES:
            del log[: len(log) - AUDIT_MAX_ENTRIES]

    def _purge_codes(self, now: datetime) -> None:
        codes = self.data["codes"]
        for code_hash in [
            h
            for h, c in codes.items()
            if not isinstance(c, dict)
            or c.get("used_at")
            or (parse_time(c.get("expires_at")) or now) <= now
        ]:
            del codes[code_hash]

    def _new_code(self, pass_id: str, now: datetime) -> dict[str, Any]:
        """Issue a pairing code for a pass, invalidating its previous ones."""
        codes = self.data["codes"]
        for code_hash in [h for h, c in codes.items() if c.get("pass_id") == pass_id]:
            del codes[code_hash]
        code = new_pair_code()
        expires = now + timedelta(seconds=PAIR_CODE_TTL_SECONDS)
        codes[hash_secret(code)] = {
            "pass_id": pass_id,
            "expires_at": iso(expires),
            "used_at": None,
        }
        self.audit(now, "pair_code_created", pass_id=pass_id)
        return {"code": format_pair_code(code), "expires_at": iso(expires)}

    # ─── status ──────────────────────────────────────────────────────────────

    @staticmethod
    def status(pass_: dict[str, Any], now: datetime) -> str:
        """revoked → expired → pending → active."""
        if pass_.get("revoked_at"):
            return STATUS_REVOKED
        until = parse_time(pass_.get("valid_until"))
        if pass_.get("valid_until") and until is None:
            return STATUS_EXPIRED  # corrupt value: fail closed
        if until is not None and now >= until:
            return STATUS_EXPIRED
        start = parse_time(pass_.get("valid_from"))
        if pass_.get("valid_from") and start is None:
            return STATUS_PENDING
        if start is not None and now < start:
            return STATUS_PENDING
        return STATUS_ACTIVE

    def public_pass(self, pass_: dict[str, Any], now: datetime) -> dict[str, Any]:
        """A pass as shown to the admin (no hashes)."""
        profile = self.data["profiles"].get(pass_.get("profile_id"), {})
        has_code = any(
            c.get("pass_id") == pass_["id"] and not c.get("used_at")
            for c in self.data["codes"].values()
        )
        return {
            "id": pass_["id"],
            "profile_id": pass_.get("profile_id"),
            "profile_name": profile.get("name", ""),
            "label": pass_.get("label", ""),
            "kind": pass_.get("kind"),
            "valid_from": pass_.get("valid_from"),
            "valid_until": pass_.get("valid_until"),
            "revoked_at": pass_.get("revoked_at"),
            "created_at": pass_.get("created_at"),
            "paired_at": pass_.get("paired_at"),
            "last_seen": pass_.get("last_seen"),
            "device_name": pass_.get("device_name"),
            "max_sockets": pass_.get("max_sockets", PASS_MAX_SOCKETS),
            "status": self.status(pass_, now),
            "paired": bool(pass_.get("token_hash")),
            "has_code": has_code,
        }

    def guest_pass(self, pass_: dict[str, Any]) -> dict[str, Any]:
        """A pass as shown to the guest device."""
        return {
            "id": pass_["id"],
            "label": pass_.get("label", ""),
            "kind": pass_.get("kind"),
            "valid_from": pass_.get("valid_from"),
            "valid_until": pass_.get("valid_until"),
        }

    # ─── profiles ────────────────────────────────────────────────────────────

    def profile_save(
        self,
        raw: Any,
        now: datetime,
        device_classes_of: Callable[[str], Iterable[str | None]] = lambda _e: (),
    ) -> dict[str, Any]:
        """Create or update a profile. Raises GuestError."""
        existing = None
        if isinstance(raw, dict) and raw.get("id"):
            existing = self.data["profiles"].get(raw["id"])
            if existing is None:
                raise GuestError("not_found", "profile")
        try:
            profile = normalize_profile(
                raw,
                now=iso(now),
                existing=existing,
                device_classes_of=device_classes_of,
            )
        except ProfileError as err:
            raise GuestError(err.code, err.detail) from err
        self.data["profiles"][profile["id"]] = profile
        self.audit(now, "profile_saved", profile_id=profile["id"])
        return deepcopy(profile)

    def profile_delete(self, profile_id: str, now: datetime) -> None:
        """Delete a profile that no pass uses."""
        if profile_id not in self.data["profiles"]:
            raise GuestError("not_found", "profile")
        if any(p.get("profile_id") == profile_id for p in self.data["passes"].values()):
            raise GuestError("profile_in_use")
        del self.data["profiles"][profile_id]
        self.audit(now, "profile_deleted", profile_id=profile_id)

    def passes_of_profile(self, profile_id: str) -> list[str]:
        """Ids of the passes that use a profile."""
        return [
            pid
            for pid, p in self.data["passes"].items()
            if p.get("profile_id") == profile_id
        ]

    # ─── passes ──────────────────────────────────────────────────────────────

    def _validity(
        self, kind: str, valid_from: Any, valid_until: Any, now: datetime
    ) -> tuple[str, str | None]:
        start = parse_time(valid_from) if valid_from else now
        if start is None:
            raise GuestError("invalid_valid_from")
        until = None
        if valid_until:
            until = parse_time(valid_until)
            if until is None:
                raise GuestError("invalid_valid_until")
            if until <= start:
                raise GuestError("invalid_range")
        elif kind == "phone":
            # Phones always expire; only wall tablets may run without an end.
            raise GuestError("valid_until_required")
        return iso(start), iso(until) if until else None

    def pass_create(
        self,
        *,
        profile_id: str,
        label: Any,
        kind: Any,
        valid_from: Any,
        valid_until: Any,
        now: datetime,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """New pass plus its first pairing code (plain, shown once)."""
        if profile_id not in self.data["profiles"]:
            raise GuestError("not_found", "profile")
        if kind not in PASS_KINDS:
            raise GuestError("invalid_kind")
        if (
            not isinstance(label, str)
            or not label.strip()
            or len(label.strip()) > PASS_LABEL_MAX
        ):
            raise GuestError("invalid_label")
        start, until = self._validity(kind, valid_from, valid_until, now)
        pass_id = uuid.uuid4().hex
        pass_ = {
            "id": pass_id,
            "profile_id": profile_id,
            "label": label.strip(),
            "kind": kind,
            "valid_from": start,
            "valid_until": until,
            "revoked_at": None,
            "token_hash": None,
            "created_at": iso(now),
            "paired_at": None,
            "last_seen": None,
            "max_sockets": PASS_MAX_SOCKETS,
        }
        self.data["passes"][pass_id] = pass_
        self.audit(now, "pass_created", pass_id=pass_id, profile_id=profile_id)
        code = self._new_code(pass_id, now)
        return self.public_pass(pass_, now), code

    def _get_pass(self, pass_id: str) -> dict[str, Any]:
        pass_ = self.data["passes"].get(pass_id)
        if pass_ is None:
            raise GuestError("not_found", "pass")
        return pass_

    def pass_new_code(self, pass_id: str, now: datetime) -> dict[str, Any]:
        """Replace the pairing code of a pass that can still be used."""
        pass_ = self._get_pass(pass_id)
        if self.status(pass_, now) in (STATUS_REVOKED, STATUS_EXPIRED):
            raise GuestError("pass_inactive")
        self._purge_codes(now)
        return self._new_code(pass_id, now)

    def pass_revoke(self, pass_id: str, now: datetime) -> dict[str, Any]:
        """Revoke a pass and drop its token and codes."""
        pass_ = self._get_pass(pass_id)
        if not pass_.get("revoked_at"):
            pass_["revoked_at"] = iso(now)
        self._forget_token(pass_)
        self._drop_codes(pass_id)
        self.audit(now, "pass_revoked", pass_id=pass_id)
        return self.public_pass(pass_, now)

    def pass_extend(
        self, pass_id: str, valid_until: Any, now: datetime
    ) -> dict[str, Any]:
        """Move the end of a pass (None ends 'never' for tablets)."""
        pass_ = self._get_pass(pass_id)
        if pass_.get("revoked_at"):
            raise GuestError("pass_inactive")
        _, until = self._validity(
            pass_["kind"], pass_.get("valid_from"), valid_until, now
        )
        if until is not None and parse_time(until) <= now:
            raise GuestError("invalid_range")
        pass_["valid_until"] = until
        self.audit(now, "pass_extended", pass_id=pass_id)
        return self.public_pass(pass_, now)

    def pass_delete(self, pass_id: str, now: datetime) -> None:
        """Remove a pass entirely."""
        pass_ = self._get_pass(pass_id)
        self._forget_token(pass_)
        self._drop_codes(pass_id)
        del self.data["passes"][pass_id]
        self.audit(now, "pass_deleted", pass_id=pass_id)

    def _forget_token(self, pass_: dict[str, Any]) -> None:
        token_hash = pass_.get("token_hash")
        if token_hash:
            self._token_index.pop(token_hash, None)
        pass_["token_hash"] = None

    def _drop_codes(self, pass_id: str) -> None:
        codes = self.data["codes"]
        for code_hash in [h for h, c in codes.items() if c.get("pass_id") == pass_id]:
            del codes[code_hash]

    def list_passes(self, now: datetime) -> list[dict[str, Any]]:
        """All passes for the admin, newest first."""
        passes = [self.public_pass(p, now) for p in self.data["passes"].values()]
        return sorted(passes, key=lambda p: p.get("created_at") or "", reverse=True)

    # ─── guest side ──────────────────────────────────────────────────────────

    def pair(
        self,
        raw_code: Any,
        now: datetime,
        ip: str | None = None,
        device_name: Any = None,
    ) -> tuple[dict, str] | None:
        """Consume a pairing code. Returns (pass, token) or None (generic failure)."""
        self._purge_codes(now)
        code = normalize_pair_code(raw_code)
        record = None
        if code is not None:
            presented = hash_secret(code)
            for stored_hash, candidate in self.data["codes"].items():
                if hashes_equal(stored_hash, presented):
                    record = candidate
                    break
        pass_ = self.data["passes"].get(record["pass_id"]) if record else None
        if (
            record is None
            or pass_ is None
            or self.status(pass_, now) in (STATUS_REVOKED, STATUS_EXPIRED)
        ):
            self.audit(now, "pair_failed", ip=ip, pass_id=record and record["pass_id"])
            return None

        record["used_at"] = iso(now)
        self._purge_codes(now)
        token = new_token()
        self._forget_token(pass_)
        pass_["token_hash"] = hash_secret(token)
        pass_["paired_at"] = iso(now)
        pass_["last_seen"] = iso(now)
        pass_["device_name"] = _clean_device_name(device_name)
        self._token_index[pass_["token_hash"]] = pass_["id"]
        self.audit(now, "pair_ok", pass_id=pass_["id"], ip=ip)
        return pass_, token

    def find_by_token(self, token: Any) -> dict[str, Any] | None:
        """The pass a guest token belongs to (any status), or None."""
        if not isinstance(token, str) or not 20 <= len(token) <= 200:
            return None
        presented = hash_secret(token)
        pass_id = self._token_index.get(presented)
        pass_ = self.data["passes"].get(pass_id) if pass_id else None
        if pass_ is None or not hashes_equal(pass_.get("token_hash") or "", presented):
            return None
        return pass_

    def profile_of(self, pass_: dict[str, Any]) -> dict[str, Any] | None:
        """The profile a pass uses."""
        return self.data["profiles"].get(pass_.get("profile_id"))

    def touch(self, pass_: dict[str, Any], now: datetime) -> bool:
        """Update last_seen at most every 5 minutes. True if it changed."""
        last = parse_time(pass_.get("last_seen"))
        if (
            last is not None
            and (now - last).total_seconds() < LAST_SEEN_INTERVAL_SECONDS
        ):
            return False
        pass_["last_seen"] = iso(now)
        return True
