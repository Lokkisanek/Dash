"""Videotéka in Home Assistant: owner websocket commands, activity hub, events.

Services and credentials: admin only; a command returns `{configured, url}`,
never a key. Everything else needs an HA login (owner mode of the dashboard).
Guests use guest_ws.py with library/guest_rules.py.
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable
import contextlib
from datetime import timedelta
import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import persistent_notification, websocket_api
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval

from .const import DOMAIN
from .library.client import ServiceError
from .library.config import defaults_for, normalize_library

_LOGGER = logging.getLogger(__name__)

EVENT_REQUEST = f"{DOMAIN}_library_request"
MEDIA = vol.In(("movie", "tv"))


def _svc(hass: HomeAssistant):
    return hass.data[DOMAIN]["library"]


def _config(hass: HomeAssistant) -> dict:
    return hass.data[DOMAIN]["store"].data


class ActivityHub:
    """Polls downloads only while at least one client listens; then stops."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._subs: dict[int, tuple[bool, Callable[[list], None]]] = {}
        self._seq = 0
        self._task: asyncio.Task | None = None

    def subscribe(
        self, guest: bool, push: Callable[[list], None]
    ) -> Callable[[], None]:
        self._seq += 1
        sid = self._seq
        self._subs[sid] = (guest, push)
        if self._task is None or self._task.done():
            self._task = self._hass.async_create_background_task(
                self._run(), f"{DOMAIN} library activity"
            )

        def _unsub() -> None:
            self._subs.pop(sid, None)
            if not self._subs and self._task is not None:
                self._task.cancel()
                self._task = None

        return _unsub

    async def _run(self) -> None:
        service = _svc(self._hass)
        while self._subs:
            interval = normalize_library(_config(self._hass).get("library"))["interval"]
            try:
                owner = guest = None
                if any(not g for g, _ in self._subs.values()):
                    owner = await service.activity()
                if any(g for g, _ in self._subs.values()):
                    guest = await service.activity(guest=True)
                for is_guest, push in list(self._subs.values()):
                    push(guest if is_guest else owner)
            except ServiceError as err:
                for _g, push in list(self._subs.values()):
                    push({"error": err.code})
            await asyncio.sleep(interval)

    def stop(self) -> None:
        self._subs.clear()
        if self._task is not None:
            self._task.cancel()


def fire_request(hass: HomeAssistant, request: dict) -> None:
    """HA event + persistent notification for a new guest request (no secrets)."""
    data = {
        "request_id": request["id"],
        "tmdb_id": request["tmdbId"],
        "media_type": request["mediaType"],
        "title": request["title"],
        "year": request["year"],
        "requester": request["requester"],
    }
    hass.bus.async_fire(EVENT_REQUEST, data)
    persistent_notification.async_create(
        hass,
        f"{request['requester'] or 'Host'} žádá o: {request['title']}"
        + (f" ({request['year']})" if request.get("year") else "")
        + ". Videotéka → Žádosti.",
        title="dash · Videotéka",
        notification_id=f"{DOMAIN}_library_{request['id']}",
    )


def async_register_library_ws(hass: HomeAssistant) -> None:
    for handler in (
        ws_services,
        ws_set_service,
        ws_test,
        ws_options,
        ws_discover,
        ws_search,
        ws_detail,
        ws_request,
        ws_releases,
        ws_grab,
        ws_close_picker,
        ws_activity,
        ws_torrent,
        ws_requests,
        ws_request_update,
        ws_poster,
    ):
        websocket_api.async_register_command(hass, handler)


async def _run(connection, msg_id, coro) -> None:
    try:
        result = await coro
    except ServiceError as err:
        connection.send_error(msg_id, err.code, err.code)
        return
    connection.send_result(msg_id, result)


