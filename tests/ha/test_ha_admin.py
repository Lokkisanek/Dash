"""Admin websocket commands for guest passes."""

from __future__ import annotations

import json
from typing import Any

from ha_helpers import DOMAIN, ROOM_ENTITIES, seed_states
import pytest

from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er

ADMIN_COMMANDS = [
    {"type": f"{DOMAIN}/guests/info"},
    {"type": f"{DOMAIN}/guests/entities"},
    {"type": f"{DOMAIN}/profile/list"},
    {"type": f"{DOMAIN}/profile/save", "profile": {"name": "x", "entities": {}}},
    {"type": f"{DOMAIN}/profile/delete", "profile_id": "a" * 32},
    {"type": f"{DOMAIN}/profile/from_area", "area_id": "kitchen"},
    {"type": f"{DOMAIN}/pass/list"},
    {
        "type": f"{DOMAIN}/pass/create",
        "profile_id": "a" * 32,
        "label": "x",
        "kind": "tablet",
    },
    {"type": f"{DOMAIN}/pass/revoke", "pass_id": "a" * 32},
    {"type": f"{DOMAIN}/pass/extend", "pass_id": "a" * 32, "valid_until": None},
    {"type": f"{DOMAIN}/pass/delete", "pass_id": "a" * 32},
    {"type": f"{DOMAIN}/pass/new_code", "pass_id": "a" * 32},
    {"type": f"{DOMAIN}/audit/list"},
]


@pytest.mark.parametrize("command", ADMIN_COMMANDS, ids=lambda c: c["type"])
async def test_non_admin_is_rejected(
    hass: HomeAssistant,
    runtime: Any,
    hass_ws_client: Any,
    hass_read_only_access_token: str,
    command: dict,
) -> None:
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id(dict(command))
    msg = await client.receive_json()
    assert msg["success"] is False
    assert msg["error"]["code"] == "unauthorized"


async def test_admin_flow(
    hass: HomeAssistant, runtime: Any, hass_ws_client: Any
) -> None:
    seed_states(hass)
    client = await hass_ws_client(hass)

    async def send(**msg: Any) -> dict:
        await client.send_json_auto_id(msg)
        return await client.receive_json()

    info = await send(type=f"{DOMAIN}/guests/info")
    assert "lock" in info["result"]["denied_domains"]

    entities = {
        e["entity_id"]: e
        for e in (await send(type=f"{DOMAIN}/guests/entities"))["result"]["entities"]
    }
    assert entities["lock.front_door"]["selectable"] is False
    assert entities["lock.front_door"]["reason"] == "domain_denied"
    assert entities["cover.garage"]["reason"] == "device_class_denied"
    assert entities["light.room"]["selectable"] is True

    bad = await send(
        type=f"{DOMAIN}/profile/save",
        profile={"name": "x", "entities": {"lock.front_door": {}}},
    )
    assert bad["success"] is False and bad["error"]["code"] == "domain_denied"

    saved = await send(
        type=f"{DOMAIN}/profile/save",
        profile={"name": "Pokoj 3", "entities": ROOM_ENTITIES},
    )
    profile_id = saved["result"]["profile"]["id"]

    created = await send(
        type=f"{DOMAIN}/pass/create",
        profile_id=profile_id,
        label="Pokoj 3 - Novák",
        kind="phone",
        valid_until="2099-01-01T11:00:00+00:00",
    )
    assert created["success"], created
    pass_id = created["result"]["pass"]["id"]
    code = created["result"]["pairing"]["code"]
    assert len(code) == 14

    listing = await send(type=f"{DOMAIN}/pass/list")
    text = json.dumps(listing)
    assert "token_hash" not in text and code not in text
    assert listing["result"]["passes"][0]["status"] == "active"

    renewed = await send(type=f"{DOMAIN}/pass/new_code", pass_id=pass_id)
    assert renewed["result"]["pairing"]["code"] != code

    in_use = await send(type=f"{DOMAIN}/profile/delete", profile_id=profile_id)
    assert in_use["error"]["code"] == "profile_in_use"

    revoked = await send(type=f"{DOMAIN}/pass/revoke", pass_id=pass_id)
    assert revoked["result"]["pass"]["status"] == "revoked"

    audit = await send(type=f"{DOMAIN}/audit/list")
    events = [e["event"] for e in audit["result"]["entries"]]
    assert events[0] == "pass_revoked"
    assert "pass_created" in events

    deleted = await send(type=f"{DOMAIN}/pass/delete", pass_id=pass_id)
    assert deleted["success"]
    assert (await send(type=f"{DOMAIN}/profile/delete", profile_id=profile_id))[
        "success"
    ]


async def test_profile_from_area(
    hass: HomeAssistant, runtime: Any, hass_ws_client: Any
) -> None:
    area = ar.async_get(hass).async_create("Pokoj 3")
    reg = er.async_get(hass)
    light = reg.async_get_or_create("light", "test", "l1", suggested_object_id="pokoj3")
    lock = reg.async_get_or_create("lock", "test", "k1", suggested_object_id="pokoj3")
    diag = reg.async_get_or_create(
        "sensor",
        "test",
        "s1",
        suggested_object_id="diag",
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    for entry in (light, lock, diag):
        reg.async_update_entity(entry.entity_id, area_id=area.id)

    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/profile/from_area", "area_id": area.id}
    )
    msg = await client.receive_json()
    assert msg["success"], msg
    suggestion = msg["result"]
    assert suggestion["profile"]["name"] == "Pokoj 3"
    assert set(suggestion["profile"]["entities"]) == {light.entity_id}
    assert {"entity_id": lock.entity_id, "reason": "domain_denied"} in suggestion[
        "skipped"
    ]
    # nothing is saved yet
    assert runtime.store.model.data["profiles"] == {}


async def test_storage_survives_reload(
    hass: HomeAssistant, runtime: Any, hass_storage: dict
) -> None:
    from ha_helpers import make_guest

    token, pass_id, _profile = await make_guest(runtime)
    stored = hass_storage[f"{DOMAIN}.guests"]
    assert stored["version"] == 1
    assert token not in json.dumps(stored)

    from custom_components.guest_ha_dashboard.guest_store import GuestStore

    fresh = GuestStore(hass)
    await fresh.async_load()
    assert fresh.model.find_by_token(token)["id"] == pass_id
