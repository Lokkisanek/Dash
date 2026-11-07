"""WebSocket API for Guest HA Dashboard."""

from __future__ import annotations

import base64
import binascii
from pathlib import Path
from typing import Any
from uuid import uuid4

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, PHOTO_MAX_BYTES, PHOTOS_DIR, PHOTOS_MAX

# Photo ids are uuid4 hex. The field is called `photo_id`, not `id`: `id` is the
# websocket message id, which the client library always overwrites.
PHOTO_ID_SCHEMA = vol.All(str, vol.Match(r"^[a-f0-9]{32}$"))

# Magic bytes → mime. Anything else is rejected.
IMAGE_SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"RIFF", "image/webp"),
)


def async_register_ws(hass: HomeAssistant) -> None:
    """Register websocket commands."""
    websocket_api.async_register_command(hass, ws_get_config)
    websocket_api.async_register_command(hass, ws_set_config)
    websocket_api.async_register_command(hass, ws_subscribe_config)
    websocket_api.async_register_command(hass, ws_photo_list)
    websocket_api.async_register_command(hass, ws_photo_upload)
    websocket_api.async_register_command(hass, ws_photo_get)
    websocket_api.async_register_command(hass, ws_photo_delete)


def _photos_dir(hass: HomeAssistant) -> Path:
    # Outside /config/www on purpose: photos are only reachable through the
    # authenticated websocket, never as public /local/ files.
    return Path(hass.config.path(PHOTOS_DIR))


def _photo_path(hass: HomeAssistant, photo_id: str, thumb: bool) -> Path:
    return _photos_dir(hass) / f"{photo_id}{'_t' if thumb else ''}.img"


def _decode_image(data: str) -> bytes:
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as err:
        raise vol.Invalid("invalid base64") from err
    if len(raw) > PHOTO_MAX_BYTES:
        raise vol.Invalid("image too large")
    if not any(raw.startswith(sig) for sig, _ in IMAGE_SIGNATURES):
        raise vol.Invalid("unsupported image type")
    return raw


def _mime(raw: bytes) -> str:
    return next(
        (mime for sig, mime in IMAGE_SIGNATURES if raw.startswith(sig)), "image/jpeg"
    )


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


def _list_photos(hass: HomeAssistant) -> list[str]:
    folder = _photos_dir(hass)
    if not folder.is_dir():
        return []
    files = [p for p in folder.glob("*.img") if not p.stem.endswith("_t")]
    files.sort(key=lambda p: p.stat().st_mtime)
    return [p.stem for p in files]


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/photo_list"})
@websocket_api.async_response
async def ws_photo_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Ids of the standby photos, oldest first."""
    ids = await hass.async_add_executor_job(_list_photos, hass)
    connection.send_result(msg["id"], {"photos": ids})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/photo_upload",
        vol.Required("data"): str,
        vol.Required("thumb"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_photo_upload(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Store a standby photo (already resized by the panel) plus its thumbnail."""
    try:
        full = _decode_image(msg["data"])
        thumb = _decode_image(msg["thumb"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid_image", str(err))
        return

    photo_id = uuid4().hex

    def _write() -> int:
        _photos_dir(hass).mkdir(parents=True, exist_ok=True)
        count = len(_list_photos(hass))
        if count >= PHOTOS_MAX:
            return count
        _photo_path(hass, photo_id, False).write_bytes(full)
        _photo_path(hass, photo_id, True).write_bytes(thumb)
        return -1

    count = await hass.async_add_executor_job(_write)
    if count >= 0:
        connection.send_error(msg["id"], "too_many_photos", f"max {PHOTOS_MAX} photos")
        return
    connection.send_result(msg["id"], {"id": photo_id})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/photo_get",
        vol.Required("photo_id"): PHOTO_ID_SCHEMA,
        vol.Optional("thumb", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_photo_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return a photo as base64 to any signed-in user of this HA."""
    path = _photo_path(hass, msg["photo_id"], msg["thumb"])

    def _read() -> bytes | None:
        return path.read_bytes() if path.is_file() else None

    raw = await hass.async_add_executor_job(_read)
    if raw is None:
        connection.send_error(msg["id"], "not_found", "photo not found")
        return
    connection.send_result(
        msg["id"], {"mime": _mime(raw), "data": base64.b64encode(raw).decode("ascii")}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/photo_delete",
        vol.Required("photo_id"): PHOTO_ID_SCHEMA,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_photo_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Delete a standby photo."""

    def _delete() -> None:
        for thumb in (False, True):
            _photo_path(hass, msg["photo_id"], thumb).unlink(missing_ok=True)

    await hass.async_add_executor_job(_delete)
    connection.send_result(msg["id"])