def _enabled(hass, connection, msg) -> bool:
    if normalize_library(_config(hass).get("library"))["enabled"]:
        return True
    connection.send_error(msg["id"], "library_disabled", "library_disabled")
    return False


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/library/services"})
@websocket_api.require_admin
@callback
def ws_services(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], _svc(hass).services_status())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/set_service",
        vol.Required("service"): vol.In(("tmdb", "radarr", "sonarr", "qbittorrent")),
        vol.Optional("url"): str,
        vol.Optional("api_key"): str,
        vol.Optional("username"): str,
        vol.Optional("password"): str,
        vol.Optional("remove"): bool,
    }
)
@websocket_api.require_admin
@callback
def ws_set_service(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    fields = {
        k: msg[k]
        for k in ("url", "api_key", "username", "password", "remove")
        if k in msg
    }
    try:
        connection.send_result(
            msg["id"], _svc(hass).set_service(msg["service"], fields)
        )
    except ServiceError as err:
        connection.send_error(msg["id"], err.code, err.code)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/test",
        vol.Required("service"): vol.In(("tmdb", "radarr", "sonarr", "qbittorrent")),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_test(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    await _run(connection, msg["id"], _svc(hass).test(msg["service"]))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/options",
        vol.Required("service"): vol.In(("radarr", "sonarr")),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_options(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    await _run(connection, msg["id"], _svc(hass).options(msg["service"]))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/discover",
        vol.Optional("media", default="all"): vol.In(("all", "movie", "tv")),
    }
)
@websocket_api.async_response
async def ws_discover(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if _enabled(hass, connection, msg):

        async def _do() -> dict:
            return {"items": await _svc(hass).discover(msg["media"])}

        await _run(connection, msg["id"], _do())


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/library/search", vol.Required("query"): str}
)
@websocket_api.async_response
async def ws_search(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if _enabled(hass, connection, msg):

        async def _do() -> dict:
            return {"items": await _svc(hass).search(msg["query"])}

        await _run(connection, msg["id"], _do())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/detail",
        vol.Required("media_type"): MEDIA,
        vol.Required("tmdb_id"): int,
    }
)
@websocket_api.async_response
async def ws_detail(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if _enabled(hass, connection, msg):
        await _run(
            connection, msg["id"], _svc(hass).detail(msg["media_type"], msg["tmdb_id"])
        )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/request",
        vol.Required("media_type"): MEDIA,
        vol.Required("tmdb_id"): int,
        vol.Optional("quality_profile_id"): int,
        vol.Optional("root_folder"): str,
    }
)
@websocket_api.async_response
async def ws_request(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """'Automaticky': add monitored and let the Arr search."""
    if not _enabled(hass, connection, msg):
        return
    profile, root = defaults_for(_config(hass), msg["media_type"])
    await _run(
        connection,
        msg["id"],
        _svc(hass).request_auto(
            msg["media_type"],
            msg["tmdb_id"],
            msg.get("quality_profile_id", profile),
            msg.get("root_folder", root),
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/releases",
        vol.Required("media_type"): MEDIA,
        vol.Required("tmdb_id"): int,
        vol.Optional("quality_profile_id"): int,
        vol.Optional("root_folder"): str,
        vol.Optional("season"): int,
        vol.Optional("episode_id"): int,
    }
)
@websocket_api.async_response
async def ws_releases(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if not _enabled(hass, connection, msg):
        return
    profile, root = defaults_for(_config(hass), msg["media_type"])
    await _run(
        connection,
        msg["id"],
        _svc(hass).releases(
            msg["media_type"],
            msg["tmdb_id"],
            msg.get("quality_profile_id", profile),
            msg.get("root_folder", root),
            season=msg.get("season"),
            episode_id=msg.get("episode_id"),
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/grab",
        vol.Required("media_type"): MEDIA,
        vol.Required("tmdb_id"): int,
        vol.Required("guid"): str,
        vol.Required("indexer_id"): int,
        vol.Optional("request_id"): str,
    }
)
@websocket_api.async_response
async def ws_grab(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if not _enabled(hass, connection, msg):
        return
    service = _svc(hass)

    async def _do() -> dict:
        result = await service.grab(
            msg["media_type"], msg["tmdb_id"], msg["guid"], msg["indexer_id"]
        )
        if msg.get("request_id"):
            service.inbox.set_status(msg["request_id"], "downloading")
        return result

    await _run(connection, msg["id"], _do())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/close_picker",
        vol.Required("media_type"): MEDIA,
        vol.Required("tmdb_id"): int,
    }
)
@websocket_api.async_response
async def ws_close_picker(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    async def _do() -> dict:
        await _svc(hass).close_picker(msg["media_type"], msg["tmdb_id"])
        return {}

    await _run(connection, msg["id"], _do())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/library/activity"})
@callback
def ws_activity(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Subscription: download list every few seconds while subscribed."""
    if not _enabled(hass, connection, msg):
        return

    @callback
    def _push(items: Any) -> None:
        connection.send_event(
            msg["id"], {"items": items} if isinstance(items, list) else items
        )

    connection.subscriptions[msg["id"]] = hass.data[DOMAIN][
        "library_activity"
    ].subscribe(False, _push)
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/torrent",
        vol.Required("action"): vol.In(("pause", "resume", "delete", "recheck")),
        vol.Required("hash"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_torrent(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    async def _do() -> dict:
        await _svc(hass).torrent(msg["action"], msg["hash"])
        return {}

    await _run(connection, msg["id"], _do())


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/library/requests"})
@websocket_api.async_response
async def ws_requests(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    service = _svc(hass)
    items = [service.inbox.public(r, guest=False) for r in service.inbox.list()]
    connection.send_result(
        msg["id"], {"items": items, "pending": service.inbox.pending_count()}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/library/request_update",
        vol.Required("request_id"): str,
        vol.Required("action"): vol.In(("approve", "decline")),
        vol.Optional("note", default=""): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_request_update(
    hass: HomeAssistant, connection, msg: dict[str, Any]
) -> None:
    service = _svc(hass)
    rec = service.inbox.get(msg["request_id"])
    if rec is None:
        connection.send_error(msg["id"], "not_found", "not_found")
        return

    async def _do() -> dict:
        if msg["action"] == "decline":
            service.inbox.set_status(rec["id"], "declined", msg["note"])
        else:
            profile, root = defaults_for(_config(hass), rec["mediaType"])
            await service.request_auto(rec["mediaType"], rec["tmdbId"], profile, root)
            service.inbox.set_status(rec["id"], "approved", msg["note"])
        persistent_notification.async_dismiss(hass, f"{DOMAIN}_library_{rec['id']}")
        return service.inbox.public(service.inbox.get(rec["id"]), guest=False)

    await _run(connection, msg["id"], _do())


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/library/poster", vol.Required("poster"): str}
)
@websocket_api.async_response
async def ws_poster(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    async def _do() -> dict:
        data, mime = await _svc(hass).posters.fetch(msg["poster"])
        return {"mime": mime, "data": base64.b64encode(data).decode("ascii")}

    await _run(connection, msg["id"], _do())


def async_setup_cleanup(hass: HomeAssistant, entry) -> None:
    """Ghosts: all at start-up, then the 15-minute ones every 5 minutes.

    The timer stops on unload and when Home Assistant stops.
    """
    service = _svc(hass)

    async def _startup() -> None:
        with contextlib.suppress(ServiceError):
            await service.cleanup(everything=True)

    entry.async_create_background_task(
        hass, _startup(), f"{DOMAIN} library start-up cleanup"
    )

    async def _tick(_now: Any) -> None:
        try:
            await service.cleanup()
        except ServiceError as err:
            _LOGGER.debug("library ghost cleanup: %s", err.code)

    cancel = async_track_time_interval(hass, _tick, timedelta(minutes=5))
    entry.async_on_unload(cancel)
    entry.async_on_unload(
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, lambda _e: cancel())
    )
