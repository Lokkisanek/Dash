"""HTTP plumbing shared by the library services (no Home Assistant imports).

Base URLs are validated (http/https, a host, no credentials, no query or
fragment); redirects are never followed, so a service cannot bounce a request
(and its API key) to another host. Private LAN addresses are fine: that is
where Radarr, Sonarr and qBittorrent usually live. Errors carry a short code
only, never upstream text, URLs or keys.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp

TIMEOUT = aiohttp.ClientTimeout(total=15)
RELEASE_TIMEOUT = aiohttp.ClientTimeout(total=60)
MAX_BODY = 8 * 1024 * 1024


class ServiceError(Exception):
    """A failure that is safe to show: code only."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def validate_base_url(value: Any) -> str | None:
    """`scheme://host[:port][/base]` without credentials, query or fragment."""
    if not isinstance(value, str):
        return None
    raw = value.strip().rstrip("/")
    if not raw or len(raw) > 300 or any(c.isspace() for c in raw):
        return None
    try:
        parts = urlsplit(raw)
        parts.port  # noqa: B018 - raises on a bad port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    if parts.username or parts.password or parts.query or parts.fragment:
        return None
    if ".." in parts.path.split("/"):
        return None
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


class HttpService:
    """Base: one configured service (url + credentials) on a shared session."""

    name = "service"

    def __init__(
        self, session: Callable[[], aiohttp.ClientSession], base_url: str
    ) -> None:
        self._session = session
        self.base_url = base_url

    def _headers(self) -> dict:
        return {}

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json: Any = None,
        data: dict | None = None,
        timeout: aiohttp.ClientTimeout = TIMEOUT,
        expect_json: bool = True,
        headers: dict | None = None,
    ) -> Any:
        try:
            async with self._session().request(
                method,
                f"{self.base_url}{path}",
                params=params,
                json=json,
                data=data,
                headers={**self._headers(), **(headers or {})},
                timeout=timeout,
                allow_redirects=False,
            ) as resp:
                if resp.status in (401, 403):
                    raise ServiceError("auth_failed")
                if resp.status == 404:
                    raise ServiceError("not_found")
                if 300 <= resp.status < 400:
                    raise ServiceError("redirect_refused")
                if resp.status == 429:
                    raise ServiceError("rate_limited")
                if resp.status >= 500:
                    raise ServiceError("unavailable")
                if resp.status >= 400:
                    raise ServiceError("bad_request")
                if resp.content_length and resp.content_length > MAX_BODY:
                    raise ServiceError("too_large")
                if not expect_json:
                    return await resp.text()
                if resp.status == 204:
                    return None
                return await resp.json(content_type=None)
        except ServiceError:
            raise
        except TimeoutError as err:
            raise ServiceError("timeout") from err
        except (aiohttp.ClientError, ValueError) as err:
            raise ServiceError("unavailable") from err
