"""Dashboard config store: migrations to v3, tile validation, round trip."""

from __future__ import annotations

import logging
from typing import Any

from ha_helpers import DOMAIN
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant

STORAGE_KEY = f"{DOMAIN}.config"

# A config as 2.0 stored it: no configVersion, legacy `rooms`, no general/standby.
V1 = {
    "guestInfo": {"wifiSsid": "Chata", "wifiPassword": "tajne", "wifiSecurity": "WPA"},
    "rooms": [
        {
            "id": "obyvak",
            "label": "Obývák",
            "haAreaId": "living_room",
            "devices": [
                {"id": "light.lamp", "type": "light", "style": "slider", "size": "4x1"},
                {"id": "lock.door", "type": "lock"},
                {"id": "", "type": "switch", "label": "Bez entity"},
                {"id": "cover.blinds", "type": "cover", "style": "dial"},
            ],
        }
    ],
    "dock": [{"roomId": "obyvak", "icon": "Sofa"}],
    "dashboardUrl": "https://dash.example.com",
}


@pytest.fixture
def stored_v1(hass_storage: dict[str, Any]) -> None:
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "minor_version": 1,
        "key": STORAGE_KEY,
        "data": V1,
    }


async def test_v1_is_migrated_on_load(
    hass: HomeAssistant,
    stored_v1: None,
    setup_integration: MockConfigEntry,
    caplog: pytest.LogCaptureFixture,
) -> None:
    data = hass.data[DOMAIN]["store"].data
    assert data["configVersion"] == 3
    assert "rooms" not in data
    page = data["pages"][0]
    assert page["id"] == "obyvak"
    assert "haAreaId" not in page
    # no `general` in v1: the old defaults showed the header, so it is now a tile
    header, *devices = page["devices"]
    assert header["type"] == "header"
    assert header["showTime"] is True and header["showWifi"] is True
    assert [d["type"] for d in devices] == ["light", "switch", "cover"]
    assert devices[0]["style"] == "slider"
    assert devices[0]["size"] == "4x1"
    assert devices[1]["id"] == ""  # tile without entity is kept
    assert (devices[2]["style"], devices[2]["size"]) == ("tile", "2x2")
    assert data["dock"] == [
        {"pageId": "obyvak", "label": "", "showLabel": True, "icon": "Sofa"}
    ]
    # missing sections come back with defaults; header switches are gone
    assert data["general"] == {"use24h": True, "statusBarStrip": False}
    assert data["standby"] == {
        "enabled": False,
        "idleMinutes": 2,
        "mode": "clock",
        "clockStyle": "bold",
        "photoSeconds": 8,
    }
    assert any(
        r.levelno == logging.WARNING and "unknown type" in r.getMessage()
        for r in caplog.get_records("setup") + caplog.records
    )


async def test_save_validates_and_round_trips(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: Any,
    hass_storage: dict[str, Any],
) -> None:
    client = await hass_ws_client(hass)
    config = {
        "configVersion": 3,
        "pages": [
            {
                "id": "p1",
                "label": "Stránka",
                "devices": [
                    {"id": "media_player.tv", "type": "media_player", "size": "4x4"},
                    {"id": "x.y", "type": "toaster"},
                ],
            }
        ],
        "standby": {"enabled": True, "mode": "photos", "photoSeconds": 15},
    }
    await client.send_json_auto_id({"type": f"{DOMAIN}/set_config", "config": config})
    saved = (await client.receive_json())["result"]
    assert saved["configVersion"] == 3
    assert saved["pages"][0]["devices"] == [
        {
            "id": "media_player.tv",
            "type": "media_player",
            "style": "tile",
            "size": "4x2",
            "outputs": [],  # tile option since 2.1.0-beta.3
        }
    ]
    assert saved["standby"]["mode"] == "photos"
    assert saved["standby"]["photoSeconds"] == 15
    await hass.async_block_till_done()
    assert hass_storage[STORAGE_KEY]["data"] == saved

    # saving the saved config again changes nothing
    await client.send_json_auto_id({"type": f"{DOMAIN}/set_config", "config": saved})
    again = (await client.receive_json())["result"]
    assert again == saved

    await client.send_json_auto_id({"type": f"{DOMAIN}/get_config"})
    assert (await client.receive_json())["result"] == saved


async def test_fresh_install_has_current_version(
    hass: HomeAssistant, setup_integration: MockConfigEntry
) -> None:
    assert hass.data[DOMAIN]["store"].data["configVersion"] == 3


async def test_v2_header_settings_become_a_tile_on_save(
    hass: HomeAssistant,
    setup_integration: MockConfigEntry,
    hass_ws_client: Any,
) -> None:
    """A 2.1.0-beta panel still sends the header switches in `general`."""
    client = await hass_ws_client(hass)
    config = {
        "configVersion": 2,
        "general": {
            "showTopBar": True,
            "showWelcome": False,
            "showTime": True,
            "showDate": False,
            "showWifi": True,
            "showTemperature": False,
            "showHumidity": True,
            "weatherEntity": "weather.home",
            "use24h": False,
        },
        "pages": [{"id": "p1", "devices": [{"id": "light.a", "type": "light"}]}],
    }
    await client.send_json_auto_id({"type": f"{DOMAIN}/set_config", "config": config})
    saved = (await client.receive_json())["result"]
    assert saved["configVersion"] == 3
    assert saved["general"] == {"use24h": False, "statusBarStrip": False}
    header, light = saved["pages"][0]["devices"]
    assert light["id"] == "light.a"
    assert header["type"] == "header"
    assert (header["showTime"], header["showDate"], header["showWifi"]) == (
        True,
        False,
        True,
    )
    assert (header["showGreeting"], header["showWeather"]) == (False, False)
    assert header["entity"] == "weather.home"

    # saving again does not add a second header
    await client.send_json_auto_id({"type": f"{DOMAIN}/set_config", "config": saved})
    again = (await client.receive_json())["result"]
    assert again == saved
