"""Restricted guest websocket: GET /api/guest_ha_dashboard/ws.

Not Home Assistant's /api/websocket: a guest never holds an HA token. The first
message must carry the guest token; afterwards only the commands below exist and
everything is filtered by the pass's profile (docs/GUEST_PASSES.md).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
from datetime import datetime
import json
import logging
import re
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
    MEDIA_IMAGE_MAX_BYTES,
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
from .guest_policy import (
    domain_access,
    entity_domain,
    filter_config,
    sanitize_state,
    validate_call,
)
from .guest_ratelimit import TokenBucket
from .guest_runtime import GuestRuntime, get_runtime

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

        classes = (
            self.runtime.device_classes(entity_id) if isinstance(entity_id, str) else ()
        )
        decision = validate_call(profile, data, classes)
        if not decision.ok:
            self.model.audit(
                now,
                "call_denied",
                pass_id=self.pass_id,
                entity_id=entity_id if isinstance(entity_id, str) else None,
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
