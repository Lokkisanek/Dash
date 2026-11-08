"""Posters fetched by the integration; the browser only gets an opaque id.

Allowed sources: the TMDB image host from `/3/configuration` (sizes
w185/w342/w500) and the MediaCover path of a configured Radarr/Sonarr host.
Path `^/[A-Za-z0-9_./-]+\\.(jpg|jpeg|png|webp)$` without `..`, at most 2 MB,
image bytes checked, an in-memory LRU cache. Redirects are not followed.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
import hashlib
import re
from typing import Any
from urllib.parse import urlsplit

import aiohttp

from .client import ServiceError

PATH_RE = re.compile(r"^/[A-Za-z0-9_./-]+\.(jpg|jpeg|png|webp)$", re.IGNORECASE)
SIZES = ("w185", "w342", "w500")
MAX_BYTES = 2 * 1024 * 1024
CACHE_ITEMS = 150
CACHE_BYTES = 15 * 1024 * 1024
TOKENS_MAX = 4000
TIMEOUT = aiohttp.ClientTimeout(total=15)
_SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"RIFF", "image/webp"),
)


def safe_path(path: Any) -> str | None:
    if not isinstance(path, str):
        return None
    clean = path.split("?", 1)[0]
    if ".." in clean or "//" in clean or not PATH_RE.match(clean):
        return None
    return clean


class Posters:
    """id -> source registry plus a byte cache."""

    def __init__(self, session: Callable[[], aiohttp.ClientSession]) -> None:
        self._session = session
        self._sources: OrderedDict[str, dict] = OrderedDict()
        self._cache: OrderedDict[str, tuple[bytes, str]] = OrderedDict()
        self._cache_bytes = 0
        # set by the service: TMDB image base (from /configuration) and Arr hosts
        self.tmdb_base = ""
        self.arr_hosts: dict[str, dict] = {}

    def _register(self, source: dict) -> str:
        key = repr(sorted(source.items()))
        token = hashlib.sha256(key.encode()).hexdigest()[:24]
        self._sources[token] = source
        self._sources.move_to_end(token)
        while len(self._sources) > TOKENS_MAX:
            self._sources.popitem(last=False)
        return token

    def from_tmdb(self, poster_path: Any, size: str = "w342") -> str:
        path = safe_path(poster_path)
        if not path or size not in SIZES:
            return ""
        return self._register({"kind": "tmdb", "path": path, "size": size})

    def from_cover(self, service: str, cover: dict) -> str:
        """An Arr poster: the TMDB copy if it is on the TMDB host, else the local MediaCover."""
        remote = cover.get("remote") or ""
        if remote and self.tmdb_base:
            base = urlsplit(self.tmdb_base)
            parts = urlsplit(remote)
            if parts.scheme == "https" and parts.netloc == base.netloc:
                # https://image.tmdb.org/t/p/original/abc.jpg -> /abc.jpg
                tail = "/" + parts.path.rsplit("/", 1)[-1]
                token = self.from_tmdb(tail)
                if token:
                    return token
        local = safe_path(cover.get("local"))
        if local and service in self.arr_hosts:
            return self._register({"kind": "arr", "service": service, "path": local})
        return ""

    def known(self, token: Any) -> bool:
        return isinstance(token, str) and token in self._sources

    async def fetch(self, token: Any) -> tuple[bytes, str]:
        if not self.known(token):
            raise ServiceError("not_found")
        if token in self._cache:
            self._cache.move_to_end(token)
            return self._cache[token]
        src = self._sources[token]
        headers: dict = {}
        if src["kind"] == "tmdb":
            if not self.tmdb_base:
                raise ServiceError("not_configured")
            url = f"{self.tmdb_base.rstrip('/')}/{src['size']}{src['path']}"
        else:
            host = self.arr_hosts.get(src["service"])
            if not host:
                raise ServiceError("not_configured")
            base = urlsplit(host["url"])
            # the MediaCover path already contains the Arr's URL base
            url = f"{base.scheme}://{base.netloc}{src['path']}"
            headers = {"X-Api-Key": host["api_key"]}
        try:
            async with self._session().get(
                url, headers=headers, timeout=TIMEOUT, allow_redirects=False
            ) as resp:
                if resp.status != 200:
                    raise ServiceError("unavailable")
                if resp.content_length and resp.content_length > MAX_BYTES:
                    raise ServiceError("too_large")
                data = await resp.content.read(MAX_BYTES + 1)
        except ServiceError:
            raise
        except (aiohttp.ClientError, TimeoutError) as err:
            raise ServiceError("unavailable") from err
        if len(data) > MAX_BYTES:
            raise ServiceError("too_large")
        mime = next((m for sig, m in _SIGNATURES if data.startswith(sig)), None)
        if mime is None:
            raise ServiceError("not_an_image")
        self._cache[token] = (data, mime)
        self._cache_bytes += len(data)
        while len(self._cache) > CACHE_ITEMS or self._cache_bytes > CACHE_BYTES:
            _old, (blob, _m) = self._cache.popitem(last=False)
            self._cache_bytes -= len(blob)
        return data, mime
