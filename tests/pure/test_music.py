"""Music engines on the server: radio config, Spotify PKCE/tokens/proxy, guest rules.

Spotify is a fake aiohttp server here (same paths as the real Web API and
accounts service, docs/PLAYER_ENGINES.md); no Home Assistant needed.
"""

from __future__ import annotations

import json
import logging

from _loader import load
import aiohttp
from aiohttp import web
from aiohttp.test_utils import TestServer
import pytest

# Fake servers listen on 127.0.0.1; the Home Assistant pytest plugin (CI) blocks
# sockets unless a test asks for them, as HA's own client fixtures do.
pytestmark = pytest.mark.usefixtures("socket_enabled")

music = load("music")
spotify = load("spotify")
guest_music = load("guest_music")
policy = load("guest_policy")
radio_directory = load("radio_directory")
const = load("const")

FAKE_REFRESH = "fake-refresh-token-AAAA1111"
FAKE_ACCESS = "fake-access-token-BBBB2222"
FAKE_ACCESS_2 = "fake-access-token-CCCC3333"
CLIENT_ID = "0123456789abcdef0123456789abcdef"


# ─── radio config ────────────────────────────────────────────────────────────


def test_radio_keeps_https_streams_only() -> None:
    radio = music.normalize_radio(
        {
            "stations": [
                {
                    "name": "  Radio   One ",
                    "url": "https://Stream.Example.com/live.mp3",
                },
                {"name": "Plain http", "url": "http://stream.example.com/x"},
                {"name": "Creds", "url": "https://user:pw@stream.example.com/x"},
                {"name": "", "url": "https://stream.example.com/noname"},
                {"name": "Dup", "url": "https://stream.example.com/live.mp3"},
                {"name": "Script", "url": "javascript:alert(1)"},
                {"name": "x" * 80, "url": "https://b.example.com/s"},
                "junk",
            ],
            "mediaLibrary": "yes",
            "directory": True,
        }
    )
    assert [s["name"] for s in radio["stations"]] == ["Radio One", "x" * 60]
    assert radio["stations"][0]["url"] == "https://stream.example.com/live.mp3"
    assert radio["mediaLibrary"] is False
    assert radio["directory"] is True
    assert len({s["id"] for s in radio["stations"]}) == 2


def test_radio_caps_the_station_list() -> None:
    stations = [
        {"name": f"S{i}", "url": f"https://s{i}.example.com/"} for i in range(80)
    ]
    assert len(music.normalize_radio({"stations": stations})["stations"]) == 50


def test_defaults_are_off() -> None:
    assert const.DEFAULT_CONFIG["spotify"] == {"enabled": False, "webPlayer": False}
    assert const.DEFAULT_CONFIG["radio"]["directory"] is False
    for key in ("allow_local_player", "spotify_control", "spotify_search"):
        assert const.GUEST_CAPABILITY_DEFAULTS[key] is False
    assert music.normalize_spotify({"enabled": 1}) == {
        "enabled": False,
        "webPlayer": False,
    }


# ─── guest config ────────────────────────────────────────────────────────────

CONFIG = {
    "radio": {
        "stations": [{"id": "a", "name": "A", "url": "https://a.example.com/"}],
        "mediaLibrary": True,
    },
    "spotify": {"enabled": True, "webPlayer": True},
    "pages": [
        {
            "id": "p",
            "devices": [
                {"id": "light.a", "type": "light"},
                {"type": "player", "source": "browser"},
                {"type": "player", "source": "spotify"},
            ],
        }
    ],
}


def _guest(caps: dict) -> dict:
    profile = {"entities": {"light.a": {}}, "capabilities": caps}
    return policy.filter_config(CONFIG, profile)


def test_guest_gets_no_player_radio_or_spotify_by_default() -> None:
    cfg = _guest({})
    assert [d["type"] for d in cfg["pages"][0]["devices"]] == ["light"]
    assert "radio" not in cfg
    assert cfg["spotify"] == {"enabled": False, "webPlayer": False}


