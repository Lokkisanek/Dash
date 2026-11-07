"""Public pairing endpoint: POST /api/guest_ha_dashboard/pair.

No HA authentication; the pairing code is the credential. Errors are generic so
a caller cannot tell a wrong code from an expired or used one. Codes and tokens
are never logged.
"""

from __future__ import annotations

from http import HTTPStatus
import json
import logging

from aiohttp import web

from homeassistant.components.http import KEY_HASS, HomeAssistantView

from .const import CLOSE_REVOKED, DOMAIN
from .guest_runtime import get_runtime

_LOGGER = logging.getLogger(__name__)

PAIR_URL = f"/api/{DOMAIN}/pair"
_MAX_BODY = 1024
_NO_STORE = {"Cache-Control": "no-store"}


class GuestPairView(HomeAssistantView):
    """Exchange a one-time pairing code for a guest token."""

    url = PAIR_URL
    name = f"api:{DOMAIN}:pair"
    requires_auth = False
    # Any origin: the endpoint uses no cookies or HA credentials, so CORS would
    # not protect anything here (docs/GUEST_PASSES.md, "CORS").
    cors_allowed = True

    async def post(self, request: web.Request) -> web.Response:
        """Pair a device."""
        hass = request.app[KEY_HASS]
        runtime = get_runtime(hass)
        if runtime is None:
            return self._error("unavailable", HTTPStatus.SERVICE_UNAVAILABLE)

        ip = request.remote
        if wait := runtime.limiter.retry_after(ip):
            return self._error(
                "rate_limited",
                HTTPStatus.TOO_MANY_REQUESTS,
                retry_after=wait,
                headers={"Retry-After": str(wait)},
            )

        body = await request.content.read(_MAX_BODY + 1)
        if len(body) > _MAX_BODY:
            runtime.limiter.record_failure(ip)
            return self._error("bad_request", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            payload = json.loads(body or b"{}")
        except ValueError:
            payload = None
        if not isinstance(payload, dict) or not isinstance(payload.get("code"), str):
            runtime.limiter.record_failure(ip)
            return self._error("bad_request", HTTPStatus.BAD_REQUEST)

        model = runtime.store.model
        result = model.pair(
            payload["code"],
            runtime.now(),
            ip=ip,
            device_name=payload.get("device_name"),
        )
        if result is None:
            runtime.limiter.record_failure(ip)
            runtime.store.schedule_save()
            _LOGGER.info("Guest pairing failed from %s", ip)
            return self._error("invalid_code", HTTPStatus.BAD_REQUEST)

        pass_, token = result
        runtime.limiter.record_success(ip)
        # A new token replaces the old one: devices still using it are logged out
        runtime.close_pass(pass_["id"], CLOSE_REVOKED, "repaired")
        await runtime.store.async_save()
        _LOGGER.info("Guest pass %s paired", pass_["id"])

        profile = model.profile_of(pass_) or {}
        return self.json(
            {
                "token": token,
                "pass": model.guest_pass(pass_),
                "profile": {"name": profile.get("name", "")},
            },
            headers=_NO_STORE,
        )

    def _error(
        self,
        code: str,
        status: HTTPStatus,
        *,
        retry_after: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> web.Response:
        body: dict[str, object] = {"error": code}
        if retry_after is not None:
            body["retry_after"] = retry_after
        return self.json(body, status, headers={**_NO_STORE, **(headers or {})})
