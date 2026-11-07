"""Persistent config store for Guest HA Dashboard."""

from __future__ import annotations

from copy import deepcopy
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .config_schema import config_version, migrate_config, normalize_devices
from .const import (
    CONFIG_VERSION,
    DEFAULT_CONFIG,
    DEFAULT_GENERAL,
    DEFAULT_STANDBY,
    DOCK_MAX,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)

GUEST_INFO_KEYS = ("wifiSsid", "wifiPassword", "wifiSecurity")
STANDBY_MODES = ("clock", "photos")
CLOCK_STYLES = ("bold", "minimal")


def _clamp_int(value: Any, low: int, high: int, default: int) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _normalize_standby(raw: Any) -> dict:
    src = raw if isinstance(raw, dict) else {}
    return {
        "enabled": bool(src.get("enabled", DEFAULT_STANDBY["enabled"])),
        "idleMinutes": _clamp_int(
            src.get("idleMinutes"), 1, 120, DEFAULT_STANDBY["idleMinutes"]
        ),
        "mode": src.get("mode")
        if src.get("mode") in STANDBY_MODES
        else DEFAULT_STANDBY["mode"],
        "clockStyle": src.get("clockStyle")
        if src.get("clockStyle") in CLOCK_STYLES
        else DEFAULT_STANDBY["clockStyle"],
        "photoSeconds": _clamp_int(
            src.get("photoSeconds"), 3, 600, DEFAULT_STANDBY["photoSeconds"]
        ),
    }


def _normalize_general(raw: Any) -> dict:
    src = raw if isinstance(raw, dict) else {}
    out = {}
    for key, default in DEFAULT_GENERAL.items():
        value = src.get(key, default)
        out[key] = str(value or "") if isinstance(default, str) else bool(value)
    return out


def _normalize_guest_info(raw: Any) -> dict:
    src = raw if isinstance(raw, dict) else {}
    base = DEFAULT_CONFIG["guestInfo"]
    return {key: str(src.get(key, base[key]) or "") for key in GUEST_INFO_KEYS}


def _normalize_pages(data: dict[str, Any]) -> list:
    """Prefer pages; migrate legacy rooms. Drop HA Area linkage."""
    pages = data.get("pages")
    if isinstance(pages, list) and pages:
        raw = pages
    else:
        rooms = data.get("rooms")
        if isinstance(rooms, list):
            raw = rooms
        elif isinstance(pages, list):
            raw = pages
        else:
            raw = []
    cleaned = []
    used_ids: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        page = {k: v for k, v in item.items() if k != "haAreaId"}
        devices, dropped = normalize_devices(page.get("devices"), used_ids)
        if dropped:
            _LOGGER.warning(
                "dash: dropped %d tile(s) of unknown type %s from page %s",
                len(dropped),
                sorted({str(t) for t in dropped}),
                page.get("id"),
            )
        page["devices"] = devices
        cleaned.append(page)
    return cleaned


def _migrate_config(data: dict[str, Any]) -> dict[str, Any]:
    """Stored config -> current CONFIG_VERSION; applied on load and on save."""
    version = config_version(data)
    if version > CONFIG_VERSION:
        _LOGGER.warning(
            "dash: config version %s is newer than this integration (%s); "
            "unknown tiles are dropped when it is saved",
            version,
            CONFIG_VERSION,
        )
    elif version < CONFIG_VERSION:
        _LOGGER.info(
            "dash: migrating config from version %s to %s", version, CONFIG_VERSION
        )
    return migrate_config(data)


def _normalize_dock(raw_dock: list) -> list:
    dock = []
    for item in raw_dock[:DOCK_MAX]:
        if not isinstance(item, dict):
            continue
        if item.get("entityId") or item.get("entity_id"):
            continue
        page_id = str(
            item.get("pageId")
            or item.get("page_id")
            or item.get("roomId")
            or item.get("room_id")
            or ""
        ).strip()
        if not page_id:
            continue
        dock.append(
            {
                "pageId": page_id,
                "label": str(item.get("label") or "").strip(),
                "showLabel": bool(item.get("showLabel", True)),
                "icon": str(item.get("icon") or "Home"),
            }
        )
    return dock


class GuestDashboardStore:
    """Load / save dashboard JSON config."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, Any] = deepcopy(DEFAULT_CONFIG)
        self._listeners: list = []

    async def async_load(self) -> dict[str, Any]:
        """Load from disk (or defaults)."""
        stored = await self._store.async_load()
        if stored:
            merged = {**deepcopy(DEFAULT_CONFIG), **_migrate_config(stored)}
            merged["pages"] = _normalize_pages(merged)
            merged.pop("rooms", None)
            merged.pop("scenes", None)
            merged["dock"] = _normalize_dock(
                merged.get("dock") if isinstance(merged.get("dock"), list) else []
            )
            merged["general"] = _normalize_general(merged.get("general"))
            merged["guestInfo"] = _normalize_guest_info(merged.get("guestInfo"))
            merged["standby"] = _normalize_standby(merged.get("standby"))
            if merged.get("hosting") not in ("hosted", "self"):
                # Installs from before 2.0 already point at their own URL
                merged["hosting"] = "self" if merged.get("dashboardUrl") else "hosted"
            self._data = merged
        else:
            self._data = deepcopy(DEFAULT_CONFIG)
        return self._data

    @property
    def data(self) -> dict[str, Any]:
        """Current in-memory config."""
        return self._data

    async def async_save(self, data: dict[str, Any]) -> dict[str, Any]:
        """Validate lightly, persist, notify listeners."""
        merged = {**deepcopy(DEFAULT_CONFIG), **_migrate_config(data)}
        appearance = (
            merged.get("appearance")
            if isinstance(merged.get("appearance"), dict)
            else {}
        )
        pages = _normalize_pages(merged)
        dock = _normalize_dock(
            merged.get("dock") if isinstance(merged.get("dock"), list) else []
        )
        cleaned = {
            "configVersion": merged["configVersion"],
            "guestInfo": _normalize_guest_info(merged.get("guestInfo")),
            "general": _normalize_general(merged.get("general")),
            "standby": _normalize_standby(merged.get("standby")),
            "pages": pages if isinstance(pages, list) else [],
            "dock": dock,
            "hosting": merged.get("hosting")
            if merged.get("hosting") in ("hosted", "self")
            else "hosted",
            "dashboardUrl": merged.get("dashboardUrl") or "",
            "appearance": {
                **deepcopy(DEFAULT_CONFIG["appearance"]),
                **{k: v for k, v in appearance.items() if k != "language"},
                "mode": appearance.get("mode")
                if appearance.get("mode") in ("light", "dark")
                else DEFAULT_CONFIG["appearance"]["mode"],
            },
        }
        self._data = cleaned
        await self._store.async_save(cleaned)
        for listener in list(self._listeners):
            listener(cleaned)
        return cleaned

    def async_subscribe(self, listener) -> callable:
        """Subscribe to config changes. Returns unsubscribe."""
        self._listeners.append(listener)

        def _unsub() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return _unsub