def test_guest_local_player_gets_stations_read_only() -> None:
    cfg = _guest({"allow_local_player": True})
    assert [d.get("source") for d in cfg["pages"][0]["devices"]] == [None, "browser"]
    assert cfg["radio"]["stations"][0]["url"] == "https://a.example.com/"
    # the media folder needs media_browse as well
    assert cfg["radio"]["mediaLibrary"] is False
    assert _guest({"allow_local_player": True, "media_browse": True})["radio"][
        "mediaLibrary"
    ]


def test_guest_spotify_control_shows_the_tile_never_a_token() -> None:
    cfg = _guest({"spotify_control": True})
    assert [d.get("source") for d in cfg["pages"][0]["devices"]] == [None, "spotify"]
    assert cfg["spotify"] == {"enabled": True, "webPlayer": False}


# ─── guest kinds (default deny) ──────────────────────────────────────────────


def _decide(kind, data=None, caps=None, config=CONFIG, issued=()):
    return guest_music.decide(
        kind, data or {}, caps or {}, config, lambda x: x in set(issued)
    )


@pytest.mark.parametrize("kind", guest_music.MUSIC_KINDS)
def test_every_music_kind_is_off_by_default(kind: str) -> None:
    decision = _decide(kind, {"action": "pause", "query": "x", "media_content_id": ""})
    assert not decision.allowed
    assert decision.code == "capability_disabled"


def test_spotify_needs_the_owner_switch_too() -> None:
    off = {**CONFIG, "spotify": {"enabled": False}}
    d = _decide("spotify_control", {"action": "pause"}, {"spotify_control": True}, off)
    assert (d.allowed, d.code) == (False, "spotify_disabled")


def test_spotify_control_rules() -> None:
    caps = {"spotify_control": True, "max_volume": 0.4}
    ok = _decide("spotify_control", {"action": "volume", "value": 90}, caps)
    assert ok.allowed and ok.params == {
        "action": "volume",
        "max_volume": 0.4,
        "value": 90,
    }
    # transfer to another device is for the owner only
    assert not _decide("spotify_control", {"action": "transfer"}, caps).allowed
    uri = "spotify:track:abc"
    assert _decide("spotify_control", {"action": "play", "uri": uri}, caps).code == (
        "not_issued"
    )
    assert _decide(
        "spotify_control", {"action": "play", "uri": uri}, caps, issued=[uri]
    ).allowed
    assert not _decide(
        "spotify_control", {"action": "seek", "value": True}, caps
    ).allowed


def test_local_media_needs_both_switches_the_library_and_issued_ids() -> None:
    caps = {"allow_local_player": True, "media_browse": True}
    root = _decide("local_media_browse", {"media_content_id": ""}, caps)
    assert root.allowed
    deep = "media-source://media_source/local/a.mp3"
    assert _decide("local_media_resolve", {"media_content_id": deep}, caps).code == (
        "not_issued"
    )
    assert _decide(
        "local_media_resolve", {"media_content_id": deep}, caps, issued=[deep]
    ).allowed
    no_lib = {**CONFIG, "radio": {"mediaLibrary": False}}
    assert _decide("local_media_browse", {}, caps, no_lib).code == "library_disabled"
    assert not _decide("local_media_browse", {}, {"allow_local_player": True}).allowed


def test_only_relative_ha_paths_are_signed() -> None:
    assert guest_music.signable_media_path("/media/local/a.mp3") == "/media/local/a.mp3"
    for bad in ("https://x/a.mp3", "//evil/a", "/media/../a", "/a?authSig=1", None):
        assert guest_music.signable_media_path(bad) is None


# ─── Spotify: PKCE ───────────────────────────────────────────────────────────


def test_pkce_matches_rfc7636_appendix_b() -> None:
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert (
        spotify.code_challenge(verifier)
        == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    )


