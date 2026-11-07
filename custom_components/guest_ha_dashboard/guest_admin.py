"""Admin websocket commands for guest passes (HA admins only)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)

from .const import (
    AUDIT_MAX_ENTRIES,
    CLOSE_REVOKED,
    DOMAIN,
    GUEST_DENIED_COVER_CLASSES,
    GUEST_DENIED_DOMAINS,
    GUEST_READ_ONLY_DOMAINS,
    GUEST_REQUIRED_LIMITS,
    GUEST_SERVICES,
    PAIR_CODE_TTL_SECONDS,
    PASS_DEFAULT_CHECKIN,
    PASS_DEFAULT_CHECKOUT,
    PASS_DEFAULT_NIGHTS,
    PASS_KINDS,
)
from .guest_model import GuestError
from .guest_policy import entity_selectability
from .guest_runtime import GuestRuntime, get_runtime

_ID = vol.All(str, vol.Match(r"^[a-f0-9]{32}$"))
_TIME = vol.Any(None, vol.All(str, vol.Length(max=40)))


def async_register_admin_ws(hass: HomeAssistant) -> None:
    """Register the admin commands."""
    for command in (
        ws_guests_info,
        ws_guests_entities,
        ws_profile_list,
        ws_profile_save,
        ws_profile_delete,
        ws_profile_from_area,
        ws_pass_list,
        ws_pass_create,
        ws_pass_revoke,
        ws_pass_extend,
        ws_pass_delete,
        ws_pass_new_code,
        ws_audit_list,
    ):
        websocket_api.async_register_command(hass, command)


def _runtime(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg_id: int
) -> GuestRuntime | None:
    runtime = get_runtime(hass)
    if runtime is None:
        connection.send_error(msg_id, "not_loaded", "dash is not loaded")
    return runtime


def _guest_error(
    connection: websocket_api.ActiveConnection, msg_id: int, err: GuestError
) -> None:
    connection.send_error(msg_id, err.code, err.detail or err.code)


# ─── info ────────────────────────────────────────────────────────────────────


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/guests/info"})
@websocket_api.require_admin
@callback
def ws_guests_info(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Tables and defaults the panel needs (no secrets)."""
    connection.send_result(
        msg["id"],
        {
            "kinds": list(PASS_KINDS),
            "defaults": {
                "checkin": PASS_DEFAULT_CHECKIN,
                "checkout": PASS_DEFAULT_CHECKOUT,
                "nights": PASS_DEFAULT_NIGHTS,
                "time_zone": hass.config.time_zone,
            },
            "pair_code_ttl": PAIR_CODE_TTL_SECONDS,
            "services": GUEST_SERVICES,
            "required_limits": GUEST_REQUIRED_LIMITS,
            "read_only_domains": list(GUEST_READ_ONLY_DOMAINS),
            "denied_domains": list(GUEST_DENIED_DOMAINS),
            "denied_cover_classes": list(GUEST_DENIED_COVER_CLASSES),
        },
    )


