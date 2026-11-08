"""Videotéka in Home Assistant: secrets stay in the vault, off by default, guests denied.

No Radarr/Sonarr/qBittorrent is contacted: only paths that answer before any
request are used (the logic itself is covered by tests/pure/test_library.py).
"""

from __future__ import annotations

import json
from typing import Any

from ha_helpers import DOMAIN, guest_connect, make_guest, recv
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant

pytestmark = pytest.mark.parametrize("expected_lingering_timers", [True])

FAKE_KEY = "fake-radarr-key-ABCD1234"
FAKE_PASSWORD = "fake-qb-password-EFGH5678"


async def test_service_secrets_never_come_back(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: Any
) -> None:
    client = await hass_ws_client(hass)
    replies = []
    for msg in (
        {
            "type": f"{DOMAIN}/library/set_service",
            "service": "radarr",
            "url": "http://192.168.1.10:7878",
            "api_key": FAKE_KEY,
        },
        {
            "type": f"{DOMAIN}/library/set_service",
            "service": "qbittorrent",
            "url": "http://192.168.1.10:8080",
            "username": "admin",
            "password": FAKE_PASSWORD,
        },
        {"type": f"{DOMAIN}/library/services"},
        {"type": f"{DOMAIN}/get_config"},
        {"type": f"{DOMAIN}/library/discover"},
        {"type": f"{DOMAIN}/library/requests"},
    ):
        await client.send_json_auto_id(msg)
        replies.append(await client.receive_json())
    services = replies[2]["result"]
    assert services["radarr"] == {"configured": True, "url": "http://192.168.1.10:7878"}
    assert services["qbittorrent"]["configured"] is True
    # off by default
    assert replies[4]["error"]["code"] == "library_disabled"
    assert replies[3]["result"]["library"]["enabled"] is False
    blob = json.dumps(replies)
    assert FAKE_KEY not in blob and FAKE_PASSWORD not in blob


async def test_bad_service_url_is_refused(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: Any
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": f"{DOMAIN}/library/set_service",
            "service": "sonarr",
            "url": "http://user:pw@host:8989",
            "api_key": "x" * 32,
        }
    )
    assert (await client.receive_json())["error"]["code"] == "bad_url"


@pytest.mark.parametrize(
    "msg",
    [
        {"type": "library_discover"},
        {"type": "library_search", "query": "x"},
        {"type": "library_detail", "media_type": "movie", "tmdb_id": 1},
        {"type": "library_request", "media_type": "movie", "tmdb_id": 1},
        {"type": "library_releases", "media_type": "movie", "tmdb_id": 1},
        {
            "type": "library_grab",
            "media_type": "movie",
            "tmdb_id": 1,
            "guid": "g",
            "indexer_id": 1,
        },
        {"type": "library_activity"},
        {"type": "library_poster", "poster": "abc"},
    ],
)
async def test_guest_library_kinds_are_off_by_default(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any, msg: dict
) -> None:
    config = dict(runtime.config_store.data)
    config["library"] = {"enabled": True}
    await runtime.config_store.async_save(config)
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    assert (await recv(ws))["type"] == "auth_ok"
    await ws.send_json({"id": 1, **msg})
    assert (await recv(ws))["error"]["code"] == "capability_disabled"
    await ws.close()
