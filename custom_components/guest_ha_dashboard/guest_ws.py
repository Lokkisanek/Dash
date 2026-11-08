"""Restricted guest websocket: GET /api/guest_ha_dashboard/ws.

Not Home Assistant's /api/websocket: a guest never holds an HA token. The first
message must carry the guest token; afterwards only the commands below exist and
everything is filtered by the pass's profile (docs/GUEST_PASSES.md).
"""

from __future__ import annotations

import asyncio
import base64
from collections import OrderedDict
import contextlib
from datetime import datetime
import json
import logging
import re
import time
from typing import Any

from aiohttp import WSMsgType, web

from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.core import CALLBACK_TYPE, Context, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import (
    async_track_point_in_utc_time,
    async_track_state_change_event,
)

from .const import (
    CLOSE_EXPIRED,
    CLOSE_IDLE,
    CLOSE_INVALID_AUTH,
    CLOSE_REVOKED,
    CLOSE_TOO_MANY,
    DOMAIN,
    LOCAL_MEDIA_SIGN_SECONDS,
    MEDIA_FEATURE_BROWSE,
    MEDIA_FEATURE_SEARCH,
    MEDIA_IMAGE_MAX_BYTES,
    MEDIA_ISSUED_MAX,
    MEDIA_ISSUED_TTL_SECONDS,
    MEDIA_SEARCH_MAX_LEN,
    PASS_MAX_SOCKETS,
    SERVICE_CALL_TIMEOUT_SECONDS,
    WS_AUTH_TIMEOUT_SECONDS,
    WS_HEARTBEAT_SECONDS,
    WS_IDLE_TIMEOUT_SECONDS,
    WS_MAX_MESSAGE_BYTES,
)
from .guest_model import (
    STATUS_ACTIVE,
    STATUS_EXPIRED,
    STATUS_PENDING,
    STATUS_REVOKED,
    GuestData,
    parse_time,
)
from .guest_music import MUSIC_KINDS, decide, signable_media_path
from .guest_policy import (
    domain_access,
    entity_domain,
    filter_config,
    profile_capabilities,
    sanitize_browse,
    sanitize_state,
    validate_call,
)
from .guest_ratelimit import TokenBucket
from .guest_runtime import GuestRuntime, get_runtime
from .library.guest_rules import (
    LIBRARY_KINDS,
    PassIssues,
    day_count,
    decide as library_decide,
)

_LOGGER = logging.getLogger(__name__)

WS_URL = f"/api/{DOMAIN}/ws"
_OUTBOX_MAX = 512
_CLOSE_OVERLOAD = 1013
_PHOTO_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_STATUS_CLOSE = {
    STATUS_EXPIRED: (CLOSE_EXPIRED, "expired"),
    STATUS_REVOKED: (CLOSE_REVOKED, "revoked"),
    STATUS_PENDING: (CLOSE_INVALID_AUTH, "not_yet_valid"),
}


class GuestWebSocketView(HomeAssistantView):
    """Websocket endpoint for paired guest devices."""

    url = WS_URL
    name = f"api:{DOMAIN}:ws"
    requires_auth = False

    async def get(self, request: web.Request) -> web.StreamResponse:
        """Open a guest session."""
        hass = request.app[KEY_HASS]
        runtime = get_runtime(hass)
        if runtime is None:
            return web.Response(status=503)
        return await GuestSession(hass, runtime, request).run()


