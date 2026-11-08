"""Music settings in the dashboard config: browser radio and the Spotify switch.

Pure functions (no Home Assistant imports), tested in tests/pure. Secrets
(the Spotify client id and tokens) are not part of the config; they live in
the vault (vault.py) and never reach a client.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

RADIO_MAX_STATIONS = 50
RADIO_NAME_MAX = 60
RADIO_URL_MAX = 500

DEFAULT_RADIO: dict = {
    # [{id, name, url}], https streams only
    "stations": [],
    # play files from Home Assistant's media folder in the browser
    "mediaLibrary": False,
    # station search through the integration (radio-browser.info); off by default
    "directory": False,
}

DEFAULT_SPOTIFY: dict = {
    # opt-in: needs the owner's own Spotify app and Premium (docs/SPOTIFY.md)
    "enabled": False,
    # owner devices may play in the browser via the Web Playback SDK
    "webPlayer": False,
}


def https_url(value: Any, max_len: int = RADIO_URL_MAX) -> str | None:
    """A clean absolute https URL without credentials, or None.

    An https page cannot play an http stream (mixed content), so http is
    refused here and in the panel.
    """
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw or len(raw) > max_len or any(c.isspace() for c in raw):
        return None
    try:
        parts = urlsplit(raw)
        port = parts.port  # raises on a bad port
    except ValueError:
        return None
    if parts.scheme.lower() != "https" or not parts.hostname:
        return None
    if parts.username or parts.password:
        return None
    del port
    return urlunsplit(
        ("https", parts.netloc.lower(), parts.path or "/", parts.query, "")
    )


def _station_id(value: Any, index: int, used: set[str]) -> str:
    text = value if isinstance(value, str) else ""
    clean = "".join(c for c in text if c.isalnum() or c in "-_")[:40]
    if not clean or clean in used:
        clean = f"st{index}"
        n = index
        while clean in used:
            n += 1
            clean = f"st{n}"
    used.add(clean)
    return clean


def normalize_radio(raw: Any) -> dict:
    """`radio` block: at most 50 stations with a name (≤ 60) and an https URL."""
    src = raw if isinstance(raw, dict) else {}
    stations: list[dict] = []
    used: set[str] = set()
    seen_urls: set[str] = set()
    for item in src.get("stations") if isinstance(src.get("stations"), list) else []:
        if len(stations) >= RADIO_MAX_STATIONS:
            break
        if not isinstance(item, dict):
            continue
        url = https_url(item.get("url"))
        name = item.get("name")
        name = " ".join(name.split())[:RADIO_NAME_MAX] if isinstance(name, str) else ""
        if not url or not name or url in seen_urls:
            continue
        seen_urls.add(url)
        stations.append(
            {
                "id": _station_id(item.get("id"), len(stations), used),
                "name": name,
                "url": url,
            }
        )
    return {
        "stations": stations,
        "mediaLibrary": src.get("mediaLibrary") is True,
        "directory": src.get("directory") is True,
    }


def normalize_spotify(raw: Any) -> dict:
    """`spotify` block of the config: switches only, never secrets."""
    src = raw if isinstance(raw, dict) else {}
    return {key: src.get(key) is True for key in DEFAULT_SPOTIFY}


def guest_radio(config: Any, capabilities: dict) -> dict | None:
    """What a guest gets: the station list, read-only, with allow_local_player."""
    if not capabilities.get("allow_local_player"):
        return None
    radio = normalize_radio(config.get("radio") if isinstance(config, dict) else None)
    return {
        "stations": radio["stations"],
        "mediaLibrary": radio["mediaLibrary"]
        and bool(capabilities.get("media_browse")),
    }
