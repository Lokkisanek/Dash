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
    GUEST_CAPABILITY_DEFAULTS,
    GUEST_DENIED_COVER_CLASSES,
    GUEST_DENIED_DOMAINS,
    GUEST_READ_ONLY_DOMAINS,
    GUEST_REQUIRED_LIMITS,
    GUEST_SERVICE_FEATURES,
    GUEST_SERVICES,
    LIGHT_COLOR_MODES,
    LIGHT_COLOR_TEMP_MODE,
    LIGHT_FEATURE_EFFECT,
    LIST_TARGET_DOMAINS,
    LIST_TARGET_MAX,
    MEDIA_BROWSE_MAX_CHILDREN,
    MEDIA_URL_SCHEMES,
    PROFILE_MAX_ENTITIES,
    PROFILE_NAME_MAX,
)
from .tile_registry import TILE_TYPES

# Tile types without a Home Assistant entity of their own: section dividers and
# the header family (header, clock, greeting, weather, wifi). They never count
# as allowed or denied entities; entity ids in their options are filtered below.
# Types with an `entities` list (light_group) are not layout: they show entities.
LAYOUT_TILE_TYPES = frozenset(
    name
    for name, spec in TILE_TYPES.items()
    if not spec["needsEntity"]
    and not any(
        f.get("type") == "entities" for f in (spec.get("fields") or {}).values()
    )
)
LIST_TILE_TYPES = frozenset(
    name
    for name, spec in TILE_TYPES.items()
    if not spec["needsEntity"]
    and any(f.get("type") == "entities" for f in (spec.get("fields") or {}).values())
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
CAPABILITY_DISABLED = "capability_disabled"
FEATURE_UNSUPPORTED = "feature_unsupported"

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
    if kind == "bool":
        return (
            (True, None, value)
            if isinstance(value, bool)
            else (False, INVALID_VALUE, None)
        )
    if kind == "entities":
        # list of entity ids of one domain (media_player.join group_members)
        if not isinstance(value, list) or not 0 < len(value) <= spec.get("max", 10):
            return False, INVALID_VALUE, None
        if any(entity_domain(v) != spec.get("domain") for v in value):
            return False, INVALID_VALUE, None
        return True, None, list(dict.fromkeys(value))
    if kind == "hs":
        # [hue 0–360, saturation 0–100] as in LIGHT_TURN_ON_SCHEMA
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            return False, INVALID_VALUE, None
        if not all(_is_number(v) for v in value):
            return False, INVALID_VALUE, None
        hue, sat = value
        if not (0 <= hue <= 360 and 0 <= sat <= 100):
            return False, OUT_OF_RANGE, None
        return True, None, [float(hue), float(sat)]
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


def profile_capabilities(profile: Any) -> dict[str, Any]:
    """Profile-wide switches with defaults (GUEST_CAPABILITY_DEFAULTS)."""
    raw = profile.get("capabilities") if isinstance(profile, dict) else None
    return normalize_capabilities(raw)


def normalize_capabilities(raw: Any) -> dict[str, Any]:
    """Known keys only, typed and clamped; unknown keys are dropped."""
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for key, default in GUEST_CAPABILITY_DEFAULTS.items():
        value = src.get(key, default)
        if isinstance(default, bool):
            out[key] = value if isinstance(value, bool) else default
        elif key == "max_transition":
            out[key] = min(60, max(0, value)) if _is_number(value) else default
        elif key == "max_volume":
            out[key] = min(1, max(0, value)) if _is_number(value) else default
        else:
            out[key] = default
    return out


def validate_call(
    profile: Any,
    msg: Any,
    device_classes: Iterable[str | None] = (),
    *,
    attributes: dict | None = None,
    device_classes_of: Callable[[str], Iterable[str | None]] | None = None,
    attributes_of: Callable[[str], dict | None] | None = None,
    issued: Callable[[str], bool] | None = None,
) -> CallDecision:
    """Decide whether a guest may make this service call. Never raises.

    `device_classes` / `attributes` describe a single target; for list targets
    (light groups) `device_classes_of` / `attributes_of` are asked per entity.
    Attributes are the entity's current state attributes; fields that depend on
    the device (colour modes, effects, preset modes, feature bits) are denied
    when they are unknown.
    """
    try:
        return _validate_call(
            profile,
            msg,
            device_classes,
            attributes,
            device_classes_of,
            attributes_of,
            issued,
        )
    except Exception:  # noqa: BLE001 — any surprise is a deny, never a crash
        return CallDecision(False, BAD_REQUEST)


def _validate_call(
    profile: Any,
    msg: Any,
    device_classes: Iterable[str | None],
    attributes: dict | None,
    device_classes_of: Callable[[str], Iterable[str | None]] | None,
    attributes_of: Callable[[str], dict | None] | None,
    issued: Callable[[str], bool] | None = None,
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

    if isinstance(entity_id, list):
        # A dash light group: every light is checked like a single call; one
        # failure rejects the whole call. "all", areas and devices never pass.
        if domain not in LIST_TARGET_DOMAINS or not entity_id:
            return CallDecision(False, BAD_REQUEST, domain, service)
        if len(entity_id) > LIST_TARGET_MAX or not all(
            isinstance(e, str) for e in entity_id
        ):
            return CallDecision(False, BAD_REQUEST, domain, service)
        ids = list(dict.fromkeys(entity_id))
        clean: dict[str, Any] | None = None
        for eid in ids:
            one = _validate_one(
                profile,
                domain,
                service,
                eid,
                data,
                device_classes_of(eid) if device_classes_of else (),
                attributes_of(eid) if attributes_of else None,
                issued,
            )
            if not one.ok:
                return one
            clean = one.data
        return CallDecision(True, None, domain, service, ids, clean or {})

    return _validate_one(
        profile,
        domain,
        service,
        entity_id,
        data,
        device_classes_of(entity_id)
        if device_classes_of and isinstance(entity_id, str)
        else device_classes,
        attributes
        if attributes is not None
        else (
            attributes_of(entity_id)
            if attributes_of and isinstance(entity_id, str)
            else None
        ),
        issued,
    )


def _validate_one(
    profile: dict,
    domain: str,
    service: str,
    entity_id: Any,
    data: dict,
    device_classes: Iterable[str | None],
    attributes: dict | None,
    issued: Callable[[str], bool] | None = None,
) -> CallDecision:
    # A single, well-formed entity id. "all", area/device targets fail here.
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

    attrs = attributes if isinstance(attributes, dict) else None
    bit = GUEST_SERVICE_FEATURES.get(call_key)
    if bit is not None and not _has_feature(attrs, bit):
        return _deny(base, FEATURE_UNSUPPORTED)
    if call_key == "fan.set_preset_mode":
        modes = attrs.get("preset_modes") if attrs else None
        if not isinstance(modes, list) or clean["preset_mode"] not in modes:
            return _deny(base, OUT_OF_RANGE)
    if domain == "media_player":
        reason = _check_media(
            service, clean, attrs, profile_capabilities(profile), profile, issued
        )
        if reason:
            return _deny(base, reason)
    if call_key in ("light.turn_on", "light.turn_off"):
        reason = _check_light(clean, attrs, profile_capabilities(profile), entry)
        if reason:
            return _deny(base, reason)

    return CallDecision(True, None, domain, service, entity_id, clean)


def is_url_like(content_id: str) -> bool:
    """A content id that points straight at a stream, a file or carries a token."""
    low = content_id.strip().lower()
    scheme = low.split(":", 1)[0] if ":" in low else ""
    return scheme in MEDIA_URL_SCHEMES or low.startswith("/") or _has_token(low)


def _check_media(
    service: str,
    clean: dict[str, Any],
    attrs: dict | None,
    caps: dict,
    profile: dict,
    issued: Callable[[str], bool] | None,
) -> str | None:
    """Media rules beyond field types: volume cap, sources, grouping, play_media."""
    if service == "volume_set":
        # clamped, not refused: the slider may sit at the very end
        clean["volume_level"] = min(clean["volume_level"], caps["max_volume"])
    if service == "volume_up":
        level = attrs.get("volume_level") if attrs else None
        if _is_number(level) and level >= caps["max_volume"]:
            return OUT_OF_RANGE
    if service == "select_source":
        sources = attrs.get("source_list") if attrs else None
        if not isinstance(sources, list) or clean["source"] not in sources:
            return OUT_OF_RANGE
    if service in ("join", "unjoin"):
        if not caps["media_group"]:
            return CAPABILITY_DISABLED
        entities = profile.get("entities") or {}
        for member in clean.get("group_members", []):
            entry = entities.get(member)
            if not isinstance(entry, dict) or domain_access("media_player") == "denied":
                return ENTITY_NOT_ALLOWED
    if service == "play_media":
        if not caps["media_browse"]:
            return CAPABILITY_DISABLED
        content_id = clean.get("media_content_id")
        if not content_id or not clean.get("media_content_type"):
            return INVALID_VALUE
        if is_url_like(content_id):
            return INVALID_VALUE
        # only ids this pass got from browse/search in the last minutes
        if issued is None or not issued(content_id):
            return ENTITY_NOT_ALLOWED
    return None


_BROWSE_FIELDS = (
    "title",
    "media_class",
    "media_content_type",
    "media_content_id",
    "children_media_class",
    "can_play",
    "can_expand",
)


def sanitize_browse(
    payload: Any, max_children: int = MEDIA_BROWSE_MAX_CHILDREN
) -> dict:
    """A browse/search result as sent to a guest.

    Only the fields the app renders, at most `max_children` children, no
    thumbnails (they are HA URLs, often with a token), nothing token-like.
    Items with a URL-like content id cannot be played and are left out.
    """

    def item(raw: Any) -> dict | None:
        if not isinstance(raw, dict):
            return None
        out = {}
        for key in _BROWSE_FIELDS:
            value = raw.get(key)
            if isinstance(value, str):
                if _has_token(value):
                    return None
                out[key] = value[:300]
            elif isinstance(value, bool):
                out[key] = value
            elif value is None:
                out[key] = None
        cid = out.get("media_content_id")
        if not isinstance(cid, str) or not cid or is_url_like(cid):
            return None
        out["can_play"] = out.get("can_play") is True
        out["can_expand"] = out.get("can_expand") is True
        return out

    src = payload if isinstance(payload, dict) else {}
    head = item(src) or {
        "title": str(src.get("title") or "")[:300],
        "media_class": None,
        "media_content_type": None,
        "media_content_id": None,
        "can_play": False,
        "can_expand": True,
    }
    raw_children = src.get("children") if isinstance(src.get("children"), list) else []
    if not raw_children and isinstance(src.get("result"), list):
        raw_children = src["result"]  # search results
    children = [c for c in (item(r) for r in raw_children) if c][:max_children]
    head["children"] = children
    head["truncated"] = len(raw_children) > max_children
    return head


def _has_feature(attrs: dict | None, bit: int) -> bool:
    features = attrs.get("supported_features") if attrs else None
    return (
        isinstance(features, int)
        and not isinstance(features, bool)
        and bool(features & bit)
    )


def _check_light(
    clean: dict[str, Any], attrs: dict | None, caps: dict, entry: dict
) -> str | None:
    """Light fields that need a profile capability or the light's own support."""
    if "brightness" in clean:
        if "brightness_pct" in clean:
            return INVALID_VALUE  # HA treats them as exclusive, so do we
        pct = clean["brightness"] / 255 * 100
        if not _in_range(
            pct,
            {"min": 0, "max": 100},
            effective_limit(entry, "light.turn_on", "brightness_pct"),
        ):
            return OUT_OF_RANGE
    if "transition" in clean and clean["transition"] > caps["max_transition"]:
        return OUT_OF_RANGE
    color = [k for k in ("hs_color", "rgb_color", "color_temp_kelvin") if k in clean]
    if len(color) > 1:
        return INVALID_VALUE  # one colour descriptor per call (COLOR_GROUP)
    if not color and "effect" not in clean:
        return None
    if not isinstance(attrs, dict):
        return FEATURE_UNSUPPORTED
    modes = attrs.get("supported_color_modes")
    modes = set(modes) if isinstance(modes, list) else set()
    if "hs_color" in clean or "rgb_color" in clean:
        if not caps["allow_color"]:
            return CAPABILITY_DISABLED
        if not modes & set(LIGHT_COLOR_MODES):
            return FEATURE_UNSUPPORTED
    if "color_temp_kelvin" in clean:
        if not caps["allow_color_temp"]:
            return CAPABILITY_DISABLED
        if LIGHT_COLOR_TEMP_MODE not in modes:
            return FEATURE_UNSUPPORTED
        low = attrs.get("min_color_temp_kelvin")
        high = attrs.get("max_color_temp_kelvin")
        kelvin = clean["color_temp_kelvin"]
        if (_is_number(low) and kelvin < low) or (_is_number(high) and kelvin > high):
            return OUT_OF_RANGE
    if "effect" in clean:
        if not caps["allow_effects"]:
            return CAPABILITY_DISABLED
        if not _has_feature(attrs, LIGHT_FEATURE_EFFECT):
            return FEATURE_UNSUPPORTED
        effects = attrs.get("effect_list")
        if not isinstance(effects, list) or clean["effect"] not in effects:
            return OUT_OF_RANGE
    return None


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
        "capabilities": normalize_capabilities(raw.get("capabilities")),
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
    that older stored configs may still carry, and lists of entity ids (light
    groups): members outside the profile are left out.
    """
    out = {}
    for key, value in item.items():
        if key == "haAreaId":
            continue
        if isinstance(value, str) and entity_domain(value) and value not in allowed:
            continue
        if isinstance(value, list) and any(
            isinstance(v, str) and entity_domain(v) for v in value
        ):
            value = [
                v
                for v in value
                if not (isinstance(v, str) and entity_domain(v)) or v in allowed
            ]
        out[key] = deepcopy(value)
    return out


def _guest_visible(device: dict, allowed: set[str], show_wifi: bool) -> bool:
    """Does a (already stripped) tile reach the guest at all?"""
    kind = device.get("type")
    if kind == "wifi" and not show_wifi:
        return False
    if kind in LIST_TILE_TYPES:
        # light groups: only the members in the profile remain; none = no tile
        return any(
            isinstance(v, list) and v for k, v in device.items() if k == "entities"
        )
    return device.get("id") in allowed or _is_layout_tile(device)


def _is_layout_tile(device: dict) -> bool:
    """Dividers and other tiles without an entity: never an allowed/denied entity."""
    return device.get("type") in LAYOUT_TILE_TYPES


def _guest_tile(device: dict, show_wifi: bool) -> dict:
    """Per-tile options a guest must not get: the Wi-Fi button without show_wifi.

    A weather `entity` outside the profile is already gone (_strip_foreign_refs);
    the app then uses the first weather entity the guest may see, or shows "—".
    """
    if not show_wifi and "showWifi" in device:
        device["showWifi"] = False
    return device


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
            _guest_tile(tile, show_wifi)
            for d in page.get("devices") or []
            if isinstance(d, dict)
            and _guest_visible(
                tile := _strip_foreign_refs(d, allowed), allowed, show_wifi
            )
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

    guest_info = (
        deepcopy(config.get("guestInfo") or {})
        if show_wifi
        else {"wifiSsid": "", "wifiPassword": "", "wifiSecurity": "nopass"}
    )

    return {
        "configVersion": config.get("configVersion"),
        # what this guest may do beyond on/off; the app hides other controls
        "capabilities": profile_capabilities(profile),
        "guestInfo": guest_info,
        "general": general,
        "standby": deepcopy(config.get("standby") or {}),
        "appearance": deepcopy(config.get("appearance") or {}),
        "pages": pages,
        "dock": dock,
    }
