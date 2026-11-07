"""Dashboard config versioning and tile validation.

Pure module (no Home Assistant imports) so it is unit tested anywhere. Device
types, styles and sizes come from tile_registry.py, generated from
shared/tiles.json.

Config versions:
  1  everything stored before 2.1 (no `configVersion` key)
  2  `configVersion` added; devices validated against the tile registry
  3  the header (clock, greeting, weather, Wi-Fi) is a tile; its old switches
     in `general` are converted into one `header` tile and removed
"""

from __future__ import annotations

from copy import deepcopy
import re
import secrets
from typing import Any

from .const import CONFIG_VERSION
from .tile_registry import TILE_TYPES

_ENTITY_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")

# Tiles that show the header content; a page with one of them needs no migrated header.
HEADER_FAMILY = ("header", "clock", "greeting", "weather")

# `general` keys of config version 2 and earlier, with the defaults they had then.
LEGACY_HEADER_GENERAL: dict[str, Any] = {
    "showTopBar": True,
    "showWelcome": True,
    "weatherEntity": "",
    "showTime": True,
    "showDate": True,
    "showWifi": True,
    "showTemperature": True,
    "showHumidity": True,
}


def config_version(data: Any) -> int:
    """Stored version; anything missing or odd counts as version 1."""
    raw = data.get("configVersion") if isinstance(data, dict) else None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        return 1
    return raw


def _first(mapping: dict) -> Any:
    return next(iter(mapping))


def needs_entity(device_type: Any) -> bool:
    """True for tiles that control a Home Assistant entity (not dividers)."""
    spec = TILE_TYPES.get(device_type)
    return bool(spec and spec["needsEntity"])


def _type_from_entity(entity_id: Any) -> str | None:
    """Old configs may lack `type`: `light.x` is a light tile, and so on."""
    if not isinstance(entity_id, str) or "." not in entity_id:
        return None
    domain = entity_id.split(".", 1)[0]
    spec = TILE_TYPES.get(domain)
    return domain if spec and domain in spec["domains"] else None


def new_tile_id(device_type: str, used: set[str] | None = None) -> str:
    """`divider-1a2b3c4d`: an id for a tile without an entity, unique in `used`."""
    used = used if used is not None else set()
    while True:
        candidate = f"{device_type}-{secrets.token_hex(4)}"
        if candidate not in used:
            return candidate


def normalize_device(raw: Any, used: set[str] | None = None) -> dict | None:
    """A device with a valid style and size, or None for an unknown type.

    Devices of entity types keep an empty `id`: the panel lets the owner add a
    tile first and pick the entity later, and stored configs contain such tiles.
    Tiles without an entity (dividers) get a `<type>-<8 hex>` id when they have
    none, or when theirs is already taken in `used`.
    """
    if not isinstance(raw, dict):
        return None
    device_type = raw.get("type") or _type_from_entity(raw.get("id"))
    spec = TILE_TYPES.get(device_type)
    if spec is None:
        return None
    styles = spec["styles"]
    style = raw.get("style") if raw.get("style") in styles else _first(styles)
    sizes = styles[style]
    size = raw.get("size") if raw.get("size") in sizes else sizes[0]
    device = {**raw, "type": device_type, "style": style, "size": size}
    device_id = str(raw.get("id") or "")
    if not spec["needsEntity"] and (
        not device_id or (used is not None and device_id in used)
    ):
        device_id = new_tile_id(device_type, used)
    device["id"] = device_id
    if used is not None and device_id:
        used.add(device_id)
    for field, field_spec in (spec.get("fields") or {}).items():
        device[field] = normalize_field(field_spec, raw.get(field))
    return device


def _entity_ok(value: Any, domains: list[str]) -> bool:
    return (
        isinstance(value, str)
        and len(value) <= 255
        and bool(_ENTITY_RE.match(value))
        and value.split(".", 1)[0] in domains
    )


