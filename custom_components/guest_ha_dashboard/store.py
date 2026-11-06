"""Persistent config store for Guest HA Dashboard."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DEFAULT_CONFIG, STORAGE_KEY, STORAGE_VERSION


def _normalize_pages(data: dict[str, Any]) -> list:
    """Prefer pages; migrate legacy rooms."""
    pages = data.get("pages")
    if isinstance(pages, list) and pages:
        return pages
    rooms = data.get("rooms")
    if isinstance(rooms, list):
        return rooms
    if isinstance(pages, list):
        return pages
    return []


def _normalize_dock(raw_dock: list) -> list:
    dock = []
    for item in raw_dock[:4]:
        if not isinstance(item, dict):
            continue
        if item.get("entityId") or item.get("entity_id"):
            continue
        page_id = str(
            item.get("pageId") or item.get("page_id") or item.get("roomId") or item.get("room_id") or ""
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
            merged = {**deepcopy(DEFAULT_CONFIG), **stored}
            merged["pages"] = _normalize_pages(merged)
            merged.pop("rooms", None)
            merged.pop("scenes", None)
            merged["dock"] = _normalize_dock(
                merged.get("dock") if isinstance(merged.get("dock"), list) else []
            )
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
        merged = {**deepcopy(DEFAULT_CONFIG), **data}
        appearance = merged.get("appearance") if isinstance(merged.get("appearance"), dict) else {}
        pages = _normalize_pages(merged)
        dock = _normalize_dock(merged.get("dock") if isinstance(merged.get("dock"), list) else [])
        cleaned = {
            "guestInfo": merged.get("guestInfo") or deepcopy(DEFAULT_CONFIG["guestInfo"]),
            "pages": pages if isinstance(pages, list) else [],
            "dock": dock,
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
