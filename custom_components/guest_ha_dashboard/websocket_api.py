"""WebSocket API for Guest HA Dashboard."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


def async_register_ws(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    websocket_api.async_register_command(hass, ws_get_config)
    websocket_api.async_register_command(hass, ws_set_config)
    websocket_api.async_register_command(hass, ws_subscribe_config)


def _store(hass: HomeAssistant):
    return hass.data[DOMAIN]["store"]


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_config"})
@callback
def ws_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return current guest dashboard config."""
    connection.send_result(msg["id"], _store(hass).data)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_config",
        vol.Required("config"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Save guest dashboard config (admin only)."""
    saved = await _store(hass).async_save(msg["config"])
    connection.send_result(msg["id"], saved)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe_config"})
@callback
def ws_subscribe_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Push config updates to the client."""
    store = _store(hass)

    @callback
    def _forward(config: dict) -> None:
        connection.send_event(msg["id"], {"config": config})

    connection.subscriptions[msg["id"]] = store.async_subscribe(_forward)
    connection.send_result(msg["id"])
    connection.send_event(msg["id"], {"config": store.data})
