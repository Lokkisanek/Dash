"""qBittorrent WebUI API v2: login, version, torrents, pause/resume/delete/recheck.

Newer qBittorrent names pause/resume `stop`/`start` (the 5.0 API page); the
4.1 page has `pause`/`resume`. The version where the rename happened is not
documented (UNVERIFIED), so the client reads `webapiVersion`, picks a name and
falls back to the other one on 404.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from .client import HttpService, ServiceError

RENAMED_IN = (2, 11, 0)


def parse_version(text: Any) -> tuple[int, ...]:
    try:
        return tuple(int(x) for x in str(text).strip().split(".")[:3])
    except ValueError:
        return (0,)


class QBittorrent(HttpService):
    name = "qbittorrent"

    def __init__(self, session, base_url: str, username: str, password: str) -> None:
        super().__init__(session, base_url)
        self._user = username
        self._password = password
        self._sid = ""
        self._version: tuple[int, ...] | None = None
        host = urlsplit(base_url)
        self._origin = f"{host.scheme}://{host.netloc}"

    def _headers(self) -> dict:
        headers = {"Referer": self._origin, "Origin": self._origin}
        if self._sid:
            headers["Cookie"] = f"SID={self._sid}"
        return headers

    async def login(self) -> None:
        try:
            async with self._session().post(
                f"{self.base_url}/api/v2/auth/login",
                data={"username": self._user, "password": self._password},
                headers={"Referer": self._origin, "Origin": self._origin},
                allow_redirects=False,
            ) as resp:
                text = await resp.text()
                sid = resp.cookies.get("SID")
                if resp.status == 403:
                    raise ServiceError("banned")
                if resp.status != 200 or text.strip() != "Ok." or sid is None:
                    raise ServiceError("auth_failed")
                self._sid = sid.value
        except ServiceError:
            raise
        except Exception as err:
            raise ServiceError("unavailable") from err

    async def call(self, method: str, path: str, **kw: Any) -> Any:
        if not self._sid:
            await self.login()
        try:
            return await self.request(method, path, **kw)
        except ServiceError as err:
            if err.code != "auth_failed":
                raise
            # session expired: log in once more
            self._sid = ""
            await self.login()
            return await self.request(method, path, **kw)

    async def version(self) -> tuple[int, ...]:
        if self._version is None:
            text = await self.call(
                "GET", "/api/v2/app/webapiVersion", expect_json=False
            )
            self._version = parse_version(text)
        return self._version

    async def test(self) -> dict:
        v = await self.version()
        return {"version": ".".join(str(x) for x in v)}

    async def torrents(self) -> list[dict]:
        body = await self.call("GET", "/api/v2/torrents/info")
        out = []
        for t in body or []:
            if isinstance(t, dict) and isinstance(t.get("hash"), str):
                out.append(
                    {
                        "hash": t["hash"].upper(),
                        "name": str(t.get("name") or "")[:300],
                        "progress": float(t.get("progress") or 0),
                        "dlspeed": int(t.get("dlspeed") or 0),
                        "upspeed": int(t.get("upspeed") or 0),
                        "eta": int(t.get("eta") or 0),
                        "state": str(t.get("state") or "")[:30],
                        "num_seeds": int(t.get("num_seeds") or 0),
                    }
                )
        return out

    async def control(self, action: str, torrent_hash: str) -> None:
        h = torrent_hash.lower()
        if action == "delete":
            # the owner removes the download; files stay (deleteFiles=false)
            await self.call(
                "POST",
                "/api/v2/torrents/delete",
                data={"hashes": h, "deleteFiles": "false"},
                expect_json=False,
            )
            return
        if action == "recheck":
            await self.call(
                "POST",
                "/api/v2/torrents/recheck",
                data={"hashes": h},
                expect_json=False,
            )
            return
        if action not in ("pause", "resume"):
            raise ServiceError("bad_request")
        new = await self.version() >= RENAMED_IN
        names = {"pause": ("stop", "pause"), "resume": ("start", "resume")}[action]
        first, second = names if new else names[::-1]
        try:
            await self.call(
                "POST",
                f"/api/v2/torrents/{first}",
                data={"hashes": h},
                expect_json=False,
            )
        except ServiceError as err:
            if err.code != "not_found":
                raise
            await self.call(
                "POST",
                f"/api/v2/torrents/{second}",
                data={"hashes": h},
                expect_json=False,
            )