def _area_of(entry: er.RegistryEntry | None, devices: dr.DeviceRegistry) -> str | None:
    if entry is None:
        return None
    if entry.area_id:
        return entry.area_id
    if entry.device_id and (device := devices.async_get(entry.device_id)):
        return device.area_id
    return None


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/guests/entities"})
@websocket_api.require_admin
@callback
def ws_guests_entities(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Every entity with whether it can go into a profile, and why not."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    out = []
    for state in hass.states.async_all():
        info = entity_selectability(
            state.entity_id, runtime.device_classes(state.entity_id)
        )
        out.append(
            {
                "entity_id": state.entity_id,
                "name": state.attributes.get("friendly_name") or state.entity_id,
                "area_id": _area_of(entities.async_get(state.entity_id), devices),
                **info,
            }
        )
    connection.send_result(msg["id"], {"entities": out})


# ─── profiles ────────────────────────────────────────────────────────────────


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/profile/list"})
@websocket_api.require_admin
@callback
def ws_profile_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """All profiles."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    profiles = sorted(
        runtime.store.model.data["profiles"].values(), key=lambda p: p.get("name", "")
    )
    connection.send_result(msg["id"], {"profiles": profiles})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/profile/save", vol.Required("profile"): dict}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_profile_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Create or update a profile; live guests of it reconnect."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    try:
        profile = runtime.store.model.profile_save(
            msg["profile"], runtime.now(), runtime.device_classes
        )
    except GuestError as err:
        _guest_error(connection, msg["id"], err)
        return
    await runtime.store.async_save()
    runtime.close_profile(profile["id"])
    connection.send_result(msg["id"], {"profile": profile})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/profile/delete", vol.Required("profile_id"): _ID}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_profile_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Delete a profile that no pass uses."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    try:
        runtime.store.model.profile_delete(msg["profile_id"], runtime.now())
    except GuestError as err:
        _guest_error(connection, msg["id"], err)
        return
    await runtime.store.async_save()
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profile/from_area",
        vol.Required("area_id"): vol.All(str, vol.Length(min=1, max=100)),
    }
)
@websocket_api.require_admin
@callback
def ws_profile_from_area(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Suggest a profile from an area (not saved; the admin edits it first)."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    area = ar.async_get(hass).async_get_area(msg["area_id"])
    if area is None:
        connection.send_error(msg["id"], "not_found", "area")
        return

    entities = er.async_get(hass)
    entries = list(er.async_entries_for_area(entities, area.id))
    for device in dr.async_entries_for_area(dr.async_get(hass), area.id):
        entries.extend(
            entry
            for entry in er.async_entries_for_device(entities, device.id)
            if entry.area_id is None  # inherits the device's area
        )

    suggested: dict[str, Any] = {}
    skipped: list[dict[str, str]] = []
    for entry in entries:
        if entry.disabled or entry.hidden or entry.entity_category is not None:
            continue
        info = entity_selectability(
            entry.entity_id, runtime.device_classes(entry.entity_id)
        )
        if not info["selectable"]:
            skipped.append({"entity_id": entry.entity_id, "reason": info["reason"]})
            continue
        suggested[entry.entity_id] = {
            "services": info["services"],
            "limits": {},
            "read_only": info["read_only"],
        }
    connection.send_result(
        msg["id"],
        {
            "profile": {
                "name": area.name,
                "area_ids": [area.id],
                "entities": suggested,
                "show_wifi": True,
            },
            "skipped": skipped,
        },
    )


# ─── passes ──────────────────────────────────────────────────────────────────


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/pass/list"})
@websocket_api.require_admin
@callback
def ws_pass_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """All passes (no hashes)."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    connection.send_result(
        msg["id"], {"passes": runtime.store.model.list_passes(runtime.now())}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/pass/create",
        vol.Required("profile_id"): _ID,
        vol.Required("label"): vol.All(str, vol.Length(min=1, max=200)),
        vol.Required("kind"): vol.In(PASS_KINDS),
        vol.Optional("valid_from"): _TIME,
        vol.Optional("valid_until"): _TIME,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pass_create(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """New pass and its pairing code (the code is shown once)."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    try:
        pass_, code = runtime.store.model.pass_create(
            profile_id=msg["profile_id"],
            label=msg["label"],
            kind=msg["kind"],
            valid_from=msg.get("valid_from"),
            valid_until=msg.get("valid_until"),
            now=runtime.now(),
        )
    except GuestError as err:
        _guest_error(connection, msg["id"], err)
        return
    await runtime.store.async_save()
    connection.send_result(msg["id"], {"pass": pass_, "pairing": code})


def _pass_command(name: str, extra: dict | None = None) -> dict:
    return {
        vol.Required("type"): f"{DOMAIN}/pass/{name}",
        vol.Required("pass_id"): _ID,
        **(extra or {}),
    }


@websocket_api.websocket_command(_pass_command("revoke"))
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pass_revoke(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Revoke a pass; its devices are disconnected at once."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    try:
        pass_ = runtime.store.model.pass_revoke(msg["pass_id"], runtime.now())
    except GuestError as err:
        _guest_error(connection, msg["id"], err)
        return
    runtime.close_pass(msg["pass_id"], CLOSE_REVOKED, "revoked")
    await runtime.store.async_save()
    connection.send_result(msg["id"], {"pass": pass_})


@websocket_api.websocket_command(
    _pass_command("extend", {vol.Required("valid_until"): _TIME})
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pass_extend(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Move the end of a pass."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    try:
        pass_ = runtime.store.model.pass_extend(
            msg["pass_id"], msg["valid_until"], runtime.now()
        )
    except GuestError as err:
        _guest_error(connection, msg["id"], err)
        return
    runtime.pass_times_changed(msg["pass_id"])
    await runtime.store.async_save()
    connection.send_result(msg["id"], {"pass": pass_})


@websocket_api.websocket_command(_pass_command("delete"))
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pass_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Delete a pass; its devices are disconnected at once."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    try:
        runtime.store.model.pass_delete(msg["pass_id"], runtime.now())
    except GuestError as err:
        _guest_error(connection, msg["id"], err)
        return
    runtime.close_pass(msg["pass_id"], CLOSE_REVOKED, "revoked")
    await runtime.store.async_save()
    connection.send_result(msg["id"])


@websocket_api.websocket_command(_pass_command("new_code"))
@websocket_api.require_admin
@websocket_api.async_response
async def ws_pass_new_code(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Replace the pairing code of a pass (the old code stops working)."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    try:
        code = runtime.store.model.pass_new_code(msg["pass_id"], runtime.now())
    except GuestError as err:
        _guest_error(connection, msg["id"], err)
        return
    await runtime.store.async_save()
    connection.send_result(msg["id"], {"pairing": code})


# ─── audit ───────────────────────────────────────────────────────────────────


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/audit/list",
        vol.Optional("limit", default=AUDIT_MAX_ENTRIES): vol.All(
            int, vol.Range(min=1, max=AUDIT_MAX_ENTRIES)
        ),
    }
)
@websocket_api.require_admin
@callback
def ws_audit_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Latest audit entries, newest first."""
    if (runtime := _runtime(hass, connection, msg["id"])) is None:
        return
    log = runtime.store.model.data["audit"][-msg["limit"] :]
    connection.send_result(msg["id"], {"entries": list(reversed(log))})
