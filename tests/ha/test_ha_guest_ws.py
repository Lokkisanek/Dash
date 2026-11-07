"""GET /api/guest_ha_dashboard/ws: auth, lifetime, isolation, service calls."""

from __future__ import annotations

from datetime import timedelta
import json
from typing import Any
from unittest.mock import patch

from freezegun.api import FrozenDateTimeFactory
from ha_helpers import (
    ROOM_ENTITIES,
    WS_URL,
    guest_connect,
    make_guest,
    recv,
    recv_close,
    seed_states,
)
import pytest
from pytest_homeassistant_custom_component.common import (
    async_fire_time_changed,
    async_mock_service,
)

from homeassistant.core import HomeAssistant

# aiohttp re-arms its websocket heartbeat timer when the server closes the
# connection; Home Assistant's own websocket tests allow that the same way.
pytestmark = pytest.mark.parametrize("expected_lingering_timers", [True])


# ─── auth ────────────────────────────────────────────────────────────────────


async def test_auth_ok(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    token, pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    msg = await recv(ws)
    assert msg["type"] == "auth_ok"
    assert msg["pass"]["id"] == pass_id
    assert msg["profile"] == {"name": "Pokoj 3"}
    await ws.close()


async def test_auth_timeout(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    with patch(
        "custom_components.guest_ha_dashboard.guest_ws.WS_AUTH_TIMEOUT_SECONDS", 0.2
    ):
        ws = await guest_connect(await hass_client_no_auth(), None)
        assert await recv(ws) == {"type": "auth_invalid", "code": "auth_timeout"}
        assert await recv_close(ws) == 4000


async def test_bad_token_rejected_and_audited(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    ws = await guest_connect(await hass_client_no_auth(), "x" * 43)
    assert await recv(ws) == {"type": "auth_invalid", "code": "invalid_auth"}
    assert await recv_close(ws) == 4000
    assert runtime.store.model.data["audit"][-1]["event"] == "auth_failed"


async def test_bad_tokens_are_rate_limited(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    client = await hass_client_no_auth()
    for _ in range(5):
        ws = await guest_connect(client, "y" * 43)
        await recv(ws)
        await recv_close(ws)
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(client, token)
    assert await recv(ws) == {"type": "auth_invalid", "code": "rate_limited"}


async def test_not_yet_valid(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    model = runtime.store.model
    now = runtime.now()
    profile = model.profile_save({"name": "R", "entities": ROOM_ENTITIES}, now)
    _pass, code = model.pass_create(
        profile_id=profile["id"],
        label="R",
        kind="phone",
        valid_from=(now + timedelta(days=1)).isoformat(),
        valid_until=(now + timedelta(days=2)).isoformat(),
        now=now,
    )
    _p, token = model.pair(code["code"], now)
    ws = await guest_connect(await hass_client_no_auth(), token)
    assert await recv(ws) == {"type": "auth_invalid", "code": "not_yet_valid"}


# ─── lifetime ────────────────────────────────────────────────────────────────


async def test_expiry_closes_live_socket(
    hass: HomeAssistant,
    runtime: Any,
    hass_client_no_auth: Any,
    freezer: FrozenDateTimeFactory,
) -> None:
    token, _pass_id, _profile = await make_guest(runtime, hours=1)
    ws = await guest_connect(await hass_client_no_auth(), token)
    assert (await recv(ws))["type"] == "auth_ok"

    freezer.tick(timedelta(hours=1, seconds=1))
    async_fire_time_changed(hass)
    assert await recv(ws) == {"type": "closing", "reason": "expired"}
    assert await recv_close(ws) == 4002


async def test_revoke_closes_live_socket(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any, hass_ws_client: Any
) -> None:
    token, pass_id, _profile = await make_guest(runtime)
    guest = await guest_connect(await hass_client_no_auth(), token)
    assert (await recv(guest))["type"] == "auth_ok"

    admin = await hass_ws_client(hass)
    await admin.send_json_auto_id(
        {"type": "guest_ha_dashboard/pass/revoke", "pass_id": pass_id}
    )
    assert (await admin.receive_json())["success"]

    assert await recv(guest) == {"type": "closing", "reason": "revoked"}
    assert await recv_close(guest) == 4003

    # and the token is dead afterwards
    again = await guest_connect(await hass_client_no_auth(), token)
    assert (await recv(again))["code"] == "invalid_auth"


async def test_extend_moves_expiry(
    hass: HomeAssistant,
    runtime: Any,
    hass_client_no_auth: Any,
    freezer: FrozenDateTimeFactory,
) -> None:
    # The 2 h clock jump below would also fire the 180 s idle timeout; real
    # clients ping every 50 s, so switch the idle timeout off for this test.
    idle = patch(
        "custom_components.guest_ha_dashboard.guest_ws.WS_IDLE_TIMEOUT_SECONDS", None
    )
    idle.start()
    token, pass_id, _profile = await make_guest(runtime, hours=1)
    ws = await guest_connect(await hass_client_no_auth(), token)
    assert (await recv(ws))["type"] == "auth_ok"
    later = (runtime.now() + timedelta(hours=5)).isoformat()
    runtime.store.model.pass_extend(pass_id, later, runtime.now())
    runtime.pass_times_changed(pass_id)

    freezer.tick(timedelta(hours=2))
    async_fire_time_changed(hass)
    await ws.send_json({"id": 1, "type": "ping"})
    assert await recv(ws) == {"id": 1, "type": "pong"}
    await ws.close()
    idle.stop()


async def test_socket_limit_per_pass(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    token, _pass_id, _profile = await make_guest(runtime)
    client = await hass_client_no_auth()
    sockets = []
    for _ in range(3):
        ws = await guest_connect(client, token)
        assert (await recv(ws))["type"] == "auth_ok"
        sockets.append(ws)
    extra = await guest_connect(client, token)
    assert await recv(extra) == {"type": "auth_invalid", "code": "too_many_connections"}
    assert await recv_close(extra) == 4004
    for ws in sockets:
        await ws.close()


async def test_message_size_limit(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    assert (await recv(ws))["type"] == "auth_ok"
    await ws.send_str(json.dumps({"id": 1, "type": "ping", "pad": "x" * 20000}))
    assert await recv_close(ws) == 1009


async def test_unknown_and_malformed_commands(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    await ws.send_json({"id": 1, "type": "call_ha_api", "path": "/api/states"})
    assert (await recv(ws))["error"]["code"] == "unknown_command"
    await ws.send_str("garbage")
    assert (await recv(ws))["error"]["code"] == "bad_request"
    await ws.send_json({"id": "x", "type": "ping"})
    assert (await recv(ws))["error"]["code"] == "bad_request"
    await ws.close()


# ─── isolation ───────────────────────────────────────────────────────────────


async def test_snapshot_and_live_updates_only_allowed(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    seed_states(hass)
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)

    await ws.send_json({"id": 1, "type": "subscribe_states"})
    result = await recv(ws)
    states = result["result"]["states"]
    assert set(states) == {
        "light.room",
        "climate.room",
        "cover.blinds",
        "media_player.speaker",
        "sensor.room_temp",
    }
    text = json.dumps(states)
    assert "SECRETTOKEN" not in text
    assert "context" not in text
    assert states["media_player.speaker"]["attributes"]["dash_artwork"] is True

    hass.states.async_set("light.other_room", "on")
    hass.states.async_set("lock.front_door", "unlocked")
    hass.states.async_set("light.room", "on")
    await hass.async_block_till_done()
    update = await recv(ws)
    assert update["type"] == "state"
    assert update["entity_id"] == "light.room"
    assert update["state"]["state"] == "on"

    await ws.send_json({"id": 2, "type": "subscribe_states"})
    assert (await recv(ws))["error"]["code"] == "already_subscribed"
    await ws.close()


async def test_get_config_filters_tiles_and_wifi(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    await runtime.config_store.async_save(
        {
            "guestInfo": {
                "wifiSsid": "Guest",
                "wifiPassword": "hunter2",
                "wifiSecurity": "WPA",
            },
            "pages": [
                {
                    "id": "a",
                    "label": "A",
                    "devices": [{"id": "light.room"}, {"id": "lock.front_door"}],
                },
                {"id": "b", "label": "B", "devices": [{"id": "light.other_room"}]},
            ],
            "dock": [{"pageId": "a"}, {"pageId": "b"}],
            "hosting": "self",
            "dashboardUrl": "https://dash.example.com",
        }
    )
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    await ws.send_json({"id": 1, "type": "get_config"})
    config = (await recv(ws))["result"]
    assert [p["id"] for p in config["pages"]] == ["a"]
    assert [d["id"] for d in config["pages"][0]["devices"]] == ["light.room"]
    assert [d["pageId"] for d in config["dock"]] == ["a"]
    assert config["guestInfo"]["wifiPassword"] == "hunter2"
    assert "dashboardUrl" not in config and "hosting" not in config
    await ws.close()

    token, _pass_id, _profile = await make_guest(runtime, show_wifi=False)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    await ws.send_json({"id": 1, "type": "get_config"})
    config = (await recv(ws))["result"]
    assert "hunter2" not in json.dumps(config)
    assert config["guestInfo"]["wifiSsid"] == ""
    assert (
        "showWifi" not in config["general"]
    )  # since config v3 the button is a tile option
    await ws.close()


async def test_config_push_is_filtered(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    await runtime.config_store.async_save(
        {
            "pages": [
                {
                    "id": "a",
                    "devices": [{"id": "light.room"}, {"id": "lock.front_door"}],
                }
            ]
        }
    )
    pushed = await recv(ws)
    assert pushed["type"] == "config"
    assert [d["id"] for d in pushed["config"]["pages"][0]["devices"]] == ["light.room"]
    await ws.close()


async def test_profile_change_reconnects_guest(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    token, _pass_id, profile_id = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    model = runtime.store.model
    model.profile_save(
        {"id": profile_id, "name": "Pokoj 3", "entities": {"light.room": {}}},
        runtime.now(),
    )
    runtime.close_profile(profile_id)
    assert await recv(ws) == {"type": "closing", "reason": "profile_changed"}
    assert await recv_close(ws) == 4001


# ─── service calls ───────────────────────────────────────────────────────────


async def _call(ws: Any, msg_id: int, **msg: Any) -> dict:
    await ws.send_json({"id": msg_id, "type": "call_service", **msg})
    return await recv(ws)


async def test_allowed_call_reaches_hass(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    seed_states(hass)
    calls = async_mock_service(hass, "light", "turn_on")
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    result = await _call(
        ws,
        1,
        domain="light",
        service="turn_on",
        entity_id="light.room",
        data={"brightness_pct": 40},
    )
    assert result["success"] is True
    assert len(calls) == 1
    assert calls[0].data == {"entity_id": "light.room", "brightness_pct": 40}
    assert calls[0].context.user_id is None
    await ws.close()


async def test_light_group_call_is_one_call_with_a_list(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    seed_states(hass)
    hass.states.async_set("light.desk", "off", {"friendly_name": "Desk"})
    calls = async_mock_service(hass, "light", "turn_off")
    token, _pass_id, _profile = await make_guest(
        runtime, entities={"light.room": {}, "light.desk": {}}
    )
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    result = await _call(
        ws,
        1,
        domain="light",
        service="turn_off",
        entity_id=["light.room", "light.desk", "light.room"],
    )
    assert result["success"] is True
    assert len(calls) == 1
    assert calls[0].data == {"entity_id": ["light.room", "light.desk"]}
    await ws.close()


async def test_light_colour_checked_against_the_entity(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    """Colour needs the profile capability and a colour mode of the light itself."""
    hass.states.async_set(
        "light.room",
        "on",
        {
            "supported_color_modes": ["hs"],
            "supported_features": 4,
            "effect_list": ["candle"],
        },
    )
    hass.states.async_set(
        "light.plain", "on", {"supported_color_modes": ["brightness"]}
    )
    calls = async_mock_service(hass, "light", "turn_on")
    token, _pass_id, profile_id = await make_guest(
        runtime, entities={"light.room": {}, "light.plain": {}}
    )
    runtime.store.model.data["profiles"][profile_id]["capabilities"] = {
        "allow_color": True,
        "allow_effects": True,
    }
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    ok = await _call(
        ws,
        1,
        domain="light",
        service="turn_on",
        entity_id="light.room",
        data={"hs_color": [20, 80]},
    )
    assert ok["success"] is True
    ok = await _call(
        ws,
        2,
        domain="light",
        service="turn_on",
        entity_id="light.room",
        data={"effect": "candle"},
    )
    assert ok["success"] is True
    bad = await _call(
        ws,
        3,
        domain="light",
        service="turn_on",
        entity_id="light.plain",
        data={"hs_color": [20, 80]},
    )
    assert bad["error"]["code"] == "feature_unsupported"
    bad = await _call(
        ws,
        4,
        domain="light",
        service="turn_on",
        entity_id="light.room",
        data={"effect": "strobe"},
    )
    assert bad["error"]["code"] == "out_of_range"
    assert [c.data for c in calls] == [
        {"entity_id": "light.room", "hs_color": [20.0, 80.0]},
        {"entity_id": "light.room", "effect": "candle"},
    ]
    await ws.close()


async def test_browse_and_play_media_rules(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    """Browse/search need media_browse; play_media only ids this pass was given."""
    seed_states(hass)
    hass.states.async_set(
        "media_player.speaker", "idle", {"supported_features": 0x7FFFFF}
    )
    play = async_mock_service(hass, "media_player", "play_media")
    token, _pass_id, profile_id = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)

    # capability off (default for every profile)
    await ws.send_json(
        {"id": 1, "type": "browse_media", "entity_id": "media_player.speaker"}
    )
    assert (await recv(ws))["error"]["code"] == "capability_disabled"

    runtime.store.model.data["profiles"][profile_id]["capabilities"] = {
        "media_browse": True
    }
    # a player outside the profile
    await ws.send_json(
        {"id": 2, "type": "browse_media", "entity_id": "media_player.other"}
    )
    assert (await recv(ws))["error"]["code"] == "entity_not_allowed"
    # below the root only with an id this pass got before
    await ws.send_json(
        {
            "id": 3,
            "type": "browse_media",
            "entity_id": "media_player.speaker",
            "media_content_type": "library",
            "media_content_id": "library://artists",
        }
    )
    assert (await recv(ws))["error"]["code"] == "bad_request"
    # arbitrary and URL-like ids are never played
    for i, cid in enumerate(
        ["library://track/1", "http://evil.example/a.mp3"], start=4
    ):
        result = await _call(
            ws,
            i,
            domain="media_player",
            service="play_media",
            entity_id="media_player.speaker",
            data={"media_content_type": "music", "media_content_id": cid},
        )
        assert result["success"] is False
    assert play == []
    await ws.close()


async def test_denied_calls_never_reach_hass(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    seed_states(hass)
    light = async_mock_service(hass, "light", "turn_on")
    climate = async_mock_service(hass, "climate", "set_temperature")
    lock = async_mock_service(hass, "lock", "unlock")
    cover = async_mock_service(hass, "cover", "open_cover")
    token, _pass_id, profile_id = await make_guest(runtime)

    # tamper with storage: a lock and the garage cover slipped into the profile
    profile = runtime.store.model.data["profiles"][profile_id]
    profile["entities"]["lock.front_door"] = {
        "services": ["lock.unlock"],
        "limits": {},
        "read_only": False,
    }
    profile["entities"]["cover.garage"] = {
        "services": ["cover.open_cover"],
        "limits": {},
        "read_only": False,
    }

    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    cases = [
        (
            {"domain": "light", "service": "turn_on", "entity_id": "light.other_room"},
            "entity_not_allowed",
        ),
        (
            {
                "domain": "light",
                "service": "turn_on",
                "entity_id": "light.room",
                "data": {"kelvin": 3000},
            },
            "field_not_allowed",
        ),
        (
            # list target (light group): one light outside the profile rejects all
            {
                "domain": "light",
                "service": "turn_on",
                "entity_id": ["light.room", "light.other_room"],
            },
            "entity_not_allowed",
        ),
        (
            {
                "domain": "light",
                "service": "turn_on",
                "entity_id": "light.room",
                "data": {"hs_color": [20, 80]},
            },
            "capability_disabled",
        ),
        (
            {
                "domain": "light",
                "service": "turn_on",
                "entity_id": "light.room",
                "target": {"area_id": "x"},
            },
            "bad_request",
        ),
        ({"domain": "light", "service": "turn_on", "entity_id": "all"}, "bad_request"),
        (
            {
                "domain": "climate",
                "service": "set_temperature",
                "entity_id": "climate.room",
                "data": {"temperature": 30},
            },
            "out_of_range",
        ),
        (
            {"domain": "lock", "service": "unlock", "entity_id": "lock.front_door"},
            "domain_denied",
        ),
        (
            {"domain": "cover", "service": "open_cover", "entity_id": "cover.garage"},
            "device_class_denied",
        ),
    ]
    for i, (msg, reason) in enumerate(cases, start=1):
        result = await _call(ws, i, **msg)
        assert result["success"] is False, msg
        assert result["error"]["code"] == reason, msg

    assert light == [] and climate == [] and lock == [] and cover == []
    denied = [
        e for e in runtime.store.model.data["audit"] if e["event"] == "call_denied"
    ]
    assert {e["reason"] for e in denied} >= {
        "entity_not_allowed",
        "out_of_range",
        "domain_denied",
    }
    assert not any("state" in e for e in denied)
    await ws.close()


async def test_call_rate_limit(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    calls = async_mock_service(hass, "light", "toggle")
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    codes = []
    for i in range(30):
        result = await _call(
            ws, i + 1, domain="light", service="toggle", entity_id="light.room"
        )
        codes.append(result.get("error", {}).get("code"))
    assert "rate_limited" in codes
    # burst 20, plus what refills (5/s) while the loop runs
    assert len(calls) <= 25
    await ws.close()


async def test_media_image_proxied_without_token(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    await recv(ws)
    await ws.send_json(
        {"id": 1, "type": "media_image", "entity_id": "media_player.elsewhere"}
    )
    assert (await recv(ws))["error"]["code"] == "entity_not_allowed"
    await ws.send_json({"id": 2, "type": "media_image", "entity_id": "light.room"})
    assert (await recv(ws))["error"]["code"] == "entity_not_allowed"
    # allowed entity, but no media_player integration loaded in this test
    await ws.send_json(
        {"id": 3, "type": "media_image", "entity_id": "media_player.speaker"}
    )
    assert (await recv(ws))["error"]["code"] == "not_found"
    await ws.close()


async def test_guest_token_is_not_an_ha_token(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "websocket_api", {})
    assert await async_setup_component(hass, "api", {})
    token, _pass_id, _profile = await make_guest(runtime)
    client = await hass_client_no_auth()
    ws = await client.ws_connect("/api/websocket")
    assert (await recv(ws))["type"] == "auth_required"
    await ws.send_json({"type": "auth", "access_token": token})
    assert (await recv(ws))["type"] == "auth_invalid"

    resp = await client.get("/api/states", headers={"Authorization": f"Bearer {token}"})
    assert resp.status == 401


async def test_ws_url_constant() -> None:
    assert WS_URL == "/api/guest_ha_dashboard/ws"
