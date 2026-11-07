"""Helpers shared by the Home Assistant tests (not fixtures)."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

from aiohttp import ClientWebSocketResponse

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

DOMAIN = "guest_ha_dashboard"
WS_URL = f"/api/{DOMAIN}/ws"
PAIR_URL = f"/api/{DOMAIN}/pair"

ROOM_ENTITIES = {
    "light.room": {},
    "climate.room": {
        "limits": {"climate.set_temperature": {"temperature": {"min": 18, "max": 25}}}
    },
    "cover.blinds": {},
    "media_player.speaker": {},
    "sensor.room_temp": {},
}


def seed_states(hass: HomeAssistant) -> None:
    """Allowed and forbidden entities with states."""
    hass.states.async_set("light.room", "off", {"friendly_name": "Room"})
    hass.states.async_set("light.other_room", "off", {"friendly_name": "Other"})
    hass.states.async_set("climate.room", "heat", {"temperature": 21})
    hass.states.async_set("cover.blinds", "open", {"current_position": 100})
    hass.states.async_set("cover.garage", "closed", {"device_class": "garage"})
    hass.states.async_set("lock.front_door", "locked")
    hass.states.async_set("sensor.room_temp", "21.5")
    hass.states.async_set(
        "media_player.speaker",
        "playing",
        {
            "entity_picture": "/api/media_player_proxy/media_player.speaker?token=SECRETTOKEN&cache=1",
            "media_title": "Song",
        },
    )


async def make_guest(
    runtime: Any,
    *,
    entities: dict | None = None,
    kind: str = "phone",
    hours: float | None = 24,
    show_wifi: bool = True,
) -> tuple[str, str, str]:
    """Profile + pass + paired token. Returns (token, pass_id, profile_id)."""
    model = runtime.store.model
    now = runtime.now()
    profile = model.profile_save(
        {
            "name": "Pokoj 3",
            "entities": entities or ROOM_ENTITIES,
            "show_wifi": show_wifi,
        },
        now,
    )
    until = (now + timedelta(hours=hours)).isoformat() if hours is not None else None
    pass_, code = model.pass_create(
        profile_id=profile["id"],
        label="Pokoj 3 - Novák",
        kind=kind,
        valid_from=None,
        valid_until=until,
        now=now,
    )
    _p, token = model.pair(code["code"], now)
    await runtime.store.async_save()
    return token, pass_["id"], profile["id"]


async def new_code(runtime: Any, **kwargs: Any) -> tuple[str, str]:
    """Profile + pass with an unused pairing code. Returns (code, pass_id)."""
    model = runtime.store.model
    now = runtime.now()
    profile = model.profile_save({"name": "Pokoj 3", "entities": ROOM_ENTITIES}, now)
    pass_, code = model.pass_create(
        profile_id=profile["id"],
        label="Pokoj 3",
        kind=kwargs.get("kind", "phone"),
        valid_from=None,
        valid_until=(now + timedelta(hours=24)).isoformat(),
        now=now,
    )
    await runtime.store.async_save()
    return code["code"], pass_["id"]


async def guest_connect(client: Any, token: str | None) -> ClientWebSocketResponse:
    """Open the guest socket and send the auth message (if a token is given)."""
    ws = await client.ws_connect(WS_URL)
    first = await recv(ws)
    assert first == {"type": "auth_required"}
    if token is not None:
        await ws.send_json({"type": "auth", "token": token})
    return ws


async def recv(ws: ClientWebSocketResponse, timeout: float = 5) -> dict:
    """Next JSON message (fails the test instead of hanging)."""
    async with asyncio.timeout(timeout):
        return await ws.receive_json()


async def recv_close(ws: ClientWebSocketResponse, timeout: float = 5) -> int:
    """Skip messages until the server closes; returns the close code."""
    async with asyncio.timeout(timeout):
        while True:
            msg = await ws.receive()
            if msg.type.name in ("CLOSE", "CLOSED", "CLOSING"):
                return ws.close_code if msg.data is None else msg.data


def utcnow() -> Any:
    """Current (possibly frozen) time."""
    return dt_util.utcnow()
