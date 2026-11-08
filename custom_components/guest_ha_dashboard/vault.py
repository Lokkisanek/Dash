"""Secrets of the integration: Spotify tokens, library service credentials.

Kept in their own Home Assistant Store (`guest_ha_dashboard.vault`), apart
from the dashboard config, which is sent to the panel and (filtered) to
guests. Nothing from here is ever logged, sent to a client (except the
owner's own short-lived Spotify access token, see spotify.py), put in an HA
event or in the guest audit log. `SecretRedactor` is installed on the
integration's loggers so even an accidental log line cannot carry a secret.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import VAULT_STORAGE_KEY, VAULT_STORAGE_VERSION
from .redact import SecretRedactor


class Vault:
    """Load / save the secrets store."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass, VAULT_STORAGE_VERSION, VAULT_STORAGE_KEY, private=True
        )
        self.data: dict[str, Any] = {"spotify": {}, "library": {}}
        self._filter = SecretRedactor(lambda: self.data)

    async def async_load(self) -> dict[str, Any]:
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            self.data = {
                "spotify": stored.get("spotify")
                if isinstance(stored.get("spotify"), dict)
                else {},
                "library": stored.get("library")
                if isinstance(stored.get("library"), dict)
                else {},
            }
        logging.getLogger(__package__).addFilter(self._filter)
        for handler in logging.getLogger().handlers:
            handler.addFilter(self._filter)
        return self.data

    def schedule_save(self) -> None:
        self._store.async_delay_save(lambda: self.data, 1)

    def unload(self) -> None:
        logging.getLogger(__package__).removeFilter(self._filter)
        for handler in logging.getLogger().handlers:
            handler.removeFilter(self._filter)
