"""Optional Spotify engine: PKCE sign-in, tokens and a Connect proxy.

Every request and field here was checked against Spotify's documentation on
2026-11-08 (docs/PLAYER_ENGINES.md). No Home Assistant imports: the HA glue
(websocket_api.py, guest_ws.py) passes in an aiohttp session, the vault data
and a save callback, and tests/pure drive it against a fake Spotify.

Secrets (refresh and access token, PKCE verifiers) stay in `data`, which is
the `spotify` section of the vault. Public methods return only what a client
may see; `access_token()` is the one exception and is used solely for the
owner's own Web Playback SDK.
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable
import hashlib
import re
import secrets
import time
from typing import Any
from urllib.parse import urlencode, urlsplit

import aiohttp

ACCOUNTS_BASE = "https://accounts.spotify.com"
API_BASE = "https://api.spotify.com/v1"

# Minimum scopes (docs/PLAYER_ENGINES.md): SDK, Connect read/write, search,
# own playlists, saved tracks. No e-mail.
SCOPES = (
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-private",
    "playlist-read-private",
    "user-library-read",
)

STATE_TTL_SECONDS = 600
PENDING_MAX = 10
SEARCH_LIMIT_MAX = 10  # Development Mode since February 2026
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=15)
CLIENT_ID_RE = re.compile(r"^[0-9a-zA-Z]{16,64}$")
VERIFIER_CHARS = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")
SPOTIFY_URI_RE = re.compile(
    r"^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]{1,64}$"
)
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9]{1,128}$")

CONTROL_ACTIONS = ("play", "pause", "next", "previous", "seek", "volume", "transfer")
GUEST_CONTROL_ACTIONS = ("play", "pause", "next", "previous", "seek", "volume")


class SpotifyError(Exception):
    """A failure with a code that is safe to show (never upstream text)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def new_verifier() -> str:
    """64 random bytes, base64url without padding: 86 chars of [A-Za-z0-9_-]."""
    return secrets.token_urlsafe(64)


