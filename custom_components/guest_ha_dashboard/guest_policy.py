"""Guest pass policy: what a guest may see and call.

This is the security boundary of guest passes (docs/GUEST_PASSES.md). Every
function here is pure: no Home Assistant imports, no I/O, never raises on bad
input. Anything unknown is denied.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from copy import deepcopy
from dataclasses import dataclass, field
import math
import re
from typing import Any
import uuid

from .const import (
    GUEST_DENIED_COVER_CLASSES,
    GUEST_DENIED_DOMAINS,
    GUEST_READ_ONLY_DOMAINS,
    GUEST_REQUIRED_LIMITS,
    GUEST_SERVICES,
    PROFILE_MAX_ENTITIES,
    PROFILE_NAME_MAX,
)
from .tile_registry import TILE_TYPES

# Tile types without a Home Assistant entity (section dividers).
LAYOUT_TILE_TYPES = frozenset(
    name for name, spec in TILE_TYPES.items() if not spec["needsEntity"]
)

ENTITY_ID_RE = re.compile(r"^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$")

# Reason codes (also used in the audit log and sent to the client)
BAD_REQUEST = "bad_request"
ENTITY_NOT_ALLOWED = "entity_not_allowed"
ENTITY_READ_ONLY = "entity_read_only"
DOMAIN_DENIED = "domain_denied"
DOMAIN_UNSUPPORTED = "domain_unsupported"
SERVICE_NOT_ALLOWED = "service_not_allowed"
FIELD_NOT_ALLOWED = "field_not_allowed"
INVALID_VALUE = "invalid_value"
OUT_OF_RANGE = "out_of_range"
DEVICE_CLASS_DENIED = "device_class_denied"

CALL_KEYS = frozenset({"id", "type", "domain", "service", "entity_id", "data"})

# Attributes that can carry HA access tokens (media_player artwork, cameras, …)
_DROP_ATTRIBUTES = frozenset(
    {"entity_picture", "entity_picture_local", "access_token", "access_tokens"}
)
_MAX_ATTR_DEPTH = 6
_DROP = object()


@dataclass(frozen=True)
class CallDecision:
    """Outcome of validate_call. `data` is the cleaned service data."""

    ok: bool
    reason: str | None = None
    domain: str = ""
    service: str = ""
    entity_id: str = ""
    data: dict[str, Any] = field(default_factory=dict)


class ProfileError(ValueError):
    """Invalid profile submitted by the admin. `code` is machine-readable."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


# ─── Entities and domains ────────────────────────────────────────────────────


def entity_domain(entity_id: object) -> str | None:
    """Domain of a well-formed entity id, else None (lists, 'all', garbage)."""
    if not isinstance(entity_id, str) or len(entity_id) > 255:
        return None
    if not ENTITY_ID_RE.match(entity_id):
        return None
    return entity_id.split(".", 1)[0]


def domain_access(domain: str) -> str:
    """'control', 'read_only' or 'denied' for a domain."""
    if domain in GUEST_DENIED_DOMAINS:
        return "denied"
    if domain in GUEST_READ_ONLY_DOMAINS:
        return "read_only"
    if domain in GUEST_SERVICES:
        return "control"
    return "denied"


def entity_selectability(
    entity_id: str, device_classes: Iterable[str | None] = ()
) -> dict[str, Any]:
    """Can the owner put this entity into a profile, and why not.

    Returns {selectable, reason, read_only, services, fields}. `services` are the
    default "domain.service" names offered for the entity.
    """
    domain = entity_domain(entity_id)
    if domain is None:
        return _unselectable(BAD_REQUEST)
    if domain in GUEST_DENIED_DOMAINS:
        return _unselectable(DOMAIN_DENIED)
    access = domain_access(domain)
    if access == "denied":
        return _unselectable(DOMAIN_UNSUPPORTED)
    if domain == "cover" and set(device_classes) & set(GUEST_DENIED_COVER_CLASSES):
        return _unselectable(DEVICE_CLASS_DENIED)
    if access == "read_only":
        return {
            "selectable": True,
            "reason": None,
            "read_only": True,
            "services": [],
            "fields": {},
        }
    services = GUEST_SERVICES[domain]
    return {
        "selectable": True,
        "reason": None,
        "read_only": False,
        "services": [f"{domain}.{name}" for name in services],
        "fields": {
            f"{domain}.{name}": deepcopy(spec)
            for name, spec in services.items()
            if spec
        },
    }


def _unselectable(reason: str) -> dict[str, Any]:
    return {
        "selectable": False,
        "reason": reason,
        "read_only": True,
        "services": [],
        "fields": {},
    }