def normalize_field(spec: dict, value: Any) -> Any:
    """One tile option, typed by its registry spec (see shared/tiles.json)."""
    kind = spec.get("type")
    if kind == "bool":
        return value if isinstance(value, bool) else spec["default"]
    if kind == "enum":
        return value if value in spec["values"] else spec["default"]
    if kind == "entity":
        return value if _entity_ok(value, spec["domains"]) else ""
    if kind == "entities":
        items = value if isinstance(value, list) else []
        clean = [v for v in dict.fromkeys(i for i in items if isinstance(i, str))]
        return [v for v in clean if _entity_ok(v, spec["domains"])][: spec["max"]]
    # string
    return str(value if value is not None else "")[: spec["max"]]


def normalize_devices(
    devices: Any, used: set[str] | None = None
) -> tuple[list[dict], list[Any]]:
    """Valid devices and the dropped entries (unknown or broken types).

    Pass one `used` set for the whole config so generated ids stay unique.
    """
    kept: list[dict] = []
    dropped: list[Any] = []
    used = used if used is not None else set()
    for raw in devices if isinstance(devices, list) else []:
        device = normalize_device(raw, used)
        if device is None:
            dropped.append(raw.get("type") if isinstance(raw, dict) else raw)
        else:
            kept.append(device)
    return kept, dropped


def header_from_general(general: Any) -> dict | None:
    """The `header` tile that shows what the old `general` switches showed.

    None when both the top bar and the greeting block were switched off. Missing
    keys take the defaults they had before version 3.
    """
    old = {**LEGACY_HEADER_GENERAL, **(general if isinstance(general, dict) else {})}
    top = bool(old["showTopBar"])
    welcome = bool(old["showWelcome"])
    if not top and not welcome:
        return None
    entity = old.get("weatherEntity")
    return {
        "id": new_tile_id("header"),
        "type": "header",
        "style": "card",
        "size": "4x2",
        "showTime": top and bool(old["showTime"]),
        "showDate": top and bool(old["showDate"]),
        "showWifi": top and bool(old["showWifi"]),
        "showGreeting": welcome,
        "showWeather": welcome,
        "showTemperature": bool(old["showTemperature"]),
        "showHumidity": bool(old["showHumidity"]),
        "entity": entity if _entity_ok(entity, ["weather"]) else "",
        "contrast": "auto",
    }


def _page_list(data: dict) -> str | None:
    """Key of the page list the store will use (`pages`, or legacy `rooms`)."""
    pages = data.get("pages")
    if isinstance(pages, list) and pages:
        return "pages"
    if isinstance(data.get("rooms"), list):
        return "rooms"
    return "pages" if isinstance(pages, list) else None


def _has_header_tile(pages: list) -> bool:
    return any(
        isinstance(d, dict) and d.get("type") in HEADER_FAMILY
        for page in pages
        if isinstance(page, dict)
        for d in (page.get("devices") if isinstance(page.get("devices"), list) else [])
    )


def migrate_config(data: Any) -> dict[str, Any]:
    """Bring a stored config to CONFIG_VERSION. Idempotent; the input is not changed.

    1 -> 2 changes no data by itself; device validation runs on every load and
    save (normalize_devices).
    2 -> 3 inserts one `header` tile at the top of the first page, built from
    the old `general` header switches, unless a page already has a header-family
    tile or both old blocks were off. The old keys are removed from `general`
    in every version, so they are only ever read here.
    A config from a newer integration keeps its data; it is labelled with this
    version once it is saved again.
    """
    out = dict(data) if isinstance(data, dict) else {}
    general = out.get("general")
    if config_version(out) < 3:
        key = _page_list(out)
        pages = out.get(key) if key else None
        if pages and isinstance(pages[0], dict) and not _has_header_tile(pages):
            header = header_from_general(general)
            if header is not None:
                first = deepcopy(pages[0])
                devices = first.get("devices")
                first["devices"] = [
                    header,
                    *(devices if isinstance(devices, list) else []),
                ]
                out[key] = [first, *pages[1:]]
    if isinstance(general, dict):
        out["general"] = {
            k: v for k, v in general.items() if k not in LEGACY_HEADER_GENERAL
        }
    out["configVersion"] = CONFIG_VERSION
    return out