def code_challenge(verifier: str) -> str:
    """S256: base64url(sha256(verifier)) without padding (RFC 7636 4.2)."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def valid_redirect_uri(value: Any) -> str | None:
    """https, or a loopback IP literal over http (Spotify's redirect URI rules)."""
    if (
        not isinstance(value, str)
        or len(value) > 300
        or any(c.isspace() for c in value)
    ):
        return None
    try:
        parts = urlsplit(value)
        parts.port  # noqa: B018 - raises on a bad port
    except ValueError:
        return None
    if parts.username or parts.password or parts.fragment or not parts.hostname:
        return None
    if parts.scheme == "https":
        return value
    if parts.scheme == "http" and parts.hostname in ("127.0.0.1", "::1"):
        return value
    return None


def _image(images: Any) -> str:
    if isinstance(images, list) and images and isinstance(images[0], dict):
        url = images[0].get("url")
        return url if isinstance(url, str) and url.startswith("https://") else ""
    return ""


def _device(raw: Any) -> dict | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
        return None
    return {
        "id": raw["id"],
        "name": str(raw.get("name") or "")[:80],
        "type": str(raw.get("type") or "")[:30],
        "is_active": raw.get("is_active") is True,
        "is_restricted": raw.get("is_restricted") is True,
        "volume_percent": raw.get("volume_percent")
        if isinstance(raw.get("volume_percent"), int)
        else None,
        "supports_volume": raw.get("supports_volume") is True,
    }


def _item(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    album = raw.get("album") if isinstance(raw.get("album"), dict) else {}
    return {
        "uri": raw.get("uri") if isinstance(raw.get("uri"), str) else "",
        "name": str(raw.get("name") or "")[:200],
        "artists": [
            str(a.get("name") or "")[:100]
            for a in raw.get("artists") or []
            if isinstance(a, dict)
        ][:5],
        "album": str(album.get("name") or "")[:200],
        "image": _image(album.get("images") or raw.get("images")),
        "duration_ms": raw.get("duration_ms")
        if isinstance(raw.get("duration_ms"), int)
        else None,
    }


class SpotifyService:
    """One owner's Spotify connection (the `spotify` section of the vault)."""

    def __init__(
        self,
        data: dict,
        save: Callable[[], None],
        session: Callable[[], aiohttp.ClientSession],
        *,
        accounts_base: str = ACCOUNTS_BASE,
        api_base: str = API_BASE,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.data = data
        self._save = save
        self._session = session
        self._accounts = accounts_base.rstrip("/")
        self._api = api_base.rstrip("/")
        self._clock = clock
        self._refresh_lock = asyncio.Lock()

    # ─── public status ─────────────────────────────────────────────────────

    def status(self) -> dict:
        """What the panel shows; no token, verifier or state ever."""
        return {
            "configured": bool(self.data.get("client_id")),
            "client_id": self.data.get("client_id") or "",
            "redirect_uri": self.data.get("redirect_uri") or "",
            "connected": bool(self.data.get("refresh_token")),
            "display_name": self.data.get("display_name") or "",
            "scopes": list(SCOPES),
        }

    def configure(self, client_id: Any, redirect_uri: Any) -> dict:
        if not isinstance(client_id, str) or not CLIENT_ID_RE.match(client_id):
            raise SpotifyError("bad_client_id")
        uri = valid_redirect_uri(redirect_uri)
        if not uri:
            raise SpotifyError("bad_redirect_uri")
        if client_id != self.data.get("client_id"):
            # tokens belong to the old app
            self._forget_tokens()
        self.data["client_id"] = client_id
        self.data["redirect_uri"] = uri
        self._save()
        return self.status()

    def disconnect(self) -> dict:
        self._forget_tokens()
        self._save()
        return self.status()

    def _forget_tokens(self) -> None:
        for key in ("refresh_token", "access_token", "expires_at", "display_name"):
            self.data.pop(key, None)
        self.data["pending"] = {}

    # ─── sign-in (PKCE, state single use, 10 minutes) ──────────────────────

    def start(self) -> dict:
        """Authorize URL for the popup; state and verifier stay here."""
        client_id = self.data.get("client_id")
        redirect = self.data.get("redirect_uri")
        if not client_id or not redirect:
            raise SpotifyError("not_configured")
        now = self._clock()
        pending = {
            k: v
            for k, v in (self.data.get("pending") or {}).items()
            if isinstance(v, dict) and now - v.get("created", 0) < STATE_TTL_SECONDS
        }
        while len(pending) >= PENDING_MAX:
            pending.pop(next(iter(pending)))
        state = secrets.token_urlsafe(24)
        verifier = new_verifier()
        pending[state] = {
            "verifier": verifier,
            "created": now,
            "redirect_uri": redirect,
        }
        self.data["pending"] = pending
        self._save()
        query = urlencode(
            {
                "client_id": client_id,
                "response_type": "code",
                "redirect_uri": redirect,
                "code_challenge_method": "S256",
                "code_challenge": code_challenge(verifier),
                "state": state,
                "scope": " ".join(SCOPES),
            }
        )
        return {"authorize_url": f"{self._accounts}/authorize?{query}"}

    async def finish(self, code: Any, state: Any) -> dict:
        """Exchange the code for tokens; the state is spent whatever happens."""
        pending = self.data.get("pending") or {}
        entry = pending.pop(state, None) if isinstance(state, str) else None
        self.data["pending"] = pending
        self._save()
        if not isinstance(entry, dict):
            raise SpotifyError("bad_state")
        if self._clock() - entry.get("created", 0) >= STATE_TTL_SECONDS:
            raise SpotifyError("state_expired")
        if not isinstance(code, str) or not 10 <= len(code) <= 1024:
            raise SpotifyError("bad_request")
        body = await self._token_request(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": entry["redirect_uri"],
                "client_id": self.data.get("client_id") or "",
                "code_verifier": entry["verifier"],
            }
        )
        if not body.get("refresh_token"):
            raise SpotifyError("auth_failed")
        self._store_tokens(body)
        try:
            me = await self.api("GET", "/me")
            self.data["display_name"] = str(
                (me or {}).get("display_name") or (me or {}).get("id") or ""
            )[:80]
        except SpotifyError:
            self.data["display_name"] = ""
        self._save()
        return self.status()

    def _store_tokens(self, body: dict) -> None:
        token = body.get("access_token")
        expires = body.get("expires_in")
        if not isinstance(token, str) or not isinstance(expires, int):
            raise SpotifyError("auth_failed")
        self.data["access_token"] = token
        self.data["expires_at"] = self._clock() + expires
        # PKCE refresh "might not include a new refresh token": keep the old one
        if isinstance(body.get("refresh_token"), str) and body["refresh_token"]:
            self.data["refresh_token"] = body["refresh_token"]

    async def _token_request(self, form: dict) -> dict:
        try:
            async with self._session().post(
                f"{self._accounts}/api/token",
                data=form,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=REQUEST_TIMEOUT,
                allow_redirects=False,
            ) as resp:
                if resp.status == 429:
                    raise SpotifyError("rate_limited")
                if resp.status >= 500:
                    raise SpotifyError("unavailable")
                if resp.status != 200:
                    raise SpotifyError("auth_failed")
                body = await resp.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            raise SpotifyError("unavailable") from err
        if not isinstance(body, dict):
            raise SpotifyError("auth_failed")
        return body

    async def access_token(self) -> str:
        """A valid access token, refreshed when it expires within a minute."""
        if not self.data.get("refresh_token"):
            raise SpotifyError("not_connected")
        async with self._refresh_lock:
            expires = self.data.get("expires_at") or 0
            if self.data.get("access_token") and expires - self._clock() > 60:
                return self.data["access_token"]
            body = await self._token_request(
                {
                    "grant_type": "refresh_token",
                    "refresh_token": self.data["refresh_token"],
                    "client_id": self.data.get("client_id") or "",
                }
            )
            self._store_tokens(body)
            self._save()
            return self.data["access_token"]

    async def owner_token(self) -> dict:
        """For the owner's Web Playback SDK only: access token and its lifetime."""
        token = await self.access_token()
        return {
            "access_token": token,
            "expires_in": max(
                0, int((self.data.get("expires_at") or 0) - self._clock())
            ),
        }

    # ─── Web API ───────────────────────────────────────────────────────────

    async def api(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json: dict | None = None,
    ) -> Any:
        token = await self.access_token()
        try:
            async with self._session().request(
                method,
                f"{self._api}{path}",
                params=params,
                json=json,
                headers={"Authorization": f"Bearer {token}"},
                timeout=REQUEST_TIMEOUT,
                allow_redirects=False,
            ) as resp:
                if resp.status in (202, 204):
                    return None
                if resp.status == 401:
                    # forget the access token; the next call refreshes it
                    self.data["expires_at"] = 0
                    raise SpotifyError("auth_failed")
                if resp.status == 403:
                    raise SpotifyError("premium_required")
                if resp.status == 404:
                    raise SpotifyError("no_device")
                if resp.status == 429:
                    raise SpotifyError("rate_limited")
                if resp.status >= 500:
                    raise SpotifyError("unavailable")
                if resp.status >= 400:
                    raise SpotifyError("bad_request")
                return await resp.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            raise SpotifyError("unavailable") from err

    async def devices(self) -> list[dict]:
        body = await self.api("GET", "/me/player/devices")
        raw = body.get("devices") if isinstance(body, dict) else None
        return [d for d in (_device(x) for x in raw or []) if d][:20]

    async def player_state(self, *, guest: bool = False) -> dict:
        body = await self.api("GET", "/me/player")
        if not isinstance(body, dict):
            return {
                "is_playing": False,
                "device": None,
                "item": None,
                "progress_ms": None,
            }
        item = _item(body.get("item"))
        if item and guest:
            item["image"] = ""  # a guest browser never contacts Spotify's CDN
        return {
            "is_playing": body.get("is_playing") is True,
            "device": _device(body.get("device")),
            "item": item,
            "progress_ms": body.get("progress_ms")
            if isinstance(body.get("progress_ms"), int)
            else None,
        }

    async def control(
        self,
        action: Any,
        *,
        value: Any = None,
        device_id: Any = None,
        uri: Any = None,
        max_volume: float = 1.0,
        allowed: tuple[str, ...] = CONTROL_ACTIONS,
    ) -> None:
        if action not in allowed:
            raise SpotifyError("bad_request")
        params: dict = {}
        if device_id is not None:
            if not isinstance(device_id, str) or not DEVICE_ID_RE.match(device_id):
                raise SpotifyError("bad_request")
            params["device_id"] = device_id
        if action == "play":
            body: dict | None = None
            if uri is not None:
                if not isinstance(uri, str) or not SPOTIFY_URI_RE.match(uri):
                    raise SpotifyError("bad_request")
                kind = uri.split(":")[1]
                body = (
                    {"uris": [uri]}
                    if kind in ("track", "episode")
                    else {"context_uri": uri}
                )
            await self.api("PUT", "/me/player/play", params=params, json=body)
        elif action == "pause":
            await self.api("PUT", "/me/player/pause", params=params)
        elif action in ("next", "previous"):
            await self.api("POST", f"/me/player/{action}", params=params)
        elif action == "seek":
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise SpotifyError("bad_request")
            await self.api(
                "PUT", "/me/player/seek", params={**params, "position_ms": value}
            )
        elif action == "volume":
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise SpotifyError("bad_request")
            cap = round(max(0.0, min(1.0, max_volume)) * 100)
            percent = max(0, min(cap, round(value)))
            await self.api(
                "PUT", "/me/player/volume", params={**params, "volume_percent": percent}
            )
        elif action == "transfer":
            if "device_id" not in params:
                raise SpotifyError("bad_request")
            await self.api(
                "PUT",
                "/me/player",
                json={"device_ids": [params["device_id"]], "play": value is True},
            )

    async def search(self, query: Any, *, guest: bool = False) -> list[dict]:
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 100:
            raise SpotifyError("bad_request")
        body = await self.api(
            "GET",
            "/search",
            params={
                "q": query.strip(),
                "type": "track,album,playlist",
                "limit": SEARCH_LIMIT_MAX,
            },
        )
        out: list[dict] = []
        for kind in ("tracks", "albums", "playlists"):
            block = body.get(kind) if isinstance(body, dict) else None
            for raw in (block or {}).get("items") or []:
                item = _item(raw)
                if item and SPOTIFY_URI_RE.match(item["uri"]):
                    if guest:
                        item["image"] = ""
                    out.append({**item, "kind": kind[:-1]})
        return out

    async def playlists(self) -> list[dict]:
        body = await self.api("GET", "/me/playlists", params={"limit": 50})
        out = []
        for raw in (body or {}).get("items") or []:
            item = _item(raw)
            if item and SPOTIFY_URI_RE.match(item["uri"]):
                out.append({**item, "kind": "playlist"})
        return out

    async def saved_tracks(self) -> list[dict]:
        body = await self.api("GET", "/me/tracks", params={"limit": 50})
        out = []
        for raw in (body or {}).get("items") or []:
            item = _item(raw.get("track") if isinstance(raw, dict) else None)
            if item and SPOTIFY_URI_RE.match(item["uri"]):
                out.append({**item, "kind": "track"})
        return out