# ─── Values ──────────────────────────────────────────────────────────────────


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _in_range(value: float, spec: dict, limit: dict | None) -> bool:
    low = spec.get("min")
    high = spec.get("max")
    if limit:
        if _is_number(limit.get("min")):
            low = limit["min"] if low is None else max(low, limit["min"])
        if _is_number(limit.get("max")):
            high = limit["max"] if high is None else min(high, limit["max"])
    if low is not None and value < low:
        return False
    return not (high is not None and value > high)


def check_value(
    spec: dict, value: Any, limit: dict | None
) -> tuple[bool, str | None, Any]:
    """Type + range check of one service data value. Returns (ok, reason, clean)."""
    kind = spec.get("type")
    if kind == "int":
        if isinstance(value, float) and _is_number(value) and value.is_integer():
            value = int(value)
        if not isinstance(value, int) or isinstance(value, bool):
            return False, INVALID_VALUE, None
        return (
            (True, None, value)
            if _in_range(value, spec, limit)
            else (False, OUT_OF_RANGE, None)
        )
    if kind == "number":
        if not _is_number(value):
            return False, INVALID_VALUE, None
        return (
            (True, None, value)
            if _in_range(value, spec, limit)
            else (False, OUT_OF_RANGE, None)
        )
    if kind == "string":
        if not isinstance(value, str) or len(value) > spec.get("max_len", 100):
            return False, INVALID_VALUE, None
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            return False, INVALID_VALUE, None
        if limit and isinstance(limit.get("enum"), list) and value not in limit["enum"]:
            return False, OUT_OF_RANGE, None
        return True, None, value
    if kind == "enum":
        if not isinstance(value, str) or value not in spec.get("enum", ()):
            return False, INVALID_VALUE, None
        if limit and isinstance(limit.get("enum"), list) and value not in limit["enum"]:
            return False, OUT_OF_RANGE, None
        return True, None, value
    if kind == "rgb":
        if not isinstance(value, (list, tuple)) or len(value) != 3:
            return False, INVALID_VALUE, None
        clean = []
        for part in value:
            if not isinstance(part, int) or isinstance(part, bool):
                return False, INVALID_VALUE, None
            if not _in_range(part, spec, limit):
                return False, OUT_OF_RANGE, None
            clean.append(part)
        return True, None, clean
    return False, INVALID_VALUE, None


def effective_limit(
    profile_entity: dict, call_key: str, field_name: str
) -> dict | None:
    """Profile limit for a field, falling back to the required default."""
    limits = profile_entity.get("limits")
    if isinstance(limits, dict):
        per_call = limits.get(call_key)
        if isinstance(per_call, dict) and isinstance(per_call.get(field_name), dict):
            return per_call[field_name]
    required = GUEST_REQUIRED_LIMITS.get(call_key, {})
    return required.get(field_name)


# ─── Service calls ───────────────────────────────────────────────────────────


def validate_call(
    profile: Any, msg: Any, device_classes: Iterable[str | None] = ()
) -> CallDecision:
    """Decide whether a guest may make this service call. Never raises."""
    try:
        return _validate_call(profile, msg, device_classes)
    except Exception:  # noqa: BLE001 — any surprise is a deny, never a crash
        return CallDecision(False, BAD_REQUEST)


def _validate_call(
    profile: Any, msg: Any, device_classes: Iterable[str | None]
) -> CallDecision:
    if not isinstance(msg, dict) or not isinstance(profile, dict):
        return CallDecision(False, BAD_REQUEST)
    if set(msg) - CALL_KEYS:
        return CallDecision(False, BAD_REQUEST)

    domain = msg.get("domain")
    service = msg.get("service")
    entity_id = msg.get("entity_id")
    data = msg.get("data", {})
    if data is None:
        data = {}
    if not isinstance(domain, str) or not isinstance(service, str):
        return CallDecision(False, BAD_REQUEST)
    if not isinstance(data, dict):
        return CallDecision(False, BAD_REQUEST)

    # A single, well-formed entity id. Lists, "all", area/device targets fail here.
    ent_domain = entity_domain(entity_id)
    if ent_domain is None or ent_domain != domain:
        return CallDecision(False, BAD_REQUEST, domain, service)

    base = CallDecision(False, None, domain, service, entity_id)

    if domain in GUEST_DENIED_DOMAINS or domain_access(domain) == "denied":
        return _deny(base, DOMAIN_DENIED)

    entities = profile.get("entities")
    entry = entities.get(entity_id) if isinstance(entities, dict) else None
    if not isinstance(entry, dict):
        return _deny(base, ENTITY_NOT_ALLOWED)
    if entry.get("read_only") is not False or domain in GUEST_READ_ONLY_DOMAINS:
        return _deny(base, ENTITY_READ_ONLY)

    service_spec = GUEST_SERVICES.get(domain, {}).get(service)
    call_key = f"{domain}.{service}"
    allowed = entry.get("services")
    if service_spec is None or not isinstance(allowed, list) or call_key not in allowed:
        return _deny(base, SERVICE_NOT_ALLOWED)

    if domain == "cover" and set(device_classes) & set(GUEST_DENIED_COVER_CLASSES):
        return _deny(base, DEVICE_CLASS_DENIED)

    clean: dict[str, Any] = {}
    for key, value in data.items():
        if not isinstance(key, str) or key not in service_spec:
            return _deny(base, FIELD_NOT_ALLOWED)
        ok, reason, cleaned = check_value(
            service_spec[key], value, effective_limit(entry, call_key, key)
        )
        if not ok:
            return _deny(base, reason or INVALID_VALUE)
        clean[key] = cleaned

    return CallDecision(True, None, domain, service, entity_id, clean)


