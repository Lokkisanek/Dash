"""`library` block of the dashboard config (no secrets; those live in the vault)."""

from __future__ import annotations

import re
from typing import Any

DEFAULT_LIBRARY: dict = {
    "enabled": False,
    # default pickers for "Automaticky" / "Vybrat release"
    "movieProfileId": None,
    "movieRootFolder": "",
    "tvProfileId": None,
    "tvRootFolder": "",
    # activity polling while someone watches (seconds)
    "interval": 3,
}


def normalize_library(raw: Any) -> dict:
    src = raw if isinstance(raw, dict) else {}

    def profile(v: Any) -> int | None:
        return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else None

    def folder(v: Any) -> str:
        # an absolute path as the Arr reports it (/movies, or D:\Movies on Windows)
        if not isinstance(v, str) or not v.strip():
            return ""
        v = v.strip()[:300]
        return v if v.startswith("/") or re.match(r"^[A-Za-z]:\\", v) else ""

    interval = src.get("interval")
    return {
        "enabled": src.get("enabled") is True,
        "movieProfileId": profile(src.get("movieProfileId")),
        "movieRootFolder": folder(src.get("movieRootFolder")),
        "tvProfileId": profile(src.get("tvProfileId")),
        "tvRootFolder": folder(src.get("tvRootFolder")),
        "interval": int(min(30, max(2, interval)))
        if isinstance(interval, (int, float)) and not isinstance(interval, bool)
        else 3,
    }


def defaults_for(config: Any, media: str) -> tuple[int | None, str]:
    lib = normalize_library(
        (config or {}).get("library") if isinstance(config, dict) else None
    )
    if media == "movie":
        return lib["movieProfileId"], lib["movieRootFolder"]
    return lib["tvProfileId"], lib["tvRootFolder"]
