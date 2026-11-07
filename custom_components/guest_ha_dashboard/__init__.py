"""Guest HA Dashboard — config panel + live config for the guest PWA."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    VERSION,
)
from .guest_admin import async_register_admin_ws
from .guest_http import GuestPairView
from .guest_runtime import GuestRuntime
from .guest_store import GuestStore
from .guest_ws import GuestWebSocketView
from .store import GuestDashboardStore
from .websocket_api import async_register_ws

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list = []
_VIEWS_REGISTERED = f"{DOMAIN}_guest_views"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up from YAML is unused — config entry only."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Guest HA Dashboard from a config entry."""
    store = GuestDashboardStore(hass)
    await store.async_load()

    guest_store = GuestStore(hass)
    await guest_store.async_load()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["store"] = store
    hass.data[DOMAIN]["entry_id"] = entry.entry_id
    hass.data[DOMAIN]["guests"] = GuestRuntime(hass, guest_store, store)

    async_register_ws(hass)
    async_register_admin_ws(hass)
    _register_guest_views(hass)

    # Serve panel module: /guest_ha_dashboard_static/panel.js
    static_dir = Path(__file__).parent / "www"
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(f"/{DOMAIN}_static", str(static_dir), False)]
        )
    except Exception:  # noqa: BLE001 — fallback for older HA
        hass.http.register_static_path(
            f"/{DOMAIN}_static",
            str(static_dir),
            cache_headers=False,
        )

    await panel_custom.async_register_panel(
        hass=hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        # Cache-bust so browsers/HACS don't keep a stale panel.js
        module_url=f"/{DOMAIN}_static/panel.js?v={VERSION}",
        embed_iframe=False,
        require_admin=True,
        config={"entry_id": entry.entry_id, "version": VERSION},
    )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the integration and remove the panel."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    data = hass.data.pop(DOMAIN, None) or {}
    if runtime := data.get("guests"):
        runtime.shutdown()
    return True


def _register_guest_views(hass: HomeAssistant) -> None:
    """Guest endpoints, once per HA run (aiohttp routes cannot be removed).

    While the integration is unloaded the views answer 503.
    """
    if hass.data.get(_VIEWS_REGISTERED):
        return
    hass.http.register_view(GuestPairView())
    hass.http.register_view(GuestWebSocketView())
    hass.data[_VIEWS_REGISTERED] = True
