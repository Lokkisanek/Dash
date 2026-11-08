"""Websocket commands for the music engines (owner side).

Spotify: setup and sign-in are admin only, and so is the access token for the
owner's own Web Playback SDK. State, devices, control, search and the
user's playlists are for any signed-in HA user of the dashboard. Errors are
codes, never upstream text. The radio directory works only when the owner
turned it on (`radio.directory`).
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .spotify import CONTROL_ACTIONS, SpotifyError


def async_register_music_ws(hass: HomeAssistant) -> None:
    for handler in (
        ws_spotify_status,
        ws_spotify_configure,
        ws_spotify_connect,
        ws_spotify_callback,
        ws_spotify_disconnect,
        ws_spotify_token,
        ws_spotify_state,
        ws_spotify_devices,
        ws_spotify_control,
        ws_spotify_search,
        ws_spotify_browse,
        ws_radio_search,
    ):
        websocket_api.async_register_command(hass, handler)


def _spotify(hass: HomeAssistant):
    return hass.data[DOMAIN]["spotify"]


def _enabled(hass: HomeAssistant) -> bool:
    config = hass.data[DOMAIN]["store"].data
    return (config.get("spotify") or {}).get("enabled") is True


async def _run(connection, msg_id, coro) -> None:
    try:
        result = await coro
    except SpotifyError as err:
        connection.send_error(msg_id, err.code, err.code)
        return
    connection.send_result(msg_id, result)


def _guarded(hass, connection, msg) -> bool:
    if not _enabled(hass):
        connection.send_error(msg["id"], "spotify_disabled", "spotify_disabled")
        return False
    return True


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/spotify/status"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_spotify_status(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    connection.send_result(
        msg["id"], {**_spotify(hass).status(), "enabled": _enabled(hass)}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/spotify/configure",
        vol.Required("client_id"): str,
        vol.Required("redirect_uri"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_spotify_configure(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    try:
        result = _spotify(hass).configure(msg["client_id"], msg["redirect_uri"])
    except SpotifyError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/spotify/connect"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_spotify_connect(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    try:
        result = _spotify(hass).start()
    except SpotifyError as err:
        connection.send_error(msg["id"], err.code, err.code)
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/spotify/callback",
        vol.Required("code"): str,
        vol.Required("state"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_spotify_callback(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    await _run(connection, msg["id"], _spotify(hass).finish(msg["code"], msg["state"]))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/spotify/disconnect"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_spotify_disconnect(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    connection.send_result(msg["id"], _spotify(hass).disconnect())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/spotify/token"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_spotify_token(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    """The owner's own browser player only (spotify.webPlayer); never the refresh token."""
    if not _guarded(hass, connection, msg):
        return
    if (hass.data[DOMAIN]["store"].data.get("spotify") or {}).get(
        "webPlayer"
    ) is not True:
        connection.send_error(msg["id"], "web_player_disabled", "web_player_disabled")
        return
    await _run(connection, msg["id"], _spotify(hass).owner_token())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/spotify/state"})
@websocket_api.async_response
async def ws_spotify_state(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    if _guarded(hass, connection, msg):
        await _run(connection, msg["id"], _spotify(hass).player_state())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/spotify/devices"})
@websocket_api.async_response
async def ws_spotify_devices(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    if _guarded(hass, connection, msg):

        async def _devices() -> dict:
            return {"devices": await _spotify(hass).devices()}

        await _run(connection, msg["id"], _devices())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/spotify/control",
        vol.Required("action"): vol.In(CONTROL_ACTIONS),
        vol.Optional("value"): vol.Any(int, float, bool),
        vol.Optional("device_id"): str,
        vol.Optional("uri"): str,
    }
)
@websocket_api.async_response
async def ws_spotify_control(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    if not _guarded(hass, connection, msg):
        return

    async def _control() -> dict:
        await _spotify(hass).control(
            msg["action"],
            value=msg.get("value"),
            device_id=msg.get("device_id"),
            uri=msg.get("uri"),
        )
        return {}

    await _run(connection, msg["id"], _control())


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/spotify/search", vol.Required("query"): str}
)
@websocket_api.async_response
async def ws_spotify_search(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    if not _guarded(hass, connection, msg):
        return

    async def _search() -> dict:
        return {"items": await _spotify(hass).search(msg["query"])}

    await _run(connection, msg["id"], _search())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/spotify/browse",
        vol.Required("kind"): vol.In(("playlists", "saved")),
    }
)
@websocket_api.async_response
async def ws_spotify_browse(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    if not _guarded(hass, connection, msg):
        return
    service = _spotify(hass)

    async def _browse() -> dict:
        items = await (
            service.playlists()
            if msg["kind"] == "playlists"
            else service.saved_tracks()
        )
        return {"items": items}

    await _run(connection, msg["id"], _browse())


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/radio/search", vol.Required("name"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_radio_search(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Station directory, only when the owner turned it on."""
    config = hass.data[DOMAIN]["store"].data
    if (config.get("radio") or {}).get("directory") is not True:
        connection.send_error(msg["id"], "directory_disabled", "directory_disabled")
        return
    try:
        stations = await hass.data[DOMAIN]["radio_directory"].search(msg["name"])
    except ValueError:
        connection.send_error(msg["id"], "bad_request", "bad_request")
        return
    except ConnectionError:
        connection.send_error(msg["id"], "unavailable", "unavailable")
        return
    connection.send_result(msg["id"], {"stations": stations})
