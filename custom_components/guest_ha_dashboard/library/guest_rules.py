"""Guest rules for Videotéka (pure, tested in tests/pure). Default deny.

library_discover, library_search,   library_browse
library_detail, library_poster
library_request                     library_request (+ daily cap, TV only with library_allow_tv)
library_releases                    library_pick_release, item opened by this pass ≤ 10 min ago
library_grab                        library_pick_release, (guid, indexerId) listed to this pass
library_activity                    library_activity (read-only, no torrent controls)
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

LIBRARY_KINDS = (
    "library_discover",
    "library_search",
    "library_detail",
    "library_poster",
    "library_request",
    "library_releases",
    "library_grab",
    "library_activity",
    "library_requests",
)
ISSUE_TTL = 10 * 60
ISSUE_MAX = 300

_NEEDS = {
    "library_discover": "library_browse",
    "library_search": "library_browse",
    "library_detail": "library_browse",
    "library_poster": "library_browse",
    "library_requests": "library_request",
    "library_request": "library_request",
    "library_releases": "library_pick_release",
    "library_grab": "library_pick_release",
    "library_activity": "library_activity",
}


@dataclass
class LibraryDecision:
    allowed: bool
    code: str = ""
    params: dict = field(default_factory=dict)


class PassIssues:
    """What one pass was shown recently: opened items and listed release pairs (LRU)."""

    def __init__(self) -> None:
        self.items: OrderedDict[str, float] = OrderedDict()
        self.releases: OrderedDict[str, float] = OrderedDict()

    @staticmethod
    def _put(store: OrderedDict, key: str, now: float) -> None:
        store[key] = now + ISSUE_TTL
        store.move_to_end(key)
        while len(store) > ISSUE_MAX:
            store.popitem(last=False)

    def open_item(self, media: str, tmdb_id: int, now: float) -> None:
        self._put(self.items, f"{media}:{tmdb_id}", now)

    def list_releases(
        self, media: str, tmdb_id: int, pairs: list[tuple[str, int]], now: float
    ) -> None:
        for guid, indexer in pairs:
            self._put(self.releases, f"{media}:{tmdb_id}|{indexer}|{guid}", now)

    def item_ok(self, media: str, tmdb_id: int, now: float) -> bool:
        return self.items.get(f"{media}:{tmdb_id}", 0) > now

    def release_ok(
        self, media: str, tmdb_id: int, guid: str, indexer: int, now: float
    ) -> bool:
        return self.releases.get(f"{media}:{tmdb_id}|{indexer}|{guid}", 0) > now


def _media(data: dict) -> tuple[str, int] | None:
    media = data.get("media_type")
    tmdb_id = data.get("tmdb_id")
    if (
        media not in ("movie", "tv")
        or not isinstance(tmdb_id, int)
        or isinstance(tmdb_id, bool)
        or tmdb_id <= 0
    ):
        return None
    return media, tmdb_id


def decide(
    kind: str,
    data: Any,
    caps: dict,
    issues: PassIssues,
    now: float,
    *,
    requests_today: int = 0,
) -> LibraryDecision:
    data = data if isinstance(data, dict) else {}
    need = _NEEDS.get(kind)
    if need is None:
        return LibraryDecision(False, "unknown_command")
    if not caps.get(need):
        return LibraryDecision(False, "capability_disabled")

    if kind in ("library_discover", "library_activity", "library_requests"):
        media = data.get("media", "all")
        return LibraryDecision(
            True, params={"media": media if media in ("all", "movie", "tv") else "all"}
        )
    if kind == "library_search":
        q = data.get("query")
        if not isinstance(q, str) or not 1 <= len(q.strip()) <= 100:
            return LibraryDecision(False, "bad_request")
        return LibraryDecision(True, params={"query": q.strip()})
    if kind == "library_poster":
        token = data.get("poster")
        if not isinstance(token, str) or not token.isalnum() or len(token) > 64:
            return LibraryDecision(False, "bad_request")
        return LibraryDecision(True, params={"poster": token})

    item = _media(data)
    if item is None:
        return LibraryDecision(False, "bad_request")
    media, tmdb_id = item
    if media == "tv" and not caps.get("library_allow_tv", True):
        return LibraryDecision(False, "tv_disabled")
    params = {"media_type": media, "tmdb_id": tmdb_id}

    if kind == "library_detail":
        return LibraryDecision(True, params=params)
    if kind == "library_request":
        cap = int(caps.get("library_max_per_day", 3))
        if requests_today >= cap:
            return LibraryDecision(False, "daily_limit")
        return LibraryDecision(True, params=params)
    if kind == "library_releases":
        if not issues.item_ok(media, tmdb_id, now):
            return LibraryDecision(False, "not_issued")
        season = data.get("season")
        if season is not None and (
            not isinstance(season, int)
            or isinstance(season, bool)
            or not 0 <= season <= 100
        ):
            return LibraryDecision(False, "bad_request")
        return LibraryDecision(True, params={**params, "season": season})
    if kind == "library_grab":
        guid = data.get("guid")
        indexer = data.get("indexer_id")
        if (
            not isinstance(guid, str)
            or not isinstance(indexer, int)
            or isinstance(indexer, bool)
        ):
            return LibraryDecision(False, "bad_request")
        if not issues.item_ok(media, tmdb_id, now) or not issues.release_ok(
            media, tmdb_id, guid, indexer, now
        ):
            return LibraryDecision(False, "not_issued")
        return LibraryDecision(
            True, params={**params, "guid": guid, "indexer_id": indexer}
        )
    return LibraryDecision(False, "unknown_command")


def day_count(record: Any, today: str) -> int:
    """Requests this pass made today (stored with the pass: {day, count})."""
    if (
        isinstance(record, dict)
        and record.get("day") == today
        and isinstance(record.get("count"), int)
    ):
        return record["count"]
    return 0
