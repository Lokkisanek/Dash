"""Persistent storage for guest passes (.storage/guest_ha_dashboard.guests)."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import GUEST_STORAGE_KEY, GUEST_STORAGE_VERSION
from .guest_model import GuestData, migrate

# last_seen and audit-only changes are batched; security changes save at once
_DELAYED_SAVE_SECONDS = 10


class _GuestStorage(Store[dict[str, Any]]):
    """Store with a migration hook for future versions."""

    async def _async_migrate_func(
        self, old_major_version: int, old_minor_version: int, old_data: dict
    ) -> dict[str, Any]:
        return migrate(old_major_version, old_data)


class GuestStore:
    """Loads and saves GuestData. The file is private (mode 0600)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store = _GuestStorage(
            hass,
            GUEST_STORAGE_VERSION,
            GUEST_STORAGE_KEY,
            private=True,
            atomic_writes=True,
        )
        self.model = GuestData()

    async def async_load(self) -> None:
        """Read the file (or start empty)."""
        self.model = GuestData(await self._store.async_load())

    async def async_save(self) -> None:
        """Write now: pairing, revoke, profile and pass changes."""
        await self._store.async_save(self.model.data)

    def schedule_save(self) -> None:
        """Write soon: last_seen and audit entries."""
        self._store.async_delay_save(lambda: self.model.data, _DELAYED_SAVE_SECONDS)
