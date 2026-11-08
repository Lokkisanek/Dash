"""Requests inbox: a guest asks, the owner approves, picks a release or declines."""

from __future__ import annotations

from collections.abc import Callable
import secrets
from typing import Any

REQUESTS_MAX = 200
STATUSES = ("pending", "approved", "downloading", "available", "declined")
OPEN = ("pending", "approved", "downloading")


class Inbox:
    def __init__(self, records: list, save: Callable[[], None]) -> None:
        self._records = records
        self._save = save

    def create(
        self,
        *,
        tmdb_id: int,
        media_type: str,
        title: str,
        year: Any,
        poster: str,
        requester: str,
        pass_id: str,
        created: str,
    ) -> dict:
        for r in self._records:
            # the same open request twice is one request
            if (
                r["tmdbId"] == tmdb_id
                and r["mediaType"] == media_type
                and r["status"] in OPEN
            ):
                return r
        rec = {
            "id": secrets.token_hex(8),
            "tmdbId": tmdb_id,
            "mediaType": media_type,
            "title": str(title or "")[:200],
            "year": year if isinstance(year, int) else None,
            "poster": poster if isinstance(poster, str) else "",
            "requester": str(requester or "")[:80],
            "passId": pass_id,
            "created": created,
            "status": "pending",
            "note": "",
        }
        self._records.append(rec)
        self._prune()
        self._save()
        return rec

    def _prune(self) -> None:
        while len(self._records) > REQUESTS_MAX:
            resolved = next(
                (
                    i
                    for i, r in enumerate(self._records)
                    if r["status"] in ("declined", "available")
                ),
                None,
            )
            # keep open requests; if all are open, the oldest goes
            self._records.pop(resolved if resolved is not None else 0)

    def get(self, request_id: Any) -> dict | None:
        return next((r for r in self._records if r["id"] == request_id), None)

    def list(self, pass_id: str | None = None) -> list[dict]:
        items = [r for r in self._records if pass_id is None or r["passId"] == pass_id]
        return sorted(items, key=lambda r: r["created"], reverse=True)

    def set_status(self, request_id: Any, status: str, note: str = "") -> dict | None:
        rec = self.get(request_id)
        if rec is None or status not in STATUSES:
            return None
        rec["status"] = status
        if note:
            rec["note"] = str(note)[:300]
        self._save()
        return rec

    def pending_count(self) -> int:
        return sum(1 for r in self._records if r["status"] == "pending")

    @staticmethod
    def public(rec: dict, *, guest: bool) -> dict:
        """A guest never sees other passes or ids beyond their own request."""
        out = {k: v for k, v in rec.items() if k != "passId"}
        if guest:
            out.pop("requester", None)
        return out
