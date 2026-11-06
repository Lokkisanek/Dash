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
    VERSION,  # 1.2.6
)
from .store import GuestDashboardStore
from .websocket_api import async_register_ws

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list = []


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up from YAML is unused — config entry only."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Guest HA Dashboard from a config entry."""
    store = GuestDashboardStore(hass)
    await store.async_load()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["store"] = store
    hass.data[DOMAIN]["entry_id"] = entry.entry_id

    async_register_ws(hass)

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
    hass.data.pop(DOMAIN, None)
    return True