def _deny(base: CallDecision, reason: str) -> CallDecision:
    return CallDecision(False, reason, base.domain, base.service, base.entity_id)


# ─── Profiles ────────────────────────────────────────────────────────────────


def normalize_profile(
    raw: Any,
    *,
    now: str,
    existing: dict | None = None,
    device_classes_of: Callable[[str], Iterable[str | None]] = lambda _eid: (),
) -> dict[str, Any]:
    """Validate a profile sent by the admin panel. Raises ProfileError."""
    if not isinstance(raw, dict):
        raise ProfileError("invalid_profile")

    name = raw.get("name")
    if (
        not isinstance(name, str)
        or not name.strip()
        or len(name.strip()) > PROFILE_NAME_MAX
    ):
        raise ProfileError("invalid_name")

    area_ids = raw.get("area_ids") or []
    if not isinstance(area_ids, list) or len(area_ids) > 50:
        raise ProfileError("invalid_area_ids")
    area_ids = [a for a in area_ids if isinstance(a, str) and 0 < len(a) <= 100]

    entities_raw = raw.get("entities") or {}
    if not isinstance(entities_raw, dict) or len(entities_raw) > PROFILE_MAX_ENTITIES:
        raise ProfileError("invalid_entities")

    entities: dict[str, Any] = {}
    for entity_id, cfg in entities_raw.items():
        info = entity_selectability(entity_id, device_classes_of(entity_id))
        if not info["selectable"]:
            raise ProfileError(info["reason"], entity_id)
        cfg = cfg if isinstance(cfg, dict) else {}
        if info["read_only"]:
            entities[entity_id] = {"services": [], "limits": {}, "read_only": True}
            continue
        offered = info["services"]
        wanted = cfg.get("services")
        services = (
            [s for s in dict.fromkeys(wanted) if s in offered]
            if isinstance(wanted, list)
            else list(offered)
        )
        entities[entity_id] = {
            "services": services,
            "limits": _normalize_limits(entity_id, cfg.get("limits"), services),
            "read_only": bool(cfg.get("read_only", False)),
        }

    profile_id = existing["id"] if existing else uuid.uuid4().hex
    return {
        "id": profile_id,
        "name": name.strip(),
        "area_ids": area_ids,
        "entities": entities,
        "show_wifi": bool(raw.get("show_wifi", True)),
        "created_at": existing.get("created_at", now) if existing else now,
        "updated_at": now,
    }


def _normalize_limits(entity_id: str, raw: Any, services: list[str]) -> dict:
    if not isinstance(raw, dict):
        return {}
    domain = entity_id.split(".", 1)[0]
    out: dict[str, Any] = {}
    for call_key, fields in raw.items():
        if call_key not in services or not isinstance(fields, dict):
            continue
        spec_fields = GUEST_SERVICES[domain].get(call_key.split(".", 1)[1], {})
        clean_fields = {}
        for field_name, limit in fields.items():
            spec = spec_fields.get(field_name)
            if spec is None or not isinstance(limit, dict):
                continue
            clean = _normalize_limit(spec, limit)
            if clean:
                clean_fields[field_name] = clean
        if clean_fields:
            out[call_key] = clean_fields
    return out


def _normalize_limit(spec: dict, limit: dict) -> dict | None:
    kind = spec.get("type")
    if kind in ("int", "number", "rgb"):
        low, high = limit.get("min"), limit.get("max")
        clean: dict[str, float] = {}
        if _is_number(low):
            clean["min"] = max(low, spec.get("min", low))
        if _is_number(high):
            clean["max"] = min(high, spec.get("max", high))
        if "min" in clean and "max" in clean and clean["min"] > clean["max"]:
            raise ProfileError("invalid_limit", f"{low} > {high}")
        return clean or None
    if kind in ("enum", "string"):
        values = limit.get("enum")
        if not isinstance(values, list):
            return None
        allowed = spec.get("enum")
        picked = [
            v
            for v in dict.fromkeys(values)
            if isinstance(v, str)
            and 0 < len(v) <= 100
            and (allowed is None or v in allowed)
        ][:50]
        return {"enum": picked}
    return None


