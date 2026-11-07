"""StandBy photo commands of the owner websocket API."""

from __future__ import annotations

import base64
from typing import Any

from ha_helpers import DOMAIN, guest_connect, make_guest, recv
import pytest

from homeassistant.core import HomeAssistant

JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\0" * 64).decode()
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 32).decode()


@pytest.fixture(autouse=True)
def photos_in_tmp(hass: HomeAssistant, tmp_path: Any) -> None:
    """The test config dir is shared between tests; keep photos per test."""
    hass.config.config_dir = str(tmp_path)


async def _send(client: Any, **msg: Any) -> dict:
    await client.send_json_auto_id(msg)
    return await client.receive_json()


async def test_upload_list_get_delete(
    hass: HomeAssistant, runtime: Any, hass_ws_client: Any
) -> None:
    """The photo id travels as `photo_id`; `id` stays the message id."""
    client = await hass_ws_client(hass)
    up = await _send(client, type=f"{DOMAIN}/photo_upload", data=JPEG, thumb=PNG)
    assert up["success"], up
    photo_id = up["result"]["id"]

    listed = await _send(client, type=f"{DOMAIN}/photo_list")
    assert listed["result"]["photos"] == [photo_id]

    full = await _send(client, type=f"{DOMAIN}/photo_get", photo_id=photo_id)
    assert full["success"], full
    assert full["result"]["mime"] == "image/jpeg"
    assert full["result"]["data"] == JPEG

    thumb = await _send(
        client, type=f"{DOMAIN}/photo_get", photo_id=photo_id, thumb=True
    )
    assert thumb["result"]["mime"] == "image/png"

    gone = await _send(client, type=f"{DOMAIN}/photo_delete", photo_id=photo_id)
    assert gone["success"], gone
    listed = await _send(client, type=f"{DOMAIN}/photo_list")
    assert listed["result"]["photos"] == []
    missing = await _send(client, type=f"{DOMAIN}/photo_get", photo_id=photo_id)
    assert missing["error"]["code"] == "not_found"


async def test_photo_id_is_validated(
    hass: HomeAssistant, runtime: Any, hass_ws_client: Any
) -> None:
    client = await hass_ws_client(hass)
    for bad in ("../../secrets", "A" * 32, "x"):
        msg = await _send(client, type=f"{DOMAIN}/photo_get", photo_id=bad)
        assert msg["success"] is False
        assert msg["error"]["code"] == "invalid_format"


async def test_non_admin_reads_but_cannot_write(
    hass: HomeAssistant,
    runtime: Any,
    hass_ws_client: Any,
    hass_read_only_access_token: str,
) -> None:
    admin = await hass_ws_client(hass)
    up = await _send(admin, type=f"{DOMAIN}/photo_upload", data=JPEG, thumb=JPEG)
    photo_id = up["result"]["id"]

    user = await hass_ws_client(hass, hass_read_only_access_token)
    listed = await _send(user, type=f"{DOMAIN}/photo_list")
    assert listed["result"]["photos"] == [photo_id]
    got = await _send(user, type=f"{DOMAIN}/photo_get", photo_id=photo_id)
    assert got["success"], got

    for msg in (
        {"type": f"{DOMAIN}/photo_upload", "data": JPEG, "thumb": JPEG},
        {"type": f"{DOMAIN}/photo_delete", "photo_id": photo_id},
    ):
        res = await _send(user, **msg)
        assert res["error"]["code"] == "unauthorized"


async def test_rejects_non_images(
    hass: HomeAssistant, runtime: Any, hass_ws_client: Any
) -> None:
    client = await hass_ws_client(hass)
    text = base64.b64encode(b"hello").decode()
    res = await _send(client, type=f"{DOMAIN}/photo_upload", data=text, thumb=text)
    assert res["error"]["code"] == "invalid_image"


@pytest.mark.parametrize("expected_lingering_timers", [True])
async def test_guest_pass_reads_photos(
    hass: HomeAssistant,
    runtime: Any,
    hass_ws_client: Any,
    hass_client_no_auth: Any,
) -> None:
    """The guest socket lists and serves the same photos, by `photo_id`."""
    admin = await hass_ws_client(hass)
    up = await _send(admin, type=f"{DOMAIN}/photo_upload", data=JPEG, thumb=JPEG)
    photo_id = up["result"]["id"]

    token, _pass_id, _profile = await make_guest(runtime)
    ws = await guest_connect(await hass_client_no_auth(), token)
    assert (await recv(ws))["type"] == "auth_ok"
    await ws.send_json({"id": 1, "type": "photo_list"})
    assert (await recv(ws))["result"] == {"photos": [photo_id]}
    await ws.send_json({"id": 2, "type": "photo_get", "photo_id": photo_id})
    got = await recv(ws)
    assert got["result"]["data"] == JPEG
    await ws.send_json({"id": 3, "type": "photo_get", "photo_id": "../secrets"})
    assert (await recv(ws))["error"]["code"] == "bad_request"
    await ws.close()
