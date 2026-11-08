"""Station search through radio-browser.info, proxied by the integration.

Off unless the owner turns on `radio.directory`. The browser never calls the
directory: the integration does, following the API's own rules
(https://api.radio-browser.info/, read 2026-11-08): discover servers through
DNS `all.api.radio-browser.info`, try them in random order, send a
descriptive User-Agent. Only https streams are returned (an https page cannot
play http), favicons are dropped (a third-party host), results are cached.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
import random
import socket
import time
from typing import Any

import aiohttp

from .music import RADIO_NAME_MAX, https_url

DISCOVERY_HOST = "all.api.radio-browser.info"
SEARCH_PATH = "/json/stations/search"
RESULT_LIMIT = 20
CACHE_SECONDS = 600
SERVERS_SECONDS = 3600
TIMEOUT = aiohttp.ClientTimeout(total=10)


async def _discover() -> list[str]:
    """Server names: the A/AAAA records of the discovery host, reverse-resolved."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(DISCOVERY_HOST, 443, type=socket.SOCK_STREAM)
    names: set[str] = set()
    for info in infos:
        ip = info[4][0]
        try:
            host, _, _ = await loop.run_in_executor(None, socket.gethostbyaddr, ip)
        except OSError:
            continue
        if host.endswith(".api.radio-browser.info"):
            names.add(host)
    servers = sorted(names)
    random.shuffle(servers)
    return servers


class RadioDirectory:
    """Search with a 10 minute cache; servers from DNS, refreshed hourly."""

    def __init__(
        self,
        session: Callable[[], aiohttp.ClientSession],
        user_agent: str,
        *,
        discover: Callable[[], Awaitable[list[str]]] = _discover,
        scheme: str = "https",
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._session = session
        self._ua = user_agent
        self._discover = discover
        self._scheme = scheme
        self._clock = clock
        self._servers: list[str] = []
        self._servers_at = -SERVERS_SECONDS
        self._cache: dict[str, tuple[float, list[dict]]] = {}

    async def search(self, name: Any) -> list[dict]:
        if not isinstance(name, str) or not 2 <= len(name.strip()) <= 60:
            raise ValueError("bad_request")
        key = name.strip().lower()
        hit = self._cache.get(key)
        if hit and self._clock() - hit[0] < CACHE_SECONDS:
            return hit[1]
        if self._clock() - self._servers_at > SERVERS_SECONDS or not self._servers:
            self._servers = await self._discover()
            self._servers_at = self._clock()
        params = {
            "name": key,
            "limit": RESULT_LIMIT,
            "hidebroken": "true",
            "is_https": "true",
            "order": "clickcount",
            "reverse": "true",
        }
        for server in self._servers:
            try:
                async with self._session().get(
                    f"{self._scheme}://{server}{SEARCH_PATH}",
                    params=params,
                    headers={"User-Agent": self._ua},
                    timeout=TIMEOUT,
                    allow_redirects=False,
                ) as resp:
                    if resp.status != 200:
                        continue
                    body = await resp.json(content_type=None)
            except (aiohttp.ClientError, TimeoutError, ValueError):
                continue
            result = _stations(body)
            self._cache[key] = (self._clock(), result)
            if len(self._cache) > 200:
                self._cache.pop(next(iter(self._cache)))
            return result
        raise ConnectionError("unavailable")


def _stations(body: Any) -> list[dict]:
    out = []
    for raw in body if isinstance(body, list) else []:
        if not isinstance(raw, dict):
            continue
        url = https_url(raw.get("url_resolved"))
        name = raw.get("name")
        if not url or not isinstance(name, str) or not name.strip():
            continue
        out.append(
            {
                "name": " ".join(name.split())[:RADIO_NAME_MAX],
                "url": url,
                "codec": str(raw.get("codec") or "")[:12],
                "bitrate": raw.get("bitrate")
                if isinstance(raw.get("bitrate"), int)
                else 0,
            }
        )
        if len(out) >= RESULT_LIMIT:
            break
    return out
