"""Dashboard config versioning and tile validation.

Pure module (no Home Assistant imports) so it is unit tested anywhere. Device
types, styles and sizes come from tile_registry.py, generated from
shared/tiles.json.

Config versions:
  1  everything stored before 2.1 (no `configVersion` key)
  2  `configVersion` added; devices validated against the tile registry
"""

from __future__ import annotations

import secrets
from typing import Any

from .const import CONFIG_VERSION
from .tile_registry import TILE_TYPES


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
        value = raw.get(field)
        device[field] = str(value if value is not None else "")[: field_spec["max"]]
    return device


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


def migrate_config(data: Any) -> dict[str, Any]:
    """Bring a stored config to CONFIG_VERSION (only adds the version today).

    1 -> 2 changes no data by itself; device validation runs on every load and
    save (normalize_devices). A config from a newer integration keeps its
    data; it is labelled with this version once it is saved again.
    """
    out = dict(data) if isinstance(data, dict) else {}
    out["configVersion"] = CONFIG_VERSION
    return out
