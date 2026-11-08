"""Music engines in Home Assistant: config, Spotify commands, guest kinds.

Spotify itself is never contacted here: the service talks to a session that
must not be used (the tests only reach paths that fail before any request).
"""

from __future__ import annotations

import json
from typing import Any

from ha_helpers import DOMAIN, guest_connect, make_guest, recv
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant

pytestmark = pytest.mark.parametrize("expected_lingering_timers", [True])

FAKE_SECRET = "fake-refresh-token-ZZZZ9999"


async def test_radio_config_keeps_https_only(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: Any
) -> None:
    client = await hass_ws_client(hass)
    config = {
        "configVersion": 3,
        "radio": {
            "stations": [
                {"name": "OK", "url": "https://s.example.com/live"},
                {"name": "Plain", "url": "http://s.example.com/live"},
            ],
            "directory": True,
        },
        "spotify": {"enabled": "yes"},
        "pages": [],
    }
    await client.send_json_auto_id({"type": f"{DOMAIN}/set_config", "config": config})
    saved = (await client.receive_json())["result"]
    assert [s["name"] for s in saved["radio"]["stations"]] == ["OK"]
    assert saved["radio"]["directory"] is True
    assert saved["spotify"] == {"enabled": False, "webPlayer": False}


async def test_spotify_status_has_no_secret_and_needs_setup(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: Any
) -> None:
    hass.data[DOMAIN]["spotify"].data["refresh_token"] = FAKE_SECRET
    client = await hass_ws_client(hass)
    seen = []
    for msg in (
        {"type": f"{DOMAIN}/spotify/status"},
        {"type": f"{DOMAIN}/spotify/connect"},
        {"type": f"{DOMAIN}/spotify/state"},
        {"type": f"{DOMAIN}/spotify/token"},
        {"type": f"{DOMAIN}/get_config"},
        {"type": f"{DOMAIN}/radio/search", "name": "abc"},
    ):
        await client.send_json_auto_id(msg)
        seen.append(await client.receive_json())
    status, connect, state, token, _config, radio = seen
    assert status["result"]["connected"] is True
    assert status["result"]["enabled"] is False
    assert connect["error"]["code"] == "not_configured"
    # Spotify off in the config: no state, and never a token
    assert state["error"]["code"] == "spotify_disabled"
    assert token["error"]["code"] == "spotify_disabled"
    assert radio["error"]["code"] == "directory_disabled"
    assert FAKE_SECRET not in json.dumps(seen)


async def test_spotify_configure_validates(
    hass: HomeAssistant, setup_integration: MockConfigEntry, hass_ws_client: Any
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": f"{DOMAIN}/spotify/configure",
            "client_id": "0123456789abcdef0123456789abcdef",
            "redirect_uri": "http://homeassistant.local:8123/cb",
        }
    )
    assert (await client.receive_json())["error"]["code"] == "bad_redirect_uri"
    await client.send_json_auto_id(
        {
            "type": f"{DOMAIN}/spotify/configure",
            "client_id": "0123456789abcdef0123456789abcdef",
            "redirect_uri": "https://dash.example.com/spotify-callback.html",
        }
    )
    result = (await client.receive_json())["result"]
    assert result["configured"] is True and result["connected"] is False
    await client.send_json_auto_id({"type": f"{DOMAIN}/spotify/connect"})
    url = (await client.receive_json())["result"]["authorize_url"]
    assert url.startswith("https://accounts.spotify.com/authorize?")
    assert "code_challenge_method=S256" in url
    # the verifier never leaves Home Assistant
    pending = hass.data[DOMAIN]["spotify"].data["pending"]
    verifier = next(iter(pending.values()))["verifier"]
    assert verifier not in url


@pytest.mark.parametrize(
    "msg",
    [
        {"type": "spotify_state"},
        {"type": "spotify_control", "action": "pause"},
        {"type": "spotify_search", "query": "x"},
        {"type": "local_media_browse"},
        {"type": "local_media_resolve", "media_content_id": "media-source://x"},
    ],
)
async def test_guest_music_kinds_are_off_by_default(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any, msg: dict
) -> None:
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    assert (await recv(ws))["type"] == "auth_ok"
    await ws.send_json({"id": 1, **msg})
    reply = await recv(ws)
    assert reply["error"]["code"] == "capability_disabled"
    await ws.close()


async def test_guest_config_has_no_player_by_default(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    await runtime.config_store.async_save(
        {
            "configVersion": 3,
            "radio": {"stations": [{"name": "A", "url": "https://a.example.com/"}]},
            "spotify": {"enabled": True},
            "pages": [
                {
                    "id": "a",
                    "devices": [
                        {"id": "light.room", "type": "light"},
                        {"type": "player", "source": "browser"},
                    ],
                }
            ],
        }
    )
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    await ws.send_json({"id": 1, "type": "get_config"})
    config = (await recv(ws))["result"]
    assert [d["type"] for d in config["pages"][0]["devices"]] == ["light"]
    assert "radio" not in config
    assert config["spotify"] == {"enabled": False, "webPlayer": False}
    await ws.close()