def test_verifier_follows_the_rules() -> None:
    for _ in range(20):
        v = spotify.new_verifier()
        assert spotify.VERIFIER_CHARS.match(v)


@pytest.mark.parametrize(
    ("uri", "ok"),
    [
        ("https://dash.example.com/spotify-callback.html", True),
        ("http://127.0.0.1:8080/cb", True),
        ("http://[::1]/cb", True),
        ("http://localhost:8080/cb", False),
        ("http://homeassistant.local:8123/cb", False),
        ("https://user:pw@dash.example.com/cb", False),
        ("https://dash.example.com/cb#x", False),
    ],
)
def test_redirect_uri_rules(uri: str, ok: bool) -> None:
    assert (spotify.valid_redirect_uri(uri) is not None) is ok


# ─── Spotify: fake service ───────────────────────────────────────────────────


class FakeSpotify:
    """Accounts + Web API with the documented paths; records what it got."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict, str]] = []
        self.refresh_returns_new = True
        self.app = web.Application()
        self.app.router.add_post("/api/token", self.token)
        self.app.router.add_route("*", "/v1/{tail:.*}", self.api)

    async def token(self, request: web.Request) -> web.Response:
        form = dict(await request.post())
        self.requests.append(("POST", "/api/token", form, ""))
        if form.get("grant_type") == "authorization_code":
            if form.get("code_verifier") is None or form.get("client_id") != CLIENT_ID:
                return web.json_response({"error": "invalid_grant"}, status=400)
            return web.json_response(
                {
                    "access_token": FAKE_ACCESS,
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "refresh_token": FAKE_REFRESH,
                    "scope": "streaming",
                }
            )
        if form.get("grant_type") == "refresh_token":
            body = {
                "access_token": FAKE_ACCESS_2,
                "expires_in": 3600,
                "token_type": "Bearer",
            }
            if self.refresh_returns_new:
                body["refresh_token"] = FAKE_REFRESH + "-new"
            return web.json_response(body)
        return web.json_response({}, status=400)

    async def api(self, request: web.Request) -> web.Response:
        path = "/" + request.match_info["tail"]
        body = await request.text()
        self.requests.append(
            (
                request.method,
                path,
                dict(request.query),
                request.headers.get("Authorization", ""),
            )
        )
        if path == "/me":
            return web.json_response({"id": "owner", "display_name": "Matyáš"})
        if path == "/me/player/devices":
            return web.json_response(
                {
                    "devices": [
                        {
                            "id": "dev1",
                            "is_active": True,
                            "name": "Obývák",
                            "type": "speaker",
                            "volume_percent": 30,
                            "supports_volume": True,
                        }
                    ]
                }
            )
        if path == "/me/player" and request.method == "GET":
            return web.json_response(
                {
                    "is_playing": True,
                    "progress_ms": 1000,
                    "device": {"id": "dev1", "name": "Obývák"},
                    "item": {
                        "uri": "spotify:track:t1",
                        "name": "Song",
                        "artists": [{"name": "Artist"}],
                        "album": {
                            "name": "Album",
                            "images": [{"url": "https://i.scdn.co/x"}],
                        },
                        "duration_ms": 200000,
                    },
                }
            )
        if path == "/search":
            return web.json_response(
                {
                    "tracks": {
                        "items": [
                            {"uri": "spotify:track:t2", "name": "Found", "artists": []}
                        ]
                    }
                }
            )
        if path.startswith("/me/player"):
            del body
            return web.Response(status=204)
        return web.json_response({}, status=404)


@pytest.fixture
async def fake():
    fake = FakeSpotify()
    server = TestServer(fake.app)
    await server.start_server()
    session = aiohttp.ClientSession()
    fake.base = str(server.make_url("")).rstrip("/")
    fake.session = session
    yield fake
    await session.close()
    await server.close()


def _service(fake, data=None, clock=None):
    data = data if data is not None else {}
    saves = []
    svc = spotify.SpotifyService(
        data,
        lambda: saves.append(json.dumps(data)),
        lambda: fake.session,
        accounts_base=fake.base,
        api_base=f"{fake.base}/v1",
        clock=clock or (lambda: 1000.0),
    )
    return svc, data, saves


async def _connected(fake, clock=None):
    svc, data, saves = _service(fake, clock=clock)
    svc.configure(CLIENT_ID, "https://dash.example.com/spotify-callback.html")
    url = svc.start()["authorize_url"]
    state = url.split("state=")[1].split("&")[0]
    await svc.finish("a" * 40, state)
    return svc, data, saves, state


async def test_connect_flow_stores_tokens_and_name(fake) -> None:
    svc, data, _saves, _state = await _connected(fake)
    exchange = next(r for r in fake.requests if r[1] == "/api/token")[2]
    assert exchange["grant_type"] == "authorization_code"
    assert exchange["client_id"] == CLIENT_ID
    assert "client_secret" not in exchange
    assert spotify.VERIFIER_CHARS.match(exchange["code_verifier"])
    assert data["refresh_token"] == FAKE_REFRESH
    status = svc.status()
    assert status["connected"] and status["display_name"] == "Matyáš"


async def test_authorize_url_uses_s256_and_minimum_scopes(fake) -> None:
    svc, _data, _ = _service(fake)
    svc.configure(CLIENT_ID, "https://dash.example.com/spotify-callback.html")
    url = svc.start()["authorize_url"]
    assert "code_challenge_method=S256" in url
    assert "response_type=code" in url
    assert "user-read-email" not in url


async def test_state_is_single_use(fake) -> None:
    svc, _data, _saves, state = await _connected(fake)
    with pytest.raises(spotify.SpotifyError) as err:
        await svc.finish("a" * 40, state)
    assert err.value.code == "bad_state"


async def test_state_expires_after_ten_minutes(fake) -> None:
    now = [1000.0]
    svc, _data, _ = _service(fake, clock=lambda: now[0])
    svc.configure(CLIENT_ID, "https://dash.example.com/spotify-callback.html")
    state = svc.start()["authorize_url"].split("state=")[1].split("&")[0]
    now[0] += 601
    with pytest.raises(spotify.SpotifyError) as err:
        await svc.finish("a" * 40, state)
    assert err.value.code == "state_expired"
    # spent: not usable again either
    with pytest.raises(spotify.SpotifyError):
        await svc.finish("a" * 40, state)


async def test_refresh_keeps_the_old_refresh_token_when_none_comes_back(fake) -> None:
    now = [1000.0]
    svc, data, _saves, _ = await _connected(fake, clock=lambda: now[0])
    fake.refresh_returns_new = False
    now[0] += 3600
    assert await svc.access_token() == FAKE_ACCESS_2
    assert data["refresh_token"] == FAKE_REFRESH
    refresh = [r for r in fake.requests if r[2].get("grant_type") == "refresh_token"]
    assert refresh and refresh[0][2]["client_id"] == CLIENT_ID
    fake.refresh_returns_new = True
    now[0] += 3600
    await svc.access_token()
    assert data["refresh_token"] == FAKE_REFRESH + "-new"


async def test_volume_is_capped_and_paths_match_the_docs(fake) -> None:
    svc, *_ = await _connected(fake)
    await svc.control("volume", value=90, max_volume=0.4)
    await svc.control("next")
    await svc.control("transfer", device_id="dev1", value=True)
    await svc.control("play", uri="spotify:album:abc")
    seen = [(m, p, q) for m, p, q, _a in fake.requests if p.startswith("/me/player")]
    assert ("PUT", "/me/player/volume", {"volume_percent": "40"}) in seen
    assert ("POST", "/me/player/next", {}) in seen
    assert ("PUT", "/me/player", {}) in seen
    with pytest.raises(spotify.SpotifyError):
        await svc.control("play", uri="https://evil.example.com/")
    with pytest.raises(spotify.SpotifyError):
        await svc.control("transfer", device_id="bad id!")


async def test_no_secret_in_any_output_and_disconnect_forgets(fake) -> None:
    svc, data, saves, _ = await _connected(fake)
    outputs = [
        svc.status(),
        await svc.devices(),
        await svc.player_state(),
        await svc.player_state(guest=True),
        await svc.search("song"),
        await svc.search("song", guest=True),
    ]
    blob = json.dumps(outputs)
    for secret in (FAKE_REFRESH, FAKE_ACCESS, FAKE_ACCESS_2):
        assert secret not in blob
    pending_states = list((data.get("pending") or {}).keys())
    for state in pending_states:
        assert state not in blob
    # the guest view never carries Spotify's image URLs
    assert "i.scdn.co" not in json.dumps(outputs[3]) + json.dumps(outputs[5])
    # the owner token call is the one place an access token leaves, never the refresh token
    token = await svc.owner_token()
    assert token["access_token"] in (FAKE_ACCESS, FAKE_ACCESS_2)
    assert FAKE_REFRESH not in json.dumps(token)
    svc.disconnect()
    assert "refresh_token" not in data and "access_token" not in data
    assert not svc.status()["connected"]
    assert saves  # every change was saved


async def test_search_limit_is_ten(fake) -> None:
    svc, *_ = await _connected(fake)
    await svc.search("x")
    query = next(q for _m, p, q, _a in fake.requests if p == "/search")
    assert query["limit"] == "10"


# ─── radio directory proxy ───────────────────────────────────────────────────


async def test_directory_proxy_filters_and_caches() -> None:
    calls = []

    async def search(request: web.Request) -> web.Response:
        calls.append((dict(request.query), request.headers.get("User-Agent")))
        return web.json_response(
            [
                {
                    "name": "Good",
                    "url_resolved": "https://s.example.com/a",
                    "codec": "MP3",
                    "bitrate": 128,
                    "favicon": "https://tracker.example.com/f.png",
                },
                {"name": "Plain", "url_resolved": "http://s.example.com/b"},
            ]
        )

    app = web.Application()
    app.router.add_get("/json/stations/search", search)
    server = TestServer(app)
    await server.start_server()
    session = aiohttp.ClientSession()
    try:
        host = f"{server.host}:{server.port}"

        async def discover():
            return [host]

        d = radio_directory.RadioDirectory(
            lambda: session, "dash-ha/test", discover=discover, scheme="http"
        )
        result = await d.search("Good radio")
        again = await d.search("good radio")
        assert (
            result
            == again
            == [
                {
                    "name": "Good",
                    "url": "https://s.example.com/a",
                    "codec": "MP3",
                    "bitrate": 128,
                }
            ]
        )
        assert len(calls) == 1
        query, agent = calls[0]
        assert agent == "dash-ha/test"
        assert query["is_https"] == "true" and query["hidebroken"] == "true"
        with pytest.raises(ValueError):
            await d.search("x")
    finally:
        await session.close()
        await server.close()


# ─── log redaction ───────────────────────────────────────────────────────────


def test_secret_redactor_hides_tokens_in_logs(caplog) -> None:
    vault = load("redact")
    data = {
        "spotify": {
            "refresh_token": FAKE_REFRESH,
            "pending": {"state-abcdef": {"verifier": "v" * 50}},
        }
    }
    assert vault.collect_secrets(data) == {FAKE_REFRESH, "state-abcdef", "v" * 50}
    logger = logging.getLogger("dash.test.redact")
    redactor = vault.SecretRedactor(lambda: data)
    logger.addFilter(redactor)
    with caplog.at_level(logging.INFO, logger="dash.test.redact"):
        logger.info("token %s state %s", FAKE_REFRESH, "state-abcdef")
    logger.removeFilter(redactor)
    assert FAKE_REFRESH not in caplog.text and "state-abcdef" not in caplog.text
    assert "***" in caplog.text
