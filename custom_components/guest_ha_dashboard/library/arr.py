"""Radarr and Sonarr v3 clients: only the endpoints and fields in docs/LIBRARY.md."""

from __future__ import annotations

from typing import Any

from .client import RELEASE_TIMEOUT, HttpService, ServiceError


def _cover(images: Any) -> dict:
    """Poster of an Arr item: {remote, local} (either may be empty)."""
    for img in images if isinstance(images, list) else []:
        if isinstance(img, dict) and img.get("coverType") == "poster":
            return {
                "remote": img.get("remoteUrl")
                if isinstance(img.get("remoteUrl"), str)
                else "",
                "local": img.get("url") if isinstance(img.get("url"), str) else "",
            }
    return {"remote": "", "local": ""}


def release_view(raw: Any) -> dict | None:
    """The fields the picker shows; nothing else leaves the integration."""
    if not isinstance(raw, dict) or not isinstance(raw.get("guid"), str):
        return None
    indexer_id = raw.get("indexerId")
    if not isinstance(indexer_id, int):
        return None
    quality = ((raw.get("quality") or {}).get("quality") or {}).get("name")
    return {
        "guid": raw["guid"],
        "indexerId": indexer_id,
        "title": str(raw.get("title") or "")[:300],
        "indexer": str(raw.get("indexer") or "")[:80],
        "size": raw.get("size") if isinstance(raw.get("size"), int) else 0,
        "seeders": raw.get("seeders") if isinstance(raw.get("seeders"), int) else None,
        "leechers": raw.get("leechers")
        if isinstance(raw.get("leechers"), int)
        else None,
        "quality": str(quality or "")[:40],
        "languages": [
            str(lang.get("name") or "")[:30]
            for lang in raw.get("languages") or []
            if isinstance(lang, dict)
        ][:6],
        "customFormatScore": raw.get("customFormatScore")
        if isinstance(raw.get("customFormatScore"), int)
        else 0,
        "rejections": [
            str(r)[:200] for r in raw.get("rejections") or [] if isinstance(r, str)
        ][:10],
        "rejected": raw.get("rejected") is True,
        "releaseGroup": str(raw.get("releaseGroup") or "")[:60],
        "protocol": str(raw.get("protocol") or "")[:12],
        "seasonNumber": raw.get("seasonNumber")
        if isinstance(raw.get("seasonNumber"), int)
        else None,
        "fullSeason": raw.get("fullSeason") is True,
    }


class ArrService(HttpService):
    """Shared Radarr/Sonarr calls (header X-Api-Key)."""

    def __init__(self, session, base_url: str, api_key: str) -> None:
        super().__init__(session, base_url)
        self._key = api_key

    def _headers(self) -> dict:
        return {"X-Api-Key": self._key}

    async def test(self) -> dict:
        body = await self.request("GET", "/api/v3/system/status")
        return {"version": str((body or {}).get("version") or "")[:20]}

    async def options(self) -> dict:
        profiles = await self.request("GET", "/api/v3/qualityprofile")
        folders = await self.request("GET", "/api/v3/rootfolder")
        return {
            "qualityProfiles": [
                {"id": p["id"], "name": str(p.get("name") or "")[:60]}
                for p in profiles or []
                if isinstance(p, dict) and isinstance(p.get("id"), int)
            ],
            "rootFolders": [
                {"path": f["path"], "accessible": f.get("accessible") is not False}
                for f in folders or []
                if isinstance(f, dict) and isinstance(f.get("path"), str)
            ],
        }

    async def queue(self) -> list[dict]:
        body = await self.request(
            "GET", "/api/v3/queue", params={"page": 1, "pageSize": 200}
        )
        return [r for r in (body or {}).get("records") or [] if isinstance(r, dict)]

    async def releases(self, params: dict) -> list[dict]:
        body = await self.request(
            "GET", "/api/v3/release", params=params, timeout=RELEASE_TIMEOUT
        )
        return [v for v in (release_view(r) for r in body or []) if v]

    async def grab(self, guid: str, indexer_id: int) -> None:
        await self.request(
            "POST", "/api/v3/release", json={"guid": guid, "indexerId": indexer_id}
        )


class Radarr(ArrService):
    name = "radarr"
    kind = "movie"

    async def library(self) -> dict[int, dict]:
        body = await self.request("GET", "/api/v3/movie")
        out = {}
        for m in body or []:
            if (
                isinstance(m, dict)
                and isinstance(m.get("tmdbId"), int)
                and isinstance(m.get("id"), int)
            ):
                out[m["tmdbId"]] = {
                    "id": m["id"],
                    "hasFile": m.get("hasFile") is True,
                    "monitored": m.get("monitored") is True,
                    "cover": _cover(m.get("images")),
                }
        return out

    async def find(self, tmdb_id: int) -> dict | None:
        body = await self.request("GET", "/api/v3/movie", params={"tmdbId": tmdb_id})
        for m in body or []:
            if isinstance(m, dict) and m.get("tmdbId") == tmdb_id:
                return m
        return None

    async def get(self, item_id: int) -> dict:
        return await self.request("GET", f"/api/v3/movie/{item_id}")

    async def lookup(self, tmdb_id: int) -> dict:
        body = await self.request(
            "GET", "/api/v3/movie/lookup/tmdb", params={"tmdbId": tmdb_id}
        )
        if not isinstance(body, dict) or body.get("tmdbId") != tmdb_id:
            raise ServiceError("not_found")
        return body

    async def search(self, term: str) -> list[dict]:
        body = await self.request("GET", "/api/v3/movie/lookup", params={"term": term})
        out = []
        for m in body or []:
            if isinstance(m, dict) and isinstance(m.get("tmdbId"), int):
                out.append(
                    {
                        "tmdbId": m["tmdbId"],
                        "mediaType": "movie",
                        "title": str(m.get("title") or "")[:200],
                        "year": m.get("year")
                        if isinstance(m.get("year"), int)
                        else None,
                        "overview": str(m.get("overview") or "")[:1200],
                        "cover": _cover(m.get("images")),
                    }
                )
        return out[:20]

    async def add(
        self, lookup: dict, profile_id: int, root: str, *, monitored: bool, search: bool
    ) -> dict:
        body = {
            **lookup,
            "qualityProfileId": profile_id,
            "rootFolderPath": root,
            "monitored": monitored,
            "addOptions": {
                "searchForMovie": search,
                "monitor": "movieOnly" if monitored else "none",
            },
        }
        body.pop("id", None)
        return await self.request("POST", "/api/v3/movie", json=body)

    async def set_monitored(self, item_id: int) -> None:
        movie = await self.get(item_id)
        movie["monitored"] = True
        await self.request(
            "PUT", f"/api/v3/movie/{item_id}", params={"moveFiles": "false"}, json=movie
        )

    async def delete(self, item_id: int) -> None:
        await self.request(
            "DELETE",
            f"/api/v3/movie/{item_id}",
            params={"deleteFiles": "false", "addImportExclusion": "false"},
        )

    async def release_list(self, item_id: int, **_: Any) -> list[dict]:
        return await self.releases({"movieId": item_id})

    @staticmethod
    def has_files(item: dict) -> bool:
        return item.get("hasFile") is True

    @staticmethod
    def queue_owner(record: dict) -> int | None:
        return record.get("movieId") if isinstance(record.get("movieId"), int) else None