# ─── What the guest sees ─────────────────────────────────────────────────────


def sanitize_state(state: Any) -> dict[str, Any] | None:
    """A state dict as sent to a guest: no context, no token-bearing attributes."""
    if not isinstance(state, dict) or entity_domain(state.get("entity_id")) is None:
        return None
    raw_attrs = (
        state.get("attributes") if isinstance(state.get("attributes"), dict) else {}
    )
    attrs = _clean_attrs(raw_attrs, 0)
    if not isinstance(attrs, dict):
        attrs = {}
    if raw_attrs.get("entity_picture") or raw_attrs.get("entity_picture_local"):
        # The client asks for artwork over the guest socket (media_image)
        attrs["dash_artwork"] = True
    value = state.get("state")
    if not isinstance(value, str) or _has_token(value):
        value = "unknown"
    return {
        "entity_id": state["entity_id"],
        "state": value,
        "attributes": attrs,
        "last_changed": _text(state.get("last_changed")),
        "last_updated": _text(state.get("last_updated")),
    }


def _text(value: Any) -> str:
    """ISO text for datetimes, str() for the rest, '' for None."""
    if value is None:
        return ""
    iso = getattr(value, "isoformat", None)
    return iso() if callable(iso) else str(value)


def _has_token(text: str) -> bool:
    low = text.lower()
    return "token=" in low or "access_token" in low


def _clean_attrs(value: Any, depth: int) -> Any:
    if depth > _MAX_ATTR_DEPTH:
        return _DROP
    if isinstance(value, str):
        return _DROP if _has_token(value) else value
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if not isinstance(key, str) or key in _DROP_ATTRIBUTES or _has_token(key):
                continue
            cleaned = _clean_attrs(item, depth + 1)
            if cleaned is not _DROP:
                out[key] = cleaned
        return out
    if isinstance(value, (list, tuple)):
        items = [_clean_attrs(item, depth + 1) for item in value]
        return [item for item in items if item is not _DROP]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    # datetimes, enums, …: JSON-safe text
    text = _text(value)
    return _DROP if _has_token(text) else text


def _strip_foreign_refs(item: dict, allowed: set[str]) -> dict:
    """Copy of a page/tile without fields that name entities outside the profile.

    Covers legacy fields such as temperatureEntity / humidityEntity / haAreaId
    that older stored configs may still carry.
    """
    out = {}
    for key, value in item.items():
        if key == "haAreaId":
            continue
        if isinstance(value, str) and entity_domain(value) and value not in allowed:
            continue
        out[key] = deepcopy(value)
    return out


def _is_layout_tile(device: dict) -> bool:
    """Dividers and other tiles without an entity: never an allowed/denied entity."""
    return device.get("type") in LAYOUT_TILE_TYPES


def filter_config(config: Any, profile: Any) -> dict[str, Any]:
    """The dashboard config with everything outside the profile removed."""
    config = config if isinstance(config, dict) else {}
    profile = profile if isinstance(profile, dict) else {}
    allowed = set(profile.get("entities") or {})
    show_wifi = bool(profile.get("show_wifi", True))

    pages = []
    for page in config.get("pages") or []:
        if not isinstance(page, dict):
            continue
        devices = [
            _strip_foreign_refs(d, allowed)
            for d in page.get("devices") or []
            if isinstance(d, dict) and (d.get("id") in allowed or _is_layout_tile(d))
        ]
        # A page is shown only if it still has a tile the guest may use, so the
        # names of rooms outside the profile never reach the guest via dividers.
        if any(not _is_layout_tile(d) for d in devices):
            clean_page = _strip_foreign_refs(
                {k: v for k, v in page.items() if k != "devices"}, allowed
            )
            pages.append({**clean_page, "devices": devices})
    page_ids = {p.get("id") for p in pages}

    dock = [
        deepcopy(d)
        for d in config.get("dock") or []
        if isinstance(d, dict) and d.get("pageId") in page_ids
    ]

    general = deepcopy(config.get("general") or {})
    if general.get("weatherEntity") not in allowed:
        general["weatherEntity"] = ""
    if not show_wifi:
        general["showWifi"] = False

    guest_info = (
        deepcopy(config.get("guestInfo") or {})
        if show_wifi
        else {"wifiSsid": "", "wifiPassword": "", "wifiSecurity": "nopass"}
    )

    return {
        "configVersion": config.get("configVersion"),
        "guestInfo": guest_info,
        "general": general,
        "standby": deepcopy(config.get("standby") or {}),
        "appearance": deepcopy(config.get("appearance") or {}),
        "pages": pages,
        "dock": dock,
    }
