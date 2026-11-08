"""TMDB API v3 (opt-in, the owner's own key): configuration, trending, search."""

from __future__ import annotations

import time
from typing import Any

from .client import HttpService, ServiceError

TMDB_BASE = "https://api.themoviedb.org"
CONFIG_SECONDS = 24 * 3600


def _item(raw: Any) -> dict | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), int):
        return None
    media = raw.get("media_type")
    if media not in ("movie", "tv"):
        return None
    date = raw.get("release_date") if media == "movie" else raw.get("first_air_date")
    year = int(date[:4]) if isinstance(date, str) and date[:4].isdigit() else None
    poster = raw.get("poster_path")
    return {
        "tmdbId": raw["id"],
        "mediaType": media,
        "title": str(raw.get("title") or raw.get("name") or "")[:200],
        "year": year,
        "overview": str(raw.get("overview") or "")[:1200],
        "posterPath": poster if isinstance(poster, str) else "",
    }


class Tmdb(HttpService):
    name = "tmdb"

    def __init__(
        self,
        session,
        api_key: str,
        *,
        base_url: str = TMDB_BASE,
        language: str = "cs-CZ",
    ) -> None:
        super().__init__(session, base_url)
        self._key = api_key
        self._language = language
        self._config: dict | None = None
        self._config_at = 0.0

    def _headers(self) -> dict:
        # a read access token (a JWT) goes in the header, a v3 key as api_key
        return (
            {"Authorization": f"Bearer {self._key}"}
            if self._key.startswith("eyJ")
            else {}
        )

    def _auth(self, params: dict) -> dict:
        return (
            params if self._key.startswith("eyJ") else {**params, "api_key": self._key}
        )

    async def get(self, path: str, params: dict | None = None) -> Any:
        return await self.request("GET", path, params=self._auth(params or {}))

    async def test(self) -> dict:
        await self.image_config(force=True)
        return {}

    async def image_config(self, force: bool = False) -> dict:
        """images.secure_base_url and poster_sizes (cached a day)."""
        if (
            self._config
            and not force
            and time.monotonic() - self._config_at < CONFIG_SECONDS
        ):
            return self._config
        body = await self.get("/3/configuration")
        images = (body or {}).get("images") if isinstance(body, dict) else None
        base = (images or {}).get("secure_base_url")
        if not isinstance(base, str) or not base.startswith("https://"):
            raise ServiceError("bad_response")
        self._config = {
            "base": base,
            "sizes": [
                s for s in images.get("poster_sizes") or [] if isinstance(s, str)
            ],
        }
        self._config_at = time.monotonic()
        return self._config

    async def trending(self, media: str = "all") -> list[dict]:
        media = media if media in ("all", "movie", "tv") else "all"
        body = await self.get(f"/3/trending/{media}/week", {"language": self._language})
        results = (body or {}).get("results") if isinstance(body, dict) else None
        items = []
        for raw in results or []:
            if media != "all" and isinstance(raw, dict):
                raw = {**raw, "media_type": media}
            item = _item(raw)
            if item:
                items.append(item)
        return items[:40]

    async def search(self, query: str) -> list[dict]:
        body = await self.get(
            "/3/search/multi",
            {
                "query": query,
                "include_adult": "false",
                "language": self._language,
                "page": 1,
            },
        )
        results = (body or {}).get("results") if isinstance(body, dict) else None
        return [i for i in (_item(r) for r in results or []) if i][:40]