class Sonarr(ArrService):
    name = "sonarr"
    kind = "tv"

    async def library(self) -> dict[int, dict]:
        body = await self.request("GET", "/api/v3/series")
        out = {}
        for s in body or []:
            if (
                isinstance(s, dict)
                and isinstance(s.get("tmdbId"), int)
                and isinstance(s.get("id"), int)
            ):
                stats = (
                    s.get("statistics") if isinstance(s.get("statistics"), dict) else {}
                )
                out[s["tmdbId"]] = {
                    "id": s["id"],
                    "hasFile": (stats.get("episodeFileCount") or 0) > 0,
                    "monitored": s.get("monitored") is True,
                    "cover": _cover(s.get("images")),
                    "seasons": [
                        x.get("seasonNumber")
                        for x in s.get("seasons") or []
                        if isinstance(x, dict)
                        and isinstance(x.get("seasonNumber"), int)
                    ],
                }
        return out

    async def find(self, tmdb_id: int) -> dict | None:
        body = await self.request("GET", "/api/v3/series")
        for s in body or []:
            if isinstance(s, dict) and s.get("tmdbId") == tmdb_id:
                return s
        return None

    async def get(self, item_id: int) -> dict:
        return await self.request("GET", f"/api/v3/series/{item_id}")

    async def lookup(self, tmdb_id: int, title: str = "") -> dict:
        """Sonarr looks up by term; match the TMDB id (UNVERIFIED that it is always set)."""
        if not title:
            raise ServiceError("not_found")
        body = await self.request(
            "GET", "/api/v3/series/lookup", params={"term": title}
        )
        for s in body or []:
            if isinstance(s, dict) and s.get("tmdbId") == tmdb_id:
                return s
        raise ServiceError("not_found")

    async def search(self, term: str) -> list[dict]:
        body = await self.request("GET", "/api/v3/series/lookup", params={"term": term})
        out = []
        for s in body or []:
            if (
                isinstance(s, dict)
                and isinstance(s.get("tmdbId"), int)
                and s["tmdbId"] > 0
            ):
                out.append(
                    {
                        "tmdbId": s["tmdbId"],
                        "mediaType": "tv",
                        "title": str(s.get("title") or "")[:200],
                        "year": s.get("year")
                        if isinstance(s.get("year"), int)
                        else None,
                        "overview": str(s.get("overview") or "")[:1200],
                        "cover": _cover(s.get("images")),
                    }
                )
        return out[:20]

    async def add(
        self, lookup: dict, profile_id: int, root: str, *, monitored: bool, search: bool
    ) -> dict:
        body = {
            **lookup,
            "qualityProfileId": profile_id,
            "rootFolderPath": root,
            "monitored": monitored,
            "seasonFolder": True,
            "addOptions": {
                "monitor": "all" if monitored else "none",
                "searchForMissingEpisodes": search,
                "searchForCutoffUnmetEpisodes": False,
            },
        }
        body.pop("id", None)
        return await self.request("POST", "/api/v3/series", json=body)

    async def set_monitored(self, item_id: int) -> None:
        series = await self.get(item_id)
        series["monitored"] = True
        await self.request(
            "PUT",
            f"/api/v3/series/{item_id}",
            params={"moveFiles": "false"},
            json=series,
        )

    async def delete(self, item_id: int) -> None:
        await self.request(
            "DELETE",
            f"/api/v3/series/{item_id}",
            params={"deleteFiles": "false", "addImportListExclusion": "false"},
        )

    async def release_list(
        self, item_id: int, season: int | None = None, episode_id: int | None = None
    ) -> list[dict]:
        if episode_id is not None:
            return await self.releases({"episodeId": episode_id})
        params = {"seriesId": item_id}
        if season is not None:
            params["seasonNumber"] = season
        return await self.releases(params)

    @staticmethod
    def has_files(item: dict) -> bool:
        stats = (
            item.get("statistics") if isinstance(item.get("statistics"), dict) else {}
        )
        return (stats.get("episodeFileCount") or 0) > 0

    @staticmethod
    def queue_owner(record: dict) -> int | None:
        return (
            record.get("seriesId") if isinstance(record.get("seriesId"), int) else None
        )
