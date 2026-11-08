"""Videotéka backend against fake Radarr / Sonarr / qBittorrent (aiohttp servers).

The fakes implement only the requests listed in docs/LIBRARY.md, with the
field names from the Radarr/Sonarr OpenAPI files and the qBittorrent wiki.
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

service_mod = load("library.service")
client_mod = load("library.client")
posters_mod = load("library.posters")
qbit_mod = load("library.qbittorrent")
rules = load("library.guest_rules")
redact = load("redact")
policy = load("guest_policy")

RADARR_KEY = "fake-radarr-key-11112222"
SONARR_KEY = "fake-sonarr-key-33334444"
QB_PASSWORD = "fake-qb-password-5555"
TMDB_KEY = "fake-tmdb-key-66667777"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200


def _a(fn):
    """A sync lambda as an aiohttp handler (aiohttp wants coroutines)."""

    async def handler(request):
        return fn(request)

    return handler


class FakeRadarr:
    def __init__(self) -> None:
        self.movies: dict[int, dict] = {}
        self.queue: list[dict] = []
        self.calls: list[tuple] = []
        self.next_id = 100
        app = web.Application()
        r = app.router
        r.add_get(
            "/api/v3/system/status",
            _a(lambda q: web.json_response({"version": "5.9.0"})),
        )
        r.add_get("/api/v3/movie", self.list)
        r.add_post("/api/v3/movie", self.add)
        r.add_get("/api/v3/movie/lookup/tmdb", self.lookup_tmdb)
        r.add_get("/api/v3/movie/lookup", self.lookup)
        r.add_get("/api/v3/movie/{id}", self.get)
        r.add_put("/api/v3/movie/{id}", self.put)
        r.add_delete("/api/v3/movie/{id}", self.delete)
        r.add_get("/api/v3/release", self.releases)
        r.add_post("/api/v3/release", self.grab)
        r.add_get(
            "/api/v3/queue", _a(lambda q: web.json_response({"records": self.queue}))
        )
        r.add_get(
            "/api/v3/qualityprofile",
            _a(lambda q: web.json_response([{"id": 4, "name": "HD-1080p"}])),
        )
        r.add_get(
            "/api/v3/rootfolder",
            _a(
                lambda q: web.json_response(
                    [{"id": 1, "path": "/movies", "accessible": True}]
                )
            ),
        )
        r.add_get(
            "/MediaCover/{id}/poster.jpg",
            _a(lambda q: web.Response(body=JPEG, content_type="image/jpeg")),
        )
        r.add_get(
            "/MediaCover/{id}/fake.jpg",
            _a(lambda q: web.Response(body=b"<html>", content_type="image/jpeg")),
        )
        fake = self

        @web.middleware
        async def auth(request, handler):
            return await fake.auth(request, handler)

        app.middlewares.append(auth)
        self.web = app

    async def auth(self, request, handler):
        if request.headers.get("X-Api-Key") != RADARR_KEY:
            return web.Response(status=401)
        self.calls.append((request.method, request.path, dict(request.query)))
        return await handler(request)

    def movie(self, tmdb_id, *, has_file=False, monitored=True, ghost_id=None):
        mid = ghost_id or self.next_id
        self.next_id += 1
        self.movies[mid] = {
            "id": mid,
            "tmdbId": tmdb_id,
            "title": f"Film {tmdb_id}",
            "hasFile": has_file,
            "monitored": monitored,
            "images": [
                {
                    "coverType": "poster",
                    "url": f"/MediaCover/{mid}/poster.jpg?lastWrite=1",
                    "remoteUrl": "https://elsewhere.example.com/x.jpg",
                }
            ],
        }
        return mid

    async def list(self, request):
        tmdb = request.query.get("tmdbId")
        items = [
            m for m in self.movies.values() if tmdb is None or str(m["tmdbId"]) == tmdb
        ]
        return web.json_response(items)

    async def get(self, request):
        m = self.movies.get(int(request.match_info["id"]))
        return web.json_response(m) if m else web.Response(status=404)

    async def lookup_tmdb(self, request):
        t = int(request.query["tmdbId"])
        return web.json_response(
            {"tmdbId": t, "title": f"Film {t}", "year": 2024, "images": []}
        )

    async def lookup(self, request):
        return web.json_response(
            [
                {
                    "tmdbId": 77,
                    "title": request.query["term"],
                    "year": 2020,
                    "overview": "x",
                    "images": [],
                }
            ]
        )

    async def add(self, request):
        body = await request.json()
        self.last_add = body
        mid = self.movie(body["tmdbId"], monitored=body["monitored"])
        return web.json_response(self.movies[mid], status=201)

    async def put(self, request):
        body = await request.json()
        self.movies[int(request.match_info["id"])].update(monitored=body["monitored"])
        return web.json_response(body, status=202)

    async def delete(self, request):
        self.movies.pop(int(request.match_info["id"]), None)
        return web.Response(status=200)

    async def releases(self, request):
        return web.json_response(
            [
                {
                    "guid": "guid-1",
                    "indexerId": 3,
                    "title": "Film.2024.1080p.WEB-DL",
                    "indexer": "Example",
                    "size": 4_000_000_000,
                    "seeders": 50,
                    "leechers": 4,
                    "quality": {"quality": {"name": "WEBDL-1080p"}},
                    "languages": [{"id": 1, "name": "English"}],
                    "customFormatScore": 150,
                    "rejections": ["Not wanted"],
                    "rejected": False,
                    "downloadUrl": "https://tracker.example.com/secret?passkey=xyz",
                    "magnetUrl": "magnet:?xt=urn:btih:abc",
                    "infoHash": "abc",
                }
            ]
        )

    async def grab(self, request):
        self.last_grab = await request.json()
        return web.json_response({})


class FakeQbit:
    def __init__(self, version: str) -> None:
        self.version = version
        self.calls: list[tuple] = []
        app = web.Application()
        app.router.add_post("/api/v2/auth/login", self.login)
        app.router.add_get(
            "/api/v2/app/webapiVersion",
            self.guard(_a(lambda q: web.Response(text=self.version))),
        )
        app.router.add_get(
            "/api/v2/torrents/info",
            self.guard(
                _a(
                    lambda q: web.json_response(
                        [
                            {
                                "hash": "abcdef0123",
                                "name": "Film",
                                "progress": 0.42,
                                "dlspeed": 1000,
                                "upspeed": 0,
                                "eta": 60,
                                "state": "downloading",
                                "num_seeds": 9,
                            }
                        ]
                    )
                )
            ),
        )
        new = tuple(int(x) for x in version.split(".")) >= (2, 11, 0)
        names = ("stop", "start") if new else ("pause", "resume")
        for name in (*names, "delete", "recheck"):
            app.router.add_post(
                f"/api/v2/torrents/{name}", self.guard(self.record(name))
            )
        self.web = app

    async def login(self, request):
        form = await request.post()
        if form.get("password") != QB_PASSWORD:
            return web.Response(text="Fails.")
        resp = web.Response(text="Ok.")
        resp.set_cookie("SID", "sid-xyz")
        return resp

    def guard(self, handler):
        async def inner(request):
            if request.cookies.get("SID") != "sid-xyz":
                return web.Response(status=403)
            return await handler(request)

        return inner

    def record(self, name):
        async def inner(request):
            self.calls.append((name, dict(await request.post())))
            return web.Response(text="")

        return inner


def fake_tmdb():
    """/3/configuration, /3/trending, /3/search/multi with api_key auth."""
    seen = []

    async def guard(request):
        seen.append(dict(request.query))
        if request.query.get("api_key") != TMDB_KEY:
            return web.Response(status=401)
        if request.path == "/3/configuration":
            return web.json_response(
                {
                    "images": {
                        "secure_base_url": "https://image.tmdb.org/t/p/",
                        "poster_sizes": ["w342"],
                    }
                }
            )
        return web.json_response(
            {
                "results": [
                    {
                        "id": 501,
                        "media_type": "movie",
                        "title": "Film",
                        "release_date": "2024-01-02",
                        "poster_path": "/p.jpg",
                        "overview": "o",
                    },
                    {
                        "id": 502,
                        "media_type": "tv",
                        "name": "Show",
                        "first_air_date": "2023-01-02",
                        "poster_path": "/../x.jpg",
                    },
                    {"id": 503, "media_type": "person", "name": "Someone"},
                ]
            }
        )

    app = web.Application()
    app.router.add_get("/{tail:.*}", guard)
    return app, seen


async def _server(app):
    server = TestServer(app)
    await server.start_server()
    return server


@pytest.fixture
async def env():
    radarr = FakeRadarr()
    qbit = FakeQbit("2.11.4")
    rs = await _server(radarr.web)
    qs = await _server(qbit.web)
    tmdb_app, tmdb_seen = fake_tmdb()
    ts = await _server(tmdb_app)
    session = aiohttp.ClientSession()
    now = [10_000.0]
    data: dict = {}
    saves = []
    svc = service_mod.LibraryService(
        data,
        lambda: saves.append(1),
        lambda: session,
        clock=lambda: now[0],
        tmdb_base=str(ts.make_url("")).rstrip("/"),
    )
    svc.set_service(
        "radarr", {"url": str(rs.make_url("")).rstrip("/"), "api_key": RADARR_KEY}
    )
    svc.set_service(
        "qbittorrent",
        {
            "url": str(qs.make_url("")).rstrip("/"),
            "username": "admin",
            "password": QB_PASSWORD,
        },
    )
    yield {
        "svc": svc,
        "radarr": radarr,
        "qbit": qbit,
        "now": now,
        "data": data,
        "tmdb_seen": tmdb_seen,
    }
    await session.close()
    await rs.close()
    await qs.close()
    await ts.close()


# ─── ghost-add → releases → grab ────────────────────────────────────────────


async def test_pick_release_ghost_adds_then_grab_monitors(env) -> None:
    svc, radarr = env["svc"], env["radarr"]
    res = await svc.releases("movie", 42, 4, "/movies")
    assert radarr.last_add["monitored"] is False
    assert radarr.last_add["addOptions"]["searchForMovie"] is False
    assert svc.ghosts.find_tmdb("movie", 42)
    rel = res["releases"][0]
    assert rel["guid"] == "guid-1" and rel["indexerId"] == 3
    assert rel["quality"] == "WEBDL-1080p" and rel["customFormatScore"] == 150
    # upstream links (passkeys, magnets) never leave the integration
    assert "passkey" not in json.dumps(res) and "magnet" not in json.dumps(res)
    status = await svc.grab("movie", 42, "guid-1", 3)
    assert radarr.last_grab == {"guid": "guid-1", "indexerId": 3}
    assert radarr.movies[res["itemId"]]["monitored"] is True
    assert not svc.ghosts.find_tmdb("movie", 42)
    assert status["status"] == "monitored"


async def test_existing_movie_is_not_a_ghost(env) -> None:
    svc, radarr = env["svc"], env["radarr"]
    mid = radarr.movie(7, monitored=False)
    await svc.releases("movie", 7, 4, "/movies")
    assert not svc.ghosts.all()
    await svc.close_picker("movie", 7)
    assert mid in radarr.movies  # never deleted


async def test_ghost_cleanup_rules(env) -> None:
    svc, radarr, now = env["svc"], env["radarr"], env["now"]
    pre_existing = radarr.movie(1, monitored=False)  # the owner's own, unmonitored
    await svc.releases("movie", 2, 4, "/movies")  # ghost, will be removed
    await svc.releases("movie", 3, 4, "/movies")  # ghost with a queue entry
    await svc.releases("movie", 4, 4, "/movies")  # ghost that got a file
    ids = {g["tmdbId"]: g["id"] for g in svc.ghosts.all()}
    radarr.queue.append(
        {
            "id": 9,
            "movieId": ids[3],
            "downloadId": "ABCDEF0123",
            "size": 100,
            "sizeleft": 50,
        }
    )
    radarr.movies[ids[4]]["hasFile"] = True
    # not yet 15 minutes: nothing happens
    assert await svc.cleanup() == 0
    now[0] += 15 * 60
    assert await svc.cleanup() == 1
    assert ids[2] not in radarr.movies
    assert ids[3] in radarr.movies and ids[4] in radarr.movies
    assert pre_existing in radarr.movies
    assert not svc.ghosts.all()  # the kept ones are no longer ghosts
    deletes = [c for c in radarr.calls if c[0] == "DELETE"]
    assert deletes and all(c[2]["deleteFiles"] == "false" for c in deletes)


async def test_startup_cleanup_and_close_picker(env) -> None:
    svc, radarr = env["svc"], env["radarr"]
    await svc.releases("movie", 5, 4, "/movies")
    await svc.releases("movie", 6, 4, "/movies")
    ghost6 = svc.ghosts.find_tmdb("movie", 6)["id"]
    await svc.close_picker("movie", 6)
    assert ghost6 not in radarr.movies
    assert await svc.cleanup(everything=True) == 1
    assert not svc.ghosts.all()


async def test_missing_defaults_refuse_a_ghost(env) -> None:
    with pytest.raises(client_mod.ServiceError) as err:
        await env["svc"].releases("movie", 8, None, "")
    assert err.value.code == "missing_defaults"


# ─── status model and activity ───────────────────────────────────────────────


async def test_status_model(env) -> None:
    svc, radarr = env["svc"], env["radarr"]
    radarr.movie(10, has_file=True)
    radarr.movie(11, monitored=True)
    mid = radarr.movie(12, monitored=True)
    radarr.queue.append(
        {
            "id": 1,
            "movieId": mid,
            "downloadId": "abcdef0123",
            "size": 100,
            "sizeleft": 90,
        }
    )
    svc.inbox.create(
        tmdb_id=13,
        media_type="movie",
        title="T",
        year=2024,
        poster="",
        requester="Host",
        pass_id="p",
        created="2026-11-08T10:00:00",
    )
    items = [
        {"tmdbId": t, "mediaType": "movie", "title": str(t)}
        for t in (10, 11, 12, 13, 14)
    ]
    items.append({"tmdbId": 1, "mediaType": "tv", "title": "tv"})
    out = {(i["mediaType"], i["tmdbId"]): i for i in await svc.annotate(items)}
    assert out[("movie", 10)]["status"] == "available"
    assert out[("movie", 11)]["status"] == "monitored"
    # infohash merge: queue downloadId (lower case) == qBittorrent hash (upper)
    assert out[("movie", 12)] | {} and out[("movie", 12)]["status"] == "downloading"
    assert out[("movie", 12)]["percent"] == 42
    assert out[("movie", 13)]["status"] == "requested"
    assert out[("movie", 14)]["status"] == "unrequested"
    assert out[("tv", 1)]["status"] == "unavailable"  # no Sonarr


async def test_activity_merges_and_hides_details_from_guests(env) -> None:
    svc, radarr = env["svc"], env["radarr"]
    mid = radarr.movie(20)
    radarr.queue.append(
        {
            "id": 2,
            "movieId": mid,
            "downloadId": "ABCDEF0123",
            "title": "Film.2024.1080p-GRP",
            "size": 100,
            "sizeleft": 10,
        }
    )
    owner = await svc.activity()
    assert (
        owner[0]["hash"] == "ABCDEF0123"
        and owner[0]["speed"] == 1000
        and owner[0]["progress"] == 42
    )
    guest = await svc.activity(guest=True)
    assert guest[0]["hash"] == "" and guest[0]["release"] == ""


@pytest.mark.parametrize(
    ("version", "expected"), [("2.11.4", "stop"), ("2.8.19", "pause")]
)
async def test_qbittorrent_pause_name_follows_the_version(version, expected) -> None:
    fake = FakeQbit(version)
    server = await _server(fake.web)
    session = aiohttp.ClientSession()
    try:
        q = qbit_mod.QBittorrent(
            lambda: session, str(server.make_url("")).rstrip("/"), "admin", QB_PASSWORD
        )
        await q.control("pause", "ABCDEF0123")
        await q.control("resume", "ABCDEF0123")
        await q.control("delete", "ABCDEF0123")
        names = [c[0] for c in fake.calls]
        assert names[0] == expected
        assert fake.calls[2] == (
            "delete",
            {"hashes": "abcdef0123", "deleteFiles": "false"},
        )
        # a wrong guess falls back to the other name on 404
        q2 = qbit_mod.QBittorrent(
            lambda: session, str(server.make_url("")).rstrip("/"), "admin", QB_PASSWORD
        )
        q2._version = (2, 11, 0) if expected == "pause" else (2, 0, 0)
        await q2.control("pause", "ABCDEF0123")
        assert fake.calls[-1][0] == expected
    finally:
        await session.close()
        await server.close()


async def test_owner_torrent_controls_validate(env) -> None:
    svc, qbit = env["svc"], env["qbit"]
    await svc.torrent("recheck", "ABCDEF0123")
    assert qbit.calls[-1][0] == "recheck"
    for action, h in (("format", "ABC"), ("pause", "../x"), ("pause", "a" * 65)):
        with pytest.raises(client_mod.ServiceError):
            await svc.torrent(action, h)


# ─── secrets ─────────────────────────────────────────────────────────────────


async def test_secrets_never_leave_and_are_redacted(env, caplog) -> None:
    svc, data = env["svc"], env["data"]
    svc.set_service("tmdb", {"api_key": TMDB_KEY})
    outputs = [
        svc.services_status(),
        await svc.search("Film"),
        await svc.activity(),
        await svc.releases("movie", 30, 4, "/movies"),
        await svc.options("radarr"),
        await svc.test("radarr"),
    ]
    blob = json.dumps(outputs)
    for secret in (RADARR_KEY, QB_PASSWORD, TMDB_KEY, "sid-xyz"):
        assert secret not in blob
    assert {RADARR_KEY, QB_PASSWORD, TMDB_KEY} <= redact.collect_secrets(
        {"library": data}
    )
    # "Změnit" without a new key keeps the old key; a new URL is validated
    svc.set_service("radarr", {"url": "http://192.168.1.5:7878"})
    assert data["services"]["radarr"]["api_key"] == RADARR_KEY
    with pytest.raises(client_mod.ServiceError):
        svc.set_service(
            "radarr", {"url": "http://user:pw@host:7878", "api_key": "x" * 20}
        )
    logger = logging.getLogger("dash.test.library")
    f = redact.SecretRedactor(lambda: {"library": data})
    logger.addFilter(f)
    with caplog.at_level(logging.INFO, logger="dash.test.library"):
        logger.info("radarr said %s", RADARR_KEY)
    logger.removeFilter(f)
    assert RADARR_KEY not in caplog.text


async def test_tmdb_discover_and_search(env) -> None:
    svc = env["svc"]
    svc.set_service("tmdb", {"api_key": TMDB_KEY})
    items = await svc.discover()
    assert [(i["mediaType"], i["tmdbId"], i["year"]) for i in items] == [
        ("movie", 501, 2024),
        ("tv", 502, 2023),
    ]
    assert items[0]["poster"] and items[1]["poster"] == ""  # "/../x.jpg" is refused
    assert svc.posters.tmdb_base == "https://image.tmdb.org/t/p/"
    detail = await svc.detail("movie", 501)
    assert detail["title"] == "Film" and detail["status"] == "unrequested"
    with pytest.raises(client_mod.ServiceError):
        await svc.detail("movie", 999)  # never shown to anyone: no detail
    assert all(q.get("api_key") == TMDB_KEY for q in env["tmdb_seen"])


async def test_search_without_tmdb_uses_the_arr_lookup(env) -> None:
    items = await env["svc"].search("Matrix")
    assert items[0]["tmdbId"] == 77 and items[0]["title"] == "Matrix"


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("http://192.168.1.10:7878", True),
        ("https://radarr.example.com/radarr", True),
        ("http://user:pw@host:7878", False),
        ("ftp://host", False),
        ("http://host/?a=1", False),
        ("http://host/../x", False),
        ("javascript:alert(1)", False),
    ],
)
def test_base_url_rules(url, ok) -> None:
    assert (client_mod.validate_base_url(url) is not None) is ok


# ─── posters: SSRF ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "/../etc/passwd.jpg",
        "//evil.example.com/a.jpg",
        "/a.svg",
        "/a.jpg/../../b.png",
        "/a b.jpg",
        "http://x/a.jpg",
        None,
    ],
)
def test_poster_paths_are_strict(path) -> None:
    assert posters_mod.safe_path(path) is None


async def test_posters_come_only_from_allowed_hosts(env) -> None:
    svc, radarr = env["svc"], env["radarr"]
    p = svc.posters
    # a remote URL on a foreign host is never used; the configured Arr MediaCover is
    mid = radarr.movie(40)
    cover = {
        "remote": "https://elsewhere.example.com/x.jpg",
        "local": f"/MediaCover/{mid}/poster.jpg?lastWrite=1",
    }
    token = p.from_cover("radarr", cover)
    body, mime = await p.fetch(token)
    assert mime == "image/jpeg" and body == JPEG
    # an unconfigured service, a bad size, an unknown token: refused
    assert p.from_cover("sonarr", cover) == ""
    assert p.from_tmdb("/a.jpg", size="original") == ""
    with pytest.raises(client_mod.ServiceError):
        await p.fetch("deadbeef")
    # bytes that are not an image are refused
    bad = p.from_cover("radarr", {"local": f"/MediaCover/{mid}/fake.jpg"})
    with pytest.raises(client_mod.ServiceError) as err:
        await p.fetch(bad)
    assert err.value.code == "not_an_image"


def test_tmdb_posters_need_the_configured_image_host() -> None:
    p = posters_mod.Posters(lambda: None)
    p.tmdb_base = "https://image.tmdb.org/t/p/"
    token = p.from_cover(
        "radarr", {"remote": "https://image.tmdb.org/t/p/original/abc.jpg"}
    )
    assert token and p._sources[token] == {
        "kind": "tmdb",
        "path": "/abc.jpg",
        "size": "w342",
    }
    assert (
        p.from_cover(
            "radarr", {"remote": "https://image.tmdb.org.evil.com/t/p/original/abc.jpg"}
        )
        == ""
    )


# ─── requests inbox ──────────────────────────────────────────────────────────


def test_inbox_lifecycle_and_privacy() -> None:
    inbox = load("library.requests").Inbox([], lambda: None)
    a = inbox.create(
        tmdb_id=1,
        media_type="movie",
        title="A",
        year=2024,
        poster="",
        requester="Pokoj 1",
        pass_id="p1",
        created="2026-11-08T10:00",
    )
    again = inbox.create(
        tmdb_id=1,
        media_type="movie",
        title="A",
        year=2024,
        poster="",
        requester="Pokoj 2",
        pass_id="p2",
        created="2026-11-08T10:01",
    )
    assert again is a  # one open request per title
    b = inbox.create(
        tmdb_id=2,
        media_type="tv",
        title="B",
        year=None,
        poster="",
        requester="Pokoj 2",
        pass_id="p2",
        created="2026-11-08T10:02",
    )
    assert [r["id"] for r in inbox.list("p2")] == [b["id"]]
    assert inbox.pending_count() == 2
    inbox.set_status(a["id"], "declined", "Už máme")
    assert inbox.get(a["id"])["note"] == "Už máme"
    assert inbox.set_status(a["id"], "evil") is None
    public = inbox.public(b, guest=True)
    assert "passId" not in public and "requester" not in public
    for i in range(250):
        inbox.create(
            tmdb_id=100 + i,
            media_type="movie",
            title="x",
            year=None,
            poster="",
            requester="",
            pass_id="p",
            created=f"2026-11-08T11:{i:03d}",
        )
    assert len(inbox.list()) == 200
    assert inbox.get(a["id"]) is None  # resolved ones go first


# ─── guest rules ─────────────────────────────────────────────────────────────


def _dec(kind, data=None, caps=None, issues=None, now=100.0, today=0):
    return rules.decide(
        kind,
        data or {},
        caps or {},
        issues or rules.PassIssues(),
        now,
        requests_today=today,
    )


@pytest.mark.parametrize("kind", rules.LIBRARY_KINDS)
def test_every_library_kind_is_off_by_default(kind) -> None:
    caps = policy.normalize_capabilities({})
    d = _dec(kind, {"media_type": "movie", "tmdb_id": 1, "query": "x"}, caps)
    assert (d.allowed, d.code) == (False, "capability_disabled")


def test_request_cap_and_tv_switch() -> None:
    caps = {
        "library_request": True,
        "library_max_per_day": 3,
        "library_allow_tv": False,
    }
    assert _dec(
        "library_request", {"media_type": "movie", "tmdb_id": 1}, caps, today=2
    ).allowed
    assert (
        _dec(
            "library_request", {"media_type": "movie", "tmdb_id": 1}, caps, today=3
        ).code
        == "daily_limit"
    )
    assert (
        _dec("library_request", {"media_type": "tv", "tmdb_id": 1}, caps).code
        == "tv_disabled"
    )
    assert rules.day_count({"day": "2026-11-08", "count": 2}, "2026-11-08") == 2
    assert rules.day_count({"day": "2026-11-07", "count": 2}, "2026-11-08") == 0


def test_grab_only_with_an_issued_pair_for_an_opened_item() -> None:
    caps = {"library_pick_release": True}
    issues = rules.PassIssues()
    item = {"media_type": "movie", "tmdb_id": 5}
    assert _dec("library_releases", item, caps, issues).code == "not_issued"
    issues.open_item("movie", 5, 100.0)
    assert _dec("library_releases", item, caps, issues).allowed
    grab = {**item, "guid": "g1", "indexer_id": 3}
    assert _dec("library_grab", grab, caps, issues).code == "not_issued"  # never listed
    issues.list_releases("movie", 5, [("g1", 3)], 100.0)
    assert _dec("library_grab", grab, caps, issues).allowed
    # another indexer, another item, or after 10 minutes: refused
    assert not _dec("library_grab", {**grab, "indexer_id": 4}, caps, issues).allowed
    assert not _dec("library_grab", {**grab, "tmdb_id": 6}, caps, issues).allowed
    assert not _dec("library_grab", grab, caps, issues, now=100.0 + 601).allowed
    # another pass has its own issues
    assert not _dec("library_grab", grab, caps, rules.PassIssues()).allowed