class GuestSession:
    """One guest websocket connection."""

    def __init__(
        self, hass: HomeAssistant, runtime: GuestRuntime, request: web.Request
    ) -> None:
        self.hass = hass
        self.runtime = runtime
        self.request = request
        self.ws = web.WebSocketResponse(
            heartbeat=WS_HEARTBEAT_SECONDS, max_msg_size=WS_MAX_MESSAGE_BYTES
        )
        self.pass_id = ""
        self._token_hash = ""
        self._task: asyncio.Task | None = None
        self._writer: asyncio.Task | None = None
        self._outbox: asyncio.Queue[bytes] = asyncio.Queue(_OUTBOX_MAX)
        self._close: tuple[int, str] | None = None
        self._unsub_states: CALLBACK_TYPE | None = None
        self._library_unsub: CALLBACK_TYPE | None = None
        self._unsub_expiry: CALLBACK_TYPE | None = None
        self._bucket = TokenBucket()
        self._last_rate_audit = 0.0

    @property
    def model(self) -> GuestData:
        """Current guest data (reloaded objects are picked up)."""
        return self.runtime.store.model

    # ─── lifecycle ───────────────────────────────────────────────────────────

    async def run(self) -> web.WebSocketResponse:
        """Serve the connection until it closes."""
        try:
            async with asyncio.timeout(10):
                await self.ws.prepare(self.request)
        except (TimeoutError, ConnectionResetError):
            return self.ws

        self._task = asyncio.current_task()
        self._writer = self.hass.async_create_background_task(
            self._write_loop(), f"{DOMAIN} guest ws writer"
        )
        try:
            self._enqueue({"type": "auth_required"})
            if await self._auth():
                await self._read_loop()
        except asyncio.CancelledError:
            if self._close is None:
                raise
            if self._task is not None:
                self._task.uncancel()
        finally:
            await self._cleanup()
        return self.ws

    def close_soon(self, code: int, reason: str) -> None:
        """Ask the session to close (revoke, expiry, profile change, unload)."""
        if self._close is not None:
            return
        self._close = (code, reason)
        if self._task is not None and not self._task.done():
            self._task.cancel()

    async def _cleanup(self) -> None:
        if self._library_unsub:
            self._library_unsub()
            self._library_unsub = None
        if self._unsub_states:
            self._unsub_states()
            self._unsub_states = None
        if self._unsub_expiry:
            self._unsub_expiry()
            self._unsub_expiry = None
        if self.pass_id:
            self.runtime.remove_socket(self)
        code, reason = self._close or (1000, "")
        if reason and not self.ws.closed:
            self._enqueue({"type": "closing", "reason": reason})
        # Let the writer flush what is queued, then stop it
        with contextlib.suppress(TimeoutError, asyncio.CancelledError):
            async with asyncio.timeout(2):
                await self._outbox.join()
        if self._writer is not None:
            self._writer.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._writer
        if not self.ws.closed:
            with contextlib.suppress(Exception):
                await self.ws.close(code=code, message=reason.encode()[:120])

    # ─── sending ─────────────────────────────────────────────────────────────

    def _enqueue(self, message: dict[str, Any]) -> None:
        try:
            payload = json.dumps(message, default=str, separators=(",", ":"))
            self._outbox.put_nowait(payload.encode())
        except asyncio.QueueFull:
            self.close_soon(_CLOSE_OVERLOAD, "overloaded")

    async def _write_loop(self) -> None:
        while True:
            payload = await self._outbox.get()
            try:
                if not self.ws.closed:
                    await self.ws.send_str(payload.decode())
            except (ConnectionResetError, RuntimeError):
                pass
            finally:
                self._outbox.task_done()

    def _result(self, msg_id: Any, result: Any = None) -> None:
        self._enqueue(
            {"id": msg_id, "type": "result", "success": True, "result": result}
        )

    def _error(self, msg_id: Any, code: str) -> None:
        self._enqueue(
            {"id": msg_id, "type": "result", "success": False, "error": {"code": code}}
        )

    # ─── auth ────────────────────────────────────────────────────────────────

    async def _auth(self) -> bool:
        ip = self.request.remote
        limiter = self.runtime.limiter
        if limiter.retry_after(ip):
            return self._reject("rate_limited", CLOSE_INVALID_AUTH)

        try:
            msg = await self.ws.receive(timeout=WS_AUTH_TIMEOUT_SECONDS)
        except TimeoutError:
            return self._reject("auth_timeout", CLOSE_INVALID_AUTH)
        if msg.type is not WSMsgType.TEXT:
            return False

        try:
            data = json.loads(msg.data)
        except ValueError:
            data = None
        token = data.get("token") if isinstance(data, dict) else None
        if not isinstance(data, dict) or data.get("type") != "auth":
            token = None

        now = self.runtime.now()
        pass_ = self.model.find_by_token(token)
        if pass_ is None:
            limiter.record_failure(ip)
            self.model.audit(now, "auth_failed", ip=ip)
            self.runtime.store.schedule_save()
            return self._reject("invalid_auth", CLOSE_INVALID_AUTH)
        limiter.record_success(ip)

        status = GuestData.status(pass_, now)
        profile = self.model.profile_of(pass_)
        if profile is None:
            status = STATUS_REVOKED
        if status != STATUS_ACTIVE:
            code, reason = _STATUS_CLOSE[status]
            return self._reject(reason, code)

        if len(self.runtime.sockets_of(pass_["id"])) >= pass_.get(
            "max_sockets", PASS_MAX_SOCKETS
        ):
            return self._reject("too_many_connections", CLOSE_TOO_MANY)

        self.pass_id = pass_["id"]
        self._token_hash = pass_["token_hash"]
        self.runtime.add_socket(self)
        self.reschedule_expiry()
        if self.model.touch(pass_, now):
            self.runtime.store.schedule_save()

        self._enqueue(
            {
                "type": "auth_ok",
                "pass": self.model.guest_pass(pass_),
                "profile": {"name": profile.get("name", "")},
                "server_time": now.isoformat(),
            }
        )
        return True

    def _reject(self, code: str, close_code: int) -> bool:
        self._enqueue({"type": "auth_invalid", "code": code})
        self._close = (close_code, code)
        return False

    def reschedule_expiry(self) -> None:
        """(Re)arm the timer that closes the socket at valid_until."""
        if self._unsub_expiry:
            self._unsub_expiry()
            self._unsub_expiry = None
        pass_ = self.model.data["passes"].get(self.pass_id)
        until = parse_time(pass_.get("valid_until")) if pass_ else None
        if until is None:
            return

        @callback
        def _expired(_now: datetime) -> None:
            self._unsub_expiry = None
            self.close_soon(CLOSE_EXPIRED, "expired")

        self._unsub_expiry = async_track_point_in_utc_time(self.hass, _expired, until)

    # ─── commands ────────────────────────────────────────────────────────────

    def _current(self) -> tuple[dict, dict] | None:
        """Pass + profile if this socket may still be used, else close."""
        pass_ = self.model.data["passes"].get(self.pass_id)
        profile = self.model.profile_of(pass_) if pass_ else None
        status = (
            GuestData.status(pass_, self.runtime.now()) if pass_ else STATUS_REVOKED
        )
        if (
            pass_ is None
            or profile is None
            or pass_.get("token_hash") != self._token_hash
        ):
            status = STATUS_REVOKED
        if status != STATUS_ACTIVE:
            code, reason = _STATUS_CLOSE.get(status, (CLOSE_REVOKED, "revoked"))
            self.close_soon(code, reason)
            return None
        return pass_, profile

    async def _read_loop(self) -> None:
        while not self.ws.closed and self._close is None:
            try:
                msg = await self.ws.receive(timeout=WS_IDLE_TIMEOUT_SECONDS)
            except TimeoutError:
                self._close = (CLOSE_IDLE, "idle")
                return
            if msg.type is not WSMsgType.TEXT:
                # CLOSE / ERROR (incl. message too big: aiohttp answers 1009)
                return

            try:
                data = json.loads(msg.data)
            except ValueError:
                data = None
            if not isinstance(data, dict) or not isinstance(data.get("type"), str):
                self._error(None, "bad_request")
                continue
            msg_id = data.get("id")
            if msg_id is not None and (
                not isinstance(msg_id, int) or isinstance(msg_id, bool)
            ):
                self._error(None, "bad_request")
                continue

            current = self._current()
            if current is None:
                return
            pass_, profile = current
            if self.model.touch(pass_, self.runtime.now()):
                self.runtime.store.schedule_save()
            await self._dispatch(data, msg_id, profile)

    async def _dispatch(self, data: dict, msg_id: Any, profile: dict) -> None:
        kind = data["type"]
        if kind == "ping":
            self._enqueue({"id": msg_id, "type": "pong"})
        elif kind == "get_config":
            self._result(msg_id, filter_config(self.runtime.config_store.data, profile))
        elif kind == "subscribe_states":
            self._subscribe_states(msg_id, profile)
        elif kind == "call_service":
            await self._call_service(data, msg_id, profile)
        elif kind == "media_image":
            await self._media_image(data, msg_id, profile)
        elif kind == "photo_list":
            await self._photo_list(msg_id)
        elif kind == "photo_get":
            await self._photo_get(data, msg_id)
        elif kind in ("browse_media", "search_media"):
            await self._browse(kind, data, msg_id, profile)
        elif kind in MUSIC_KINDS:
            await self._music(kind, data, msg_id, profile)
        elif kind in LIBRARY_KINDS:
            await self._library(kind, data, msg_id, profile)
        else:
            self._error(msg_id, "unknown_command")

    @staticmethod
    def _allowed_entities(profile: dict) -> list[str]:
        entities = profile.get("entities") if isinstance(profile, dict) else None
        if not isinstance(entities, dict):
            return []
        return [
            eid
            for eid in entities
            if (domain := entity_domain(eid)) and domain_access(domain) != "denied"
        ]

    def _subscribe_states(self, msg_id: Any, profile: dict) -> None:
        if self._unsub_states is not None:
            self._error(msg_id, "already_subscribed")
            return
        allowed = self._allowed_entities(profile)
        snapshot = {}
        for eid in allowed:
            if (state := self.hass.states.get(eid)) is not None:
                clean = sanitize_state(dict(state.as_dict()))
                if clean is not None:
                    snapshot[eid] = clean

        @callback
        def _changed(event: Any) -> None:
            new_state = event.data.get("new_state")
            clean = sanitize_state(dict(new_state.as_dict())) if new_state else None
            self._enqueue(
                {"type": "state", "entity_id": event.data["entity_id"], "state": clean}
            )

        if allowed:
            self._unsub_states = async_track_state_change_event(
                self.hass, allowed, _changed
            )
        else:
            self._unsub_states = lambda: None
        self._result(msg_id, {"states": snapshot})

    async def _call_service(self, data: dict, msg_id: Any, profile: dict) -> None:
        now = self.runtime.now()
        entity_id = data.get("entity_id")
        if not self._bucket.take():
            # Audit at most once a minute per socket, the guest may hold a slider
            ts = now.timestamp()
            if ts - self._last_rate_audit > 60:
                self._last_rate_audit = ts
                self.model.audit(
                    now, "call_denied", pass_id=self.pass_id, reason="rate_limited"
                )
                self.runtime.store.schedule_save()
            self._error(msg_id, "rate_limited")
            return

        decision = validate_call(
            profile,
            data,
            device_classes_of=self.runtime.device_classes,
            attributes_of=self._attributes,
            issued=self._issued_ok,
        )
        if not decision.ok:
            self.model.audit(
                now,
                "call_denied",
                pass_id=self.pass_id,
                entity_id=decision.entity_id
                if isinstance(decision.entity_id, str) and decision.entity_id
                else (entity_id if isinstance(entity_id, str) else None),
                service=f"{decision.domain}.{decision.service}"
                if decision.domain
                else None,
                reason=decision.reason,
            )
            self.runtime.store.schedule_save()
            self._error(msg_id, decision.reason or "bad_request")
            return

        try:
            async with asyncio.timeout(SERVICE_CALL_TIMEOUT_SECONDS):
                await self.hass.services.async_call(
                    decision.domain,
                    decision.service,
                    {"entity_id": decision.entity_id, **decision.data},
                    blocking=True,
                    context=Context(),
                )
        except TimeoutError:
            self._error(msg_id, "timeout")
            return
        except HomeAssistantError:
            # e.g. the device refused the value; details stay in the HA log
            self._error(msg_id, "service_failed")
            return
        self._result(msg_id, {})

    # ─── media browse / search (profile capability media_browse) ─────────────

    def _issued(self) -> OrderedDict:
        """Content ids this pass got from browse/search: id -> expiry (monotonic)."""
        store = self.hass.data.setdefault(f"{DOMAIN}_media_issued", {})
        return store.setdefault(self.pass_id, OrderedDict())

    def _issue(self, result: dict) -> None:
        issued = self._issued()
        until = time.monotonic() + MEDIA_ISSUED_TTL_SECONDS
        for item in [result, *result.get("children", [])]:
            cid = item.get("media_content_id")
            if isinstance(cid, str) and cid:
                issued[cid] = until
                issued.move_to_end(cid)
        while len(issued) > MEDIA_ISSUED_MAX:
            issued.popitem(last=False)

    def _issued_ok(self, content_id: str) -> bool:
        until = self._issued().get(content_id)
        return until is not None and until > time.monotonic()

    async def _browse(self, kind: str, data: dict, msg_id: Any, profile: dict) -> None:
        """media_player/browse_media and search_media for a guest, filtered.

        Only players in the profile, only with media_browse, rate limited like
        service calls; a browse below the root needs an id this pass was given.
        """
        now = self.runtime.now()
        entity_id = data.get("entity_id")
        if not self._bucket.take():
            self._error(msg_id, "rate_limited")
            return
        if entity_domain(
            entity_id
        ) != "media_player" or entity_id not in self._allowed_entities(profile):
            self._error(msg_id, "entity_not_allowed")
            return
        if not profile_capabilities(profile)["media_browse"]:
            self._error(msg_id, "capability_disabled")
            return
        ctype = data.get("media_content_type")
        cid = data.get("media_content_id")
        if (ctype is None) != (cid is None) or (
            cid is not None
            and (
                not isinstance(cid, str)
                or not isinstance(ctype, str)
                or not self._issued_ok(cid)
            )
        ):
            self.model.audit(
                now,
                "call_denied",
                pass_id=self.pass_id,
                entity_id=entity_id,
                service=f"media_player.{kind}",
                reason="bad_request",
            )
            self.runtime.store.schedule_save()
            self._error(msg_id, "bad_request")
            return
        query = data.get("search_query")
        if kind == "search_media" and (
            not isinstance(query, str)
            or not 0 < len(query.strip()) <= MEDIA_SEARCH_MAX_LEN
        ):
            self._error(msg_id, "bad_request")
            return
        from homeassistant.components.media_player.const import DATA_COMPONENT

        component = self.hass.data.get(DATA_COMPONENT)
        player = component.get_entity(entity_id) if component else None
        if player is None:
            self._error(msg_id, "not_found")
            return
        bit = MEDIA_FEATURE_BROWSE if kind == "browse_media" else MEDIA_FEATURE_SEARCH
        if not int(player.supported_features or 0) & bit:
            self._error(msg_id, "feature_unsupported")
            return
        try:
            async with asyncio.timeout(SERVICE_CALL_TIMEOUT_SECONDS):
                if kind == "browse_media":
                    payload = await player.async_browse_media(ctype, cid)
                else:
                    payload = await player.async_internal_search_media(
                        query.strip(), ctype, cid, []
                    )
        except (TimeoutError, HomeAssistantError, NotImplementedError):
            self._error(msg_id, "service_failed")
            return
        raw = payload.as_dict() if hasattr(payload, "as_dict") else payload
        result = sanitize_browse(raw)
        self._issue(result)
        self._result(msg_id, result)

    # ─── music engines: Spotify proxy, HA media files (guest_music.py) ───────

    async def _music(self, kind: str, data: dict, msg_id: Any, profile: dict) -> None:
        """Default deny (guest_music.decide); Spotify only through the integration."""
        from .spotify import SpotifyError

        if not self._bucket.take():
            self._error(msg_id, "rate_limited")
            return
        caps = profile_capabilities(profile)
        decision = decide(
            kind, data, caps, self.runtime.config_store.data, self._issued_ok
        )
        if not decision.allowed:
            if decision.code not in ("bad_request", "unknown_command"):
                self.model.audit(
                    self.runtime.now(),
                    "call_denied",
                    pass_id=self.pass_id,
                    service=kind,
                    reason=decision.code,
                )
                self.runtime.store.schedule_save()
            self._error(msg_id, decision.code)
            return
        p = decision.params
        try:
            if kind.startswith("spotify_"):
                service = self.hass.data[DOMAIN]["spotify"]
                if kind == "spotify_state":
                    self._result(msg_id, await service.player_state(guest=True))
                elif kind == "spotify_search":
                    items = await service.search(p["query"], guest=True)
                    self._issue_ids(item["uri"] for item in items)
                    self._result(msg_id, {"items": items})
                else:
                    await service.control(
                        p["action"],
                        value=p.get("value"),
                        uri=p.get("uri"),
                        max_volume=p["max_volume"],
                        allowed=("play", "pause", "next", "previous", "seek", "volume"),
                    )
                    self.model.audit(
                        self.runtime.now(),
                        "call_ok",
                        pass_id=self.pass_id,
                        service=f"spotify.{p['action']}",
                    )
                    self.runtime.store.schedule_save()
                    self._result(msg_id, {})
            elif kind == "local_media_browse":
                await self._local_browse(p["media_content_id"], msg_id)
            else:
                await self._local_resolve(p["media_content_id"], msg_id)
        except SpotifyError as err:
            self._error(msg_id, err.code)

    # ─── Videotéka (library/guest_rules.py; all off by default) ──────────────

    def _library_issues(self) -> PassIssues:
        store = self.hass.data.setdefault(f"{DOMAIN}_library_issues", {})
        if self.pass_id not in store:
            store[self.pass_id] = PassIssues()
        return store[self.pass_id]

    async def _library(self, kind: str, data: dict, msg_id: Any, profile: dict) -> None:
        from .library.client import ServiceError
        from .library.config import defaults_for, normalize_library
        from .library_ws import fire_request

        if not self._bucket.take():
            self._error(msg_id, "rate_limited")
            return
        config = self.runtime.config_store.data
        if not normalize_library(config.get("library"))["enabled"]:
            self._error(msg_id, "library_disabled")
            return
        caps = profile_capabilities(profile)
        mono = time.monotonic()
        pass_ = self.model.data["passes"].get(self.pass_id) or {}
        today = self.runtime.now().date().isoformat()
        issues = self._library_issues()
        decision = library_decide(
            kind,
            data,
            caps,
            issues,
            mono,
            requests_today=day_count(pass_.get("library_requests"), today),
        )
        if not decision.allowed:
            if decision.code not in ("bad_request", "unknown_command"):
                self.model.audit(
                    self.runtime.now(),
                    "call_denied",
                    pass_id=self.pass_id,
                    service=kind,
                    reason=decision.code,
                )
                self.runtime.store.schedule_save()
            self._error(msg_id, decision.code)
            return
        p = decision.params
        service = self.hass.data[DOMAIN]["library"]
        try:
            if kind == "library_discover":
                self._result(msg_id, {"items": await service.discover(p["media"])})
            elif kind == "library_search":
                self._result(msg_id, {"items": await service.search(p["query"])})
            elif kind == "library_detail":
                item = await service.detail(p["media_type"], p["tmdb_id"])
                issues.open_item(p["media_type"], p["tmdb_id"], mono)
                self._result(msg_id, item)
            elif kind == "library_poster":
                body, mime = await service.posters.fetch(p["poster"])
                self._result(
                    msg_id,
                    {"mime": mime, "data": base64.b64encode(body).decode("ascii")},
                )
            elif kind == "library_requests":
                own = [
                    service.inbox.public(r, guest=True)
                    for r in service.inbox.list(self.pass_id)
                ]
                self._result(msg_id, {"items": own})
            elif kind == "library_request":
                seen = service.seen(p["media_type"], p["tmdb_id"])
                if seen is None:
                    self._error(msg_id, "not_found")
                    return
                rec = service.inbox.create(
                    tmdb_id=p["tmdb_id"],
                    media_type=p["media_type"],
                    title=seen["title"],
                    year=seen.get("year"),
                    poster=seen.get("poster") or "",
                    requester=pass_.get("label") or "",
                    pass_id=self.pass_id,
                    created=self.runtime.now().isoformat(),
                )
                pass_["library_requests"] = {
                    "day": today,
                    "count": day_count(pass_.get("library_requests"), today) + 1,
                }
                self.model.audit(
                    self.runtime.now(),
                    "library_request",
                    pass_id=self.pass_id,
                    tmdb_id=p["tmdb_id"],
                    title=seen["title"][:80],
                    result="pending",
                )
                self.runtime.store.schedule_save()
                fire_request(self.hass, rec)
                service.invalidate()
                self._result(msg_id, service.inbox.public(rec, guest=True))
            elif kind == "library_releases":
                profile_id, root = defaults_for(config, p["media_type"])
                res = await service.releases(
                    p["media_type"],
                    p["tmdb_id"],
                    profile_id,
                    root,
                    season=p.get("season"),
                )
                issues.list_releases(
                    p["media_type"],
                    p["tmdb_id"],
                    [(r["guid"], r["indexerId"]) for r in res["releases"]],
                    mono,
                )
                self._result(msg_id, {"releases": res["releases"]})
            elif kind == "library_grab":
                result = await service.grab(
                    p["media_type"], p["tmdb_id"], p["guid"], p["indexer_id"]
                )
                self.model.audit(
                    self.runtime.now(),
                    "library_grab",
                    pass_id=self.pass_id,
                    tmdb_id=p["tmdb_id"],
                    result="ok",
                )
                self.runtime.store.schedule_save()
                self._result(msg_id, result)
            elif kind == "library_activity":
                if self._library_unsub:
                    self._error(msg_id, "already_subscribed")
                    return

                @callback
                def _push(items: Any) -> None:
                    self._enqueue({"type": "library_activity", "items": items})

                self._library_unsub = self.hass.data[DOMAIN][
                    "library_activity"
                ].subscribe(True, _push)
                self._result(msg_id, {})
        except ServiceError as err:
            self._error(msg_id, err.code)

    def _issue_ids(self, ids) -> None:
        issued = self._issued()
        until = time.monotonic() + MEDIA_ISSUED_TTL_SECONDS
        for cid in ids:
            if isinstance(cid, str) and cid:
                issued[cid] = until
                issued.move_to_end(cid)
        while len(issued) > MEDIA_ISSUED_MAX:
            issued.popitem(last=False)

    async def _local_browse(self, content_id: str, msg_id: Any) -> None:
        """HA's media folder for the guest's own browser player."""
        from homeassistant.components import media_source
        from homeassistant.components.media_player import BrowseError

        try:
            async with asyncio.timeout(SERVICE_CALL_TIMEOUT_SECONDS):
                payload = await media_source.async_browse_media(
                    self.hass, content_id or None
                )
        except (TimeoutError, BrowseError, HomeAssistantError):
            self._error(msg_id, "service_failed")
            return
        result = sanitize_browse(payload.as_dict())
        self._issue(result)
        self._result(msg_id, result)

    async def _local_resolve(self, content_id: str, msg_id: Any) -> None:
        """A signed path to an issued file, valid for 5 minutes."""
        from datetime import timedelta

        from homeassistant.components import media_source
        from homeassistant.components.http.auth import async_sign_path

        try:
            async with asyncio.timeout(SERVICE_CALL_TIMEOUT_SECONDS):
                media = await media_source.async_resolve_media(
                    self.hass, content_id, None
                )
        except (TimeoutError, HomeAssistantError):
            self._error(msg_id, "service_failed")
            return
        path = signable_media_path(media.url)
        if path is None:
            self._error(msg_id, "not_playable")
            return
        signed = async_sign_path(
            self.hass, path, timedelta(seconds=LOCAL_MEDIA_SIGN_SECONDS)
        )
        self._result(msg_id, {"url": signed, "mime_type": media.mime_type})

    def _attributes(self, entity_id: str) -> dict | None:
        """Current state attributes (colour modes, feature bits, lists) or None."""
        state = self.hass.states.get(entity_id)
        return dict(state.attributes) if state is not None else None

    async def _media_image(self, data: dict, msg_id: Any, profile: dict) -> None:
        entity_id = data.get("entity_id")
        if entity_domain(
            entity_id
        ) != "media_player" or entity_id not in self._allowed_entities(profile):
            self._error(msg_id, "entity_not_allowed")
            return
        # Imported here: media_player is only needed when artwork is requested
        from homeassistant.components.media_player.const import DATA_COMPONENT

        component = self.hass.data.get(DATA_COMPONENT)
        player = component.get_entity(entity_id) if component else None
        if player is None:
            self._error(msg_id, "not_found")
            return
        try:
            async with asyncio.timeout(SERVICE_CALL_TIMEOUT_SECONDS):
                image, content_type = await player.async_get_media_image()
        except (TimeoutError, HomeAssistantError, OSError):
            self._error(msg_id, "not_found")
            return
        if not image or not str(content_type or "").startswith("image/"):
            self._error(msg_id, "not_found")
            return
        if len(image) > MEDIA_IMAGE_MAX_BYTES:
            self._error(msg_id, "too_large")
            return
        self._result(
            msg_id,
            {"mime": content_type, "data": base64.b64encode(image).decode("ascii")},
        )

    async def _photo_list(self, msg_id: Any) -> None:
        from .websocket_api import _list_photos

        ids = await self.hass.async_add_executor_job(_list_photos, self.hass)
        self._result(msg_id, {"photos": ids})

    async def _photo_get(self, data: dict, msg_id: Any) -> None:
        from .websocket_api import _mime, _photo_path

        photo_id = data.get("photo_id")
        if not isinstance(photo_id, str) or not _PHOTO_ID_RE.match(photo_id):
            self._error(msg_id, "bad_request")
            return
        path = _photo_path(self.hass, photo_id, bool(data.get("thumb")))

        def _read() -> bytes | None:
            return path.read_bytes() if path.is_file() else None

        raw = await self.hass.async_add_executor_job(_read)
        if raw is None:
            self._error(msg_id, "not_found")
            return
        self._result(
            msg_id, {"mime": _mime(raw), "data": base64.b64encode(raw).decode("ascii")}
        )

    def push_config(self) -> None:
        """Owner saved the dashboard: send the filtered config."""
        current = self._current()
        if current is None:
            return
        _pass, profile = current
        self._enqueue(
            {
                "type": "config",
                "config": filter_config(self.runtime.config_store.data, profile),
            }
        )
