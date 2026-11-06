"""Persistent config store for Guest HA Dashboard."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DEFAULT_CONFIG, STORAGE_KEY, STORAGE_VERSION


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
            self._data = {**deepcopy(DEFAULT_CONFIG), **stored}
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
        # Keep known top-level keys only
        appearance = merged.get("appearance") if isinstance(merged.get("appearance"), dict) else {}
        raw_dock = merged.get("dock") if isinstance(merged.get("dock"), list) else []
        dock = []
        for item in raw_dock[:4]:
            if not isinstance(item, dict):
                continue
            entity_id = str(item.get("entityId") or item.get("entity_id") or "").strip()
            if not entity_id:
                continue
            label = str(item.get("label") or "").strip()
            show_label = bool(item.get("showLabel", bool(label)))
            dock.append(
                {
                    "entityId": entity_id,
                    "label": label,
                    "showLabel": show_label,
                    "icon": str(item.get("icon") or "Power"),
                }
            )
        cleaned = {
            "guestInfo": merged.get("guestInfo") or deepcopy(DEFAULT_CONFIG["guestInfo"]),
            "scenes": merged.get("scenes") if isinstance(merged.get("scenes"), list) else [],
            "rooms": merged.get("rooms") if isinstance(merged.get("rooms"), list) else [],
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
