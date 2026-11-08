"""Guest rules for the music engines (pure, tested in tests/pure).

Default deny: every kind needs its profile capability AND the owner's switch
in the config. Spotify goes through the integration only (no token for a
guest). Anything a guest may play must have been issued to that pass by its
own search/browse in the last 10 minutes.

Kinds:
  spotify_state       spotify_control  + config spotify.enabled
  spotify_control     spotify_control  (play/pause/next/previous/seek/volume;
                      `uri` only if issued; volume capped by max_volume)
  spotify_search      spotify_search   (results issued to the pass)
  local_media_browse  allow_local_player + media_browse + radio.mediaLibrary
  local_media_resolve same, id must be issued and playable
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .spotify import GUEST_CONTROL_ACTIONS

MUSIC_KINDS = (
    "spotify_state",
    "spotify_control",
    "spotify_search",
    "local_media_browse",
    "local_media_resolve",
)
SPOTIFY_ISSUE_PREFIX = "spotify:"


@dataclass
class MusicDecision:
    allowed: bool
    code: str = ""
    params: dict = field(default_factory=dict)


def _deny(code: str) -> MusicDecision:
    return MusicDecision(False, code)


def decide(
    kind: str,
    data: Any,
    caps: dict,
    config: Any,
    issued: Callable[[str], bool],
) -> MusicDecision:
    """Whether a guest message may run, and the cleaned parameters."""
    data = data if isinstance(data, dict) else {}
    config = config if isinstance(config, dict) else {}
    spotify_on = (config.get("spotify") or {}).get("enabled") is True
    radio = config.get("radio") if isinstance(config.get("radio"), dict) else {}

    if kind in ("spotify_state", "spotify_control"):
        if not caps.get("spotify_control"):
            return _deny("capability_disabled")
        if not spotify_on:
            return _deny("spotify_disabled")
        if kind == "spotify_state":
            return MusicDecision(True)
        action = data.get("action")
        if action not in GUEST_CONTROL_ACTIONS:
            return _deny("bad_request")
        params: dict = {"action": action, "max_volume": caps.get("max_volume", 0.7)}
        uri = data.get("uri")
        if uri is not None:
            if action != "play" or not isinstance(uri, str) or not issued(uri):
                return _deny("not_issued")
            params["uri"] = uri
        if action in ("seek", "volume"):
            value = data.get("value")
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                return _deny("bad_request")
            params["value"] = int(value)
        return MusicDecision(True, params=params)

    if kind == "spotify_search":
        if not caps.get("spotify_search"):
            return _deny("capability_disabled")
        if not spotify_on:
            return _deny("spotify_disabled")
        query = data.get("query")
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 100:
            return _deny("bad_request")
        return MusicDecision(True, params={"query": query.strip()})

    if kind in ("local_media_browse", "local_media_resolve"):
        if not caps.get("allow_local_player") or not caps.get("media_browse"):
            return _deny("capability_disabled")
        if radio.get("mediaLibrary") is not True:
            return _deny("library_disabled")
        cid = data.get("media_content_id", "")
        if not isinstance(cid, str) or len(cid) > 500:
            return _deny("bad_request")
        if kind == "local_media_browse":
            # the root is always allowed; anything below needs an issued id
            if cid and not issued(cid):
                return _deny("not_issued")
            return MusicDecision(True, params={"media_content_id": cid})
        if not cid or not issued(cid):
            return _deny("not_issued")
        return MusicDecision(True, params={"media_content_id": cid})

    return _deny("unknown_command")


def signable_media_path(url: Any) -> str | None:
    """Only HA's own relative media paths are signed for a guest."""
    if not isinstance(url, str) or not url.startswith("/") or url.startswith("//"):
        return None
    if "?" in url or "#" in url or ".." in url.split("?")[0]:
        return None
    return url
