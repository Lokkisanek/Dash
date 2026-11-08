"""Ghosts: movies/series dash added unmonitored to list their releases.

Only items recorded here are ever deleted, never a pre-existing one. Records
live in the vault (`library.ghosts`) so a restart still cleans up.
"""

from __future__ import annotations

from collections.abc import Callable

GHOST_MAX_AGE = 15 * 60
GHOSTS_MAX = 200


class Ghosts:
    def __init__(self, records: list, save: Callable[[], None]) -> None:
        self._records = records
        self._save = save

    def all(self) -> list[dict]:
        return list(self._records)

    def add(self, kind: str, item_id: int, tmdb_id: int, now: float) -> None:
        if self.find(kind, item_id):
            return
        self._records.append(
            {"kind": kind, "id": item_id, "tmdbId": tmdb_id, "created": now}
        )
        del self._records[:-GHOSTS_MAX]
        self._save()

    def find(self, kind: str, item_id: int) -> dict | None:
        return next(
            (g for g in self._records if g["kind"] == kind and g["id"] == item_id), None
        )

    def find_tmdb(self, kind: str, tmdb_id: int) -> dict | None:
        return next(
            (g for g in self._records if g["kind"] == kind and g["tmdbId"] == tmdb_id),
            None,
        )

    def forget(self, kind: str, item_id: int) -> None:
        before = len(self._records)
        self._records[:] = [
            g for g in self._records if not (g["kind"] == kind and g["id"] == item_id)
        ]
        if len(self._records) != before:
            self._save()

    def due(self, now: float, max_age: float = GHOST_MAX_AGE) -> list[dict]:
        return [g for g in self._records if now - g.get("created", 0) >= max_age]
