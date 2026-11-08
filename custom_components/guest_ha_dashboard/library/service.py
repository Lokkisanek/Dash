"""Videotéka: one place to discover, request, pick a release and watch downloads.

No Home Assistant imports (tests/pure drives it against fake servers). The HA
glue (library_ws.py, guest_ws.py) owns permissions; this class owns the
behaviour described in docs/LIBRARY.md.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Callable
import time
from typing import Any

import aiohttp

from .arr import Radarr, Sonarr
from .client import ServiceError, validate_base_url
from .ghosts import GHOST_MAX_AGE, Ghosts
from .posters import Posters
from .qbittorrent import QBittorrent
from .requests import Inbox
from .tmdb import TMDB_BASE, Tmdb

SERVICES = ("tmdb", "radarr", "sonarr", "qbittorrent")
STATUS_CACHE_SECONDS = 45
SEEN_MAX = 600


def _key(media: str, tmdb_id: int) -> tuple[str, int]:
    return (media, tmdb_id)


class LibraryService:
    def __init__(
        self,
        data: dict,
        save: Callable[[], None],
        session: Callable[[], aiohttp.ClientSession],
        *,
        clock: Callable[[], float] = time.time,
        tmdb_base: str = TMDB_BASE,
        language: str = "cs-CZ",
    ) -> None:
        self.data = data
        self.data.setdefault("services", {})
        self.data.setdefault("ghosts", [])
        self.data.setdefault("requests", [])
        self._save = save
        self._session = session
        self._clock = clock
        self._tmdb_base = tmdb_base
        self._language = language
        self.ghosts = Ghosts(self.data["ghosts"], save)
        self.inbox = Inbox(self.data["requests"], save)
        self.posters = Posters(session)
        self._seen: OrderedDict[tuple[str, int], dict] = OrderedDict()
        self._status_cache: dict | None = None
        self._status_at = 0.0
        self._lock = asyncio.Lock()
        self._build()

    # ─── services (credentials stay in `data`, never returned) ─────────────

    def _build(self) -> None:
        s = self.data["services"]
        self.tmdb = (
            Tmdb(
                self._session,
                s["tmdb"]["api_key"],
                base_url=self._tmdb_base,
                language=self._language,
            )
            if s.get("tmdb", {}).get("api_key")
            else None
        )
        self.radarr = (
            Radarr(self._session, s["radarr"]["url"], s["radarr"]["api_key"])
            if s.get("radarr", {}).get("url") and s["radarr"].get("api_key")
            else None
        )
        self.sonarr = (
            Sonarr(self._session, s["sonarr"]["url"], s["sonarr"]["api_key"])
            if s.get("sonarr", {}).get("url") and s["sonarr"].get("api_key")
            else None
        )
        q = s.get("qbittorrent", {})
        self.qbit = (
            QBittorrent(
                self._session, q["url"], q.get("username", ""), q.get("password", "")
            )
            if q.get("url")
            else None
        )
        self.posters.arr_hosts = {
            name: {"url": s[name]["url"], "api_key": s[name]["api_key"]}
            for name in ("radarr", "sonarr")
            if getattr(self, name)
        }
        self.invalidate()

    def services_status(self) -> dict:
        s = self.data["services"]
        return {
            "tmdb": {"configured": self.tmdb is not None},
            "radarr": {
                "configured": self.radarr is not None,
                "url": s.get("radarr", {}).get("url", ""),
            },
            "sonarr": {
                "configured": self.sonarr is not None,
                "url": s.get("sonarr", {}).get("url", ""),
            },
            "qbittorrent": {
                "configured": self.qbit is not None,
                "url": s.get("qbittorrent", {}).get("url", ""),
            },
        }

    def set_service(self, name: str, fields: dict) -> dict:
        """Save (overwrite) one service; `remove: true` forgets it."""
        if name not in SERVICES:
            raise ServiceError("bad_request")
        if fields.get("remove") is True:
            self.data["services"].pop(name, None)
        else:
            entry: dict = {}
            if name != "tmdb":
                url = validate_base_url(fields.get("url"))
                if not url:
                    raise ServiceError("bad_url")
                entry["url"] = url
            old = self.data["services"].get(name, {})
            for secret in ("api_key", "username", "password"):
                value = fields.get(secret)
                if isinstance(value, str) and value:
                    if len(value) > 300:
                        raise ServiceError("bad_request")
                    entry[secret] = value
                elif secret in old:
                    entry[secret] = old[
                        secret
                    ]  # "Změnit" without a new key keeps the old one
            if name in ("tmdb", "radarr", "sonarr") and not entry.get("api_key"):
                raise ServiceError("missing_key")
            self.data["services"][name] = entry
        self._save()
        self._build()
        return self.services_status()

    def _service(self, name: str):
        svc = {
            "tmdb": self.tmdb,
            "radarr": self.radarr,
            "sonarr": self.sonarr,
            "qbittorrent": self.qbit,
        }.get(name)
        if svc is None:
            raise ServiceError("not_configured")
        return svc

    async def test(self, name: str) -> dict:
        result = await self._service(name).test()
        return {"ok": True, **result}

    async def options(self, name: str) -> dict:
        if name not in ("radarr", "sonarr"):
            raise ServiceError("bad_request")
        return await self._service(name).options()

    def _arr(self, media: str):
        return self._service("radarr" if media == "movie" else "sonarr")

    # ─── status model ──────────────────────────────────────────────────────

    def invalidate(self) -> None:
        self._status_cache = None

    async def _state(self) -> dict:
        """Library maps, queues and torrents, cached for 45 s."""
        if (
            self._status_cache
            and self._clock() - self._status_at < STATUS_CACHE_SECONDS
        ):
            return self._status_cache
        async with self._lock:
            if (
                self._status_cache
                and self._clock() - self._status_at < STATUS_CACHE_SECONDS
            ):
                return self._status_cache
            state: dict = {
                "movie": None,
                "tv": None,
                "queue": {"movie": [], "tv": []},
                "torrents": {},
            }
            for media, svc in (("movie", self.radarr), ("tv", self.sonarr)):
                if svc is None:
                    continue
                try:
                    state[media] = await svc.library()
                    state["queue"][media] = await svc.queue()
                except ServiceError:
                    state[media] = None
            if self.qbit is not None:
                try:
                    state["torrents"] = {
                        t["hash"]: t for t in await self.qbit.torrents()
                    }
                except ServiceError:
                    state["torrents"] = {}
            self._status_cache = state
            self._status_at = self._clock()
            return state

    def _status_of(self, state: dict, media: str, tmdb_id: int) -> dict:
        lib = state.get(media)
        if lib is None:
            return {"status": "unavailable"}
        entry = lib.get(tmdb_id)
        if entry and self.ghosts.find(media, entry["id"]) and not entry["monitored"]:
            entry = None  # our own ghost: still unrequested to everyone
        if entry:
            if entry["hasFile"]:
                return {"status": "available"}
            for rec in state["queue"][media]:
                owner = rec.get("movieId") if media == "movie" else rec.get("seriesId")
                if owner == entry["id"]:
                    return {
                        "status": "downloading",
                        "percent": self._percent(rec, state["torrents"]),
                    }
            if entry["monitored"]:
                return {"status": "monitored"}
        if any(
            r["tmdbId"] == tmdb_id
            and r["mediaType"] == media
            and r["status"] == "pending"
            for r in self.inbox.list()
        ):
            return {"status": "requested"}
        return {"status": "unrequested"}

    @staticmethod
    def _percent(rec: dict, torrents: dict) -> int:
        torrent = torrents.get(str(rec.get("downloadId") or "").upper())
        if torrent:
            return max(0, min(100, round(torrent["progress"] * 100)))
        size = rec.get("size") or 0
        left = rec.get("sizeleft") or 0
        return max(0, min(100, round((size - left) / size * 100))) if size else 0

    async def annotate(self, items: list[dict]) -> list[dict]:
        state = await self._state()
        out = []
        for item in items:
            poster = item.get("poster") or ""
            if not poster and item.get("posterPath"):
                poster = self.posters.from_tmdb(item["posterPath"])
            if not poster and item.get("cover"):
                svc = "radarr" if item["mediaType"] == "movie" else "sonarr"
                poster = self.posters.from_cover(svc, item["cover"])
            clean = {
                "tmdbId": item["tmdbId"],
                "mediaType": item["mediaType"],
                "title": item.get("title", ""),
                "year": item.get("year"),
                "overview": item.get("overview", ""),
                "poster": poster,
                **self._status_of(state, item["mediaType"], item["tmdbId"]),
            }
            self._seen[_key(clean["mediaType"], clean["tmdbId"])] = clean
            self._seen.move_to_end(_key(clean["mediaType"], clean["tmdbId"]))
            while len(self._seen) > SEEN_MAX:
                self._seen.popitem(last=False)
            out.append(clean)
        return out

    async def _tmdb_images(self) -> None:
        if self.tmdb and not self.posters.tmdb_base:
            try:
                self.posters.tmdb_base = (await self.tmdb.image_config())["base"]
            except ServiceError:
                self.posters.tmdb_base = ""

    # ─── discover, search, detail ──────────────────────────────────────────

    async def discover(self, media: str = "all") -> list[dict]:
        if self.tmdb is None:
            raise ServiceError("tmdb_required")
        await self._tmdb_images()
        return await self.annotate(await self.tmdb.trending(media))

    async def search(self, query: Any) -> list[dict]:
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 100:
            raise ServiceError("bad_request")
        q = query.strip()
        if self.tmdb is not None:
            await self._tmdb_images()
            return await self.annotate(await self.tmdb.search(q))
        # without a TMDB key: the Arr lookups (verified paths) as a fallback
        items: list[dict] = []
        for svc in (self.radarr, self.sonarr):
            if svc is not None:
                try:
                    items += await svc.search(q)
                except ServiceError:
                    continue
        if not items and self.radarr is None and self.sonarr is None:
            raise ServiceError("not_configured")
        return await self.annotate(items)

    def seen(self, media: Any, tmdb_id: Any) -> dict | None:
        if media not in ("movie", "tv") or not isinstance(tmdb_id, int):
            return None
        return self._seen.get(_key(media, tmdb_id))

    async def detail(self, media: Any, tmdb_id: Any) -> dict:
        item = self.seen(media, tmdb_id)
        if item is None:
            raise ServiceError("not_found")
        state = await self._state()
        return {**item, **self._status_of(state, media, tmdb_id)}

    # ─── requests to the Arr ───────────────────────────────────────────────

    async def _ensure(
        self,
        media: str,
        tmdb_id: int,
        profile_id: Any,
        root: Any,
        *,
        ghost: bool,
        search: bool,
    ) -> dict:
        """The Arr item for a TMDB id, added if missing (as a ghost or monitored)."""
        arr = self._arr(media)
        existing = await arr.find(tmdb_id)
        if existing:
            return existing
        if not isinstance(profile_id, int) or not isinstance(root, str) or not root:
            raise ServiceError("missing_defaults")
        if media == "movie":
            lookup = await arr.lookup(tmdb_id)
        else:
            lookup = await arr.lookup(
                tmdb_id, (self.seen(media, tmdb_id) or {}).get("title", "")
            )
        added = await arr.add(
            lookup, profile_id, root, monitored=not ghost, search=search
        )
        if not isinstance(added, dict) or not isinstance(added.get("id"), int):
            raise ServiceError("bad_response")
        if ghost:
            self.ghosts.add(media, added["id"], tmdb_id, self._clock())
        return added

    async def request_auto(
        self, media: str, tmdb_id: int, profile_id: Any, root: Any
    ) -> dict:
        """'Automaticky': monitored, and the Arr searches with its quality profile."""
        item = await self._ensure(
            media, tmdb_id, profile_id, root, ghost=False, search=True
        )
        if not item.get("monitored"):
            await self._arr(media).set_monitored(item["id"])
        self.ghosts.forget(media, item["id"])
        self.invalidate()
        return await self.detail_or_status(media, tmdb_id)

    async def detail_or_status(self, media: str, tmdb_id: int) -> dict:
        state = await self._state()
        return {
            "tmdbId": tmdb_id,
            "mediaType": media,
            **self._status_of(state, media, tmdb_id),
        }

    async def releases(
        self,
        media: str,
        tmdb_id: int,
        profile_id: Any,
        root: Any,
        *,
        season: Any = None,
        episode_id: Any = None,
    ) -> dict:
        """'Vybrat release': ghost-add when missing, then the release list (≤ 60 s)."""
        item = await self._ensure(
            media, tmdb_id, profile_id, root, ghost=True, search=False
        )
        arr = self._arr(media)
        kwargs = {}
        if media == "tv":
            if isinstance(season, int) and season >= 0:
                kwargs["season"] = season
            if isinstance(episode_id, int):
                kwargs["episode_id"] = episode_id
        releases = await arr.release_list(item["id"], **kwargs)
        return {"itemId": item["id"], "releases": releases}

    async def grab(self, media: str, tmdb_id: int, guid: Any, indexer_id: Any) -> dict:
        if not isinstance(guid, str) or not guid or not isinstance(indexer_id, int):
            raise ServiceError("bad_request")
        arr = self._arr(media)
        item = await arr.find(tmdb_id)
        if not item:
            raise ServiceError("not_found")
        await arr.grab(guid, indexer_id)
        await arr.set_monitored(item["id"])
        self.ghosts.forget(media, item["id"])
        self.invalidate()
        return await self.detail_or_status(media, tmdb_id)

    async def close_picker(self, media: str, tmdb_id: int) -> None:
        """The picker closed without a grab: remove our ghost right away."""
        ghost = self.ghosts.find_tmdb(media, tmdb_id)
        if ghost:
            await self._cleanup_one(ghost)

    async def cleanup(self, *, everything: bool = False) -> int:
        """Ghosts older than 15 minutes (all at start-up). Returns how many were removed."""
        due = (
            self.ghosts.all()
            if everything
            else self.ghosts.due(self._clock(), GHOST_MAX_AGE)
        )
        removed = 0
        for ghost in due:
            removed += await self._cleanup_one(ghost)
        if removed:
            self.invalidate()
        return removed

    async def _cleanup_one(self, ghost: dict) -> int:
        media, item_id = ghost["kind"], ghost["id"]
        try:
            arr = self._arr(media)
            item = await arr.get(item_id)
        except ServiceError as err:
            if err.code == "not_found":
                self.ghosts.forget(media, item_id)
            return 0
        queue = await arr.queue()
        in_queue = any(arr.queue_owner(r) == item_id for r in queue)
        if arr.has_files(item) or in_queue or item.get("monitored") is True:
            # files, a download or monitoring: it is not a ghost any more, keep it
            self.ghosts.forget(media, item_id)
            return 0
        await arr.delete(item_id)
        self.ghosts.forget(media, item_id)
        return 1

    # ─── activity ──────────────────────────────────────────────────────────

    async def activity(self, *, guest: bool = False) -> list[dict]:
        """Arr queues merged with qBittorrent by upper-cased infohash == downloadId."""
        self.invalidate()
        state = await self._state()
        torrents = dict(state["torrents"])
        items = []
        for media in ("movie", "tv"):
            lib = state.get(media) or {}
            by_id = {v["id"]: (tmdb, v) for tmdb, v in lib.items()}
            for rec in state["queue"][media]:
                owner = rec.get("movieId") if media == "movie" else rec.get("seriesId")
                tmdb_id, entry = by_id.get(owner, (None, None))
                h = str(rec.get("downloadId") or "").upper()
                t = torrents.pop(h, None)
                seen = self.seen(media, tmdb_id) if tmdb_id else None
                poster = (seen or {}).get("poster") or (
                    self.posters.from_cover(
                        "radarr" if media == "movie" else "sonarr", entry["cover"]
                    )
                    if entry
                    else ""
                )
                items.append(
                    {
                        "id": h or f"q{rec.get('id')}",
                        "hash": h if t else "",
                        "mediaType": media,
                        "tmdbId": tmdb_id,
                        "title": (seen or {}).get("title")
                        or str(rec.get("title") or "")[:200],
                        "release": str(rec.get("title") or "")[:200],
                        "poster": poster,
                        "progress": self._percent(rec, state["torrents"]),
                        "speed": t["dlspeed"] if t else None,
                        "eta": t["eta"] if t else None,
                        "state": t["state"] if t else str(rec.get("status") or ""),
                    }
                )
        if not guest:
            # torrents qBittorrent has that no Arr knows about
            for h, t in torrents.items():
                items.append(
                    {
                        "id": h,
                        "hash": h,
                        "mediaType": "",
                        "tmdbId": None,
                        "title": t["name"],
                        "release": t["name"],
                        "poster": "",
                        "progress": round(t["progress"] * 100),
                        "speed": t["dlspeed"],
                        "eta": t["eta"],
                        "state": t["state"],
                    }
                )
        if guest:
            for i in items:
                i["hash"] = ""
                i["release"] = ""
        return items

    async def torrent(self, action: Any, torrent_hash: Any) -> None:
        """Owner only: pause, resume, delete (files kept), recheck."""
        if action not in ("pause", "resume", "delete", "recheck"):
            raise ServiceError("bad_request")
        if (
            not isinstance(torrent_hash, str)
            or not torrent_hash.isalnum()
            or len(torrent_hash) > 64
        ):
            raise ServiceError("bad_request")
        await self._service("qbittorrent").control(action, torrent_hash)
        self.invalidate()
