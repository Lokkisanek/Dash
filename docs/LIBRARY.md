# Videotéka (native video library)

Videotéka puts discovery, requests and the choice of a release in one place, inside dash. It drives the owner's own Radarr, Sonarr and qBittorrent through the integration. The behaviour comes from the owner's project Omniseerr (its `SPECIFICATION.md`); the code is new Python. Seerr/Overseerr are not used.

Everything is optional: Radarr only, Sonarr only, no qBittorrent (then the queue comes from the Arr), no TMDB key (then search uses the Arr lookup and "Objevit" needs the key).

## Odpovědnost

- Videotéka controls the owner's own Radarr, Sonarr and qBittorrent. It downloads only what those programs find through the indexers the owner configured in them.
- Whether a download is lawful depends on the content and on local law. That is the owner's responsibility.
- dash ships and names no indexers, trackers or sites.
- Guest access is off by default. Letting a guest pick a release (`library_pick_release`) is possible but not recommended.
- TMDB is opt-in with the owner's own API key. The free TMDB API is for non-commercial use with attribution, so dash shows "This product uses the TMDB API but is not endorsed or certified by TMDB." in the sheet footer. Commercial deployments need their own TMDB license. dash does not draw the TMDB logo. An owner who has the approved asset can put it at `custom_components/guest_ha_dashboard/www/tmdb-logo.svg` (a documented placeholder; nothing is shipped).

## Verified API surface (read 2026-11-08)

Sources: Omniseerr `SPECIFICATION.md` (raw GitHub), Radarr and Sonarr `openapi.json` (`src/*.Api.V3/openapi.json` on the `develop` branch), TMDB developer reference pages, qBittorrent WebUI API wiki (4.1 and 5.0 pages).

### Radarr v3 (header `X-Api-Key`)
| Use | Request | Fields relied on |
|---|---|---|
| test | `GET /api/v3/system/status` | 200 |
| library | `GET /api/v3/movie` (`tmdbId` filter) | `id, tmdbId, title, year, hasFile, monitored, images[]{coverType, url, remoteUrl}` |
| lookup by TMDB id | `GET /api/v3/movie/lookup/tmdb?tmdbId=` | MovieResource |
| search without TMDB | `GET /api/v3/movie/lookup?term=` | MovieResource[] |
| add (ghost / automatic) | `POST /api/v3/movie` | `qualityProfileId, rootFolderPath, monitored, addOptions{searchForMovie, monitor: movieOnly/movieAndCollection/none}` |
| monitor after grab | `PUT /api/v3/movie/{id}?moveFiles=false` | MovieResource |
| delete ghost | `DELETE /api/v3/movie/{id}?deleteFiles=false&addImportExclusion=false` | – |
| releases | `GET /api/v3/release?movieId=` | `guid, indexerId, indexer, title, size, seeders, leechers, quality.quality.name, languages[].name, customFormatScore, rejections[] (strings), rejected, infoHash, releaseGroup, protocol` |
| grab | `POST /api/v3/release` body `{guid, indexerId}` | – |
| queue | `GET /api/v3/queue?page=1&pageSize=200` | `records[]{id, movieId, downloadId, title, size, sizeleft, status, trackedDownloadState, estimatedCompletionTime}` |
| pickers | `GET /api/v3/qualityprofile` `{id, name}`, `GET /api/v3/rootfolder` `{id, path, accessible, freeSpace}` | |

### Sonarr v3 (header `X-Api-Key`)
| Use | Request |
|---|---|
| test | `GET /api/v3/system/status` |
| library | `GET /api/v3/series` (`tmdbId` field per series, `statistics`) |
| lookup | `GET /api/v3/series/lookup?term=` |
| add | `POST /api/v3/series` with `addOptions{monitor (all, none, …), searchForMissingEpisodes, searchForCutoffUnmetEpisodes}` |
| monitor | `PUT /api/v3/series/{id}?moveFiles=false` |
| delete ghost | `DELETE /api/v3/series/{id}?deleteFiles=false&addImportListExclusion=false` |
| releases | `GET /api/v3/release?seriesId=&seasonNumber=` or `?episodeId=` (fields as Radarr, plus `fullSeason, seasonNumber`) |
| grab | `POST /api/v3/release` `{guid, indexerId}` |
| queue | `GET /api/v3/queue` (`seriesId, episodeId, seasonNumber, downloadId, size, sizeleft`) |

### TMDB API v3 (`https://api.themoviedb.org`)
- Auth: "either a single query parameter, `api_key`, or … your access token as a `Bearer` token". dash uses Bearer for a read access token (it starts with `eyJ`), otherwise `api_key`.
- `GET /3/configuration` → `images.secure_base_url` (example `https://image.tmdb.org/t/p/`), `poster_sizes` (`w92 … w500, w780, original`).
- `GET /3/trending/{all|movie|tv}/{day|week}` (`language`) → `results[]{id, media_type, title|name, release_date|first_air_date, poster_path, overview}`.
- `GET /3/search/multi?query=&include_adult=false&language=&page=` (same fields).
- The detail view uses the fields already returned by trending/search (no extra TMDB call).

### qBittorrent WebUI API v2
- `POST /api/v2/auth/login` (`username`, `password`) → cookie `SID`; send `Referer`/`Origin` equal to the host.
- `GET /api/v2/app/webapiVersion` → e.g. `2.11.4`.
- `GET /api/v2/torrents/info` → `hash, name, progress, dlspeed, upspeed, eta, state, num_seeds`.
- State changes use POST (405 for the wrong method since v4.4.4).
- Pause/resume: `torrents/stop` / `torrents/start` on the 5.0 page, `torrents/pause` / `torrents/resume` on the 4.1 page. Also `torrents/delete` (`hashes`, `deleteFiles`) and `torrents/recheck` (`hashes`).

## How it works

- **Status** (computed by the integration, cached 45 s, cleared after every action): `available` (file present), `downloading` (+ percent, from the Arr queue or qBittorrent merged by upper-cased infohash = `downloadId`), `monitored`, `requested` (waiting for the owner), `unrequested`, `unavailable` (service off or down). A ghost movie counts as `unrequested`.
- **Interactive movie ("Vybrat release")**: look up the movie in Radarr. If it is missing, add it **unmonitored** with `searchForMovie: false` and record it as a ghost (id, TMDB id, time) in the integration's Store. Then list releases (60 s, cancellable). "Stáhnout" posts `{guid, indexerId}`, turns monitoring on and forgets the ghost.
- **Ghost cleanup**: only movies/series dash itself added as ghosts, after the picker closed without a grab, after 15 minutes and at start-up. Never one with a file or a queue entry (then the record is dropped and the item stays). Always `deleteFiles=false`.
- **Activity**: polled only while someone watches (owner subscription or guest `library_activity`), every 3 s by default, then stops. Pause/resume/delete/recheck are owner only.
- **Requests inbox**: a guest "Požádat" creates a pending request (max 200 kept; the oldest resolved ones are pruned), fires the HA event `guest_ha_dashboard_library_request` and a persistent notification. The owner can approve (automatic), pick a release, or decline with a note. A guest sees only their own requests.
- **Posters**: fetched by the integration, from the TMDB image host given by `/3/configuration` or from the configured Arr host's MediaCover path only. Path pattern `^/[A-Za-z0-9_./-]+\.(jpg|jpeg|png|webp)$` (no `..`), sizes w185/w342/w500, 2 MB cap, in-memory LRU. The browser gets an opaque id, never an upstream URL.
- **Secrets** (API keys, qBittorrent login) live only in the vault. Admin commands return `{configured, url}`, never a key.

## Guests (all off by default; profile capabilities)

| Capability | Kinds |
|---|---|
| `library_browse` | `library_discover`, `library_search`, `library_detail`, `library_poster` |
| `library_request` | `library_request` (daily cap `library_max_per_day`, default 3; TV only with `library_allow_tv`) |
| `library_pick_release` | `library_releases`, `library_grab`. A grab only accepts a `(guid, indexerId)` the server listed to this pass, for an item this pass opened in the last 10 minutes. |
| `library_activity` | `library_activity` (read-only) |

## UNVERIFIED

- In which WebAPI version qBittorrent renamed pause/resume to stop/start. dash reads `webapiVersion` (≥ 2.11.0 → stop/start) and falls back to the other name on 404.
- Whether `GET /api/v3/series/lookup` results always carry `tmdbId`. dash matches on it and refuses a series it cannot match.
- The Sonarr season/episode release search was not run against a real indexer setup. Neither was any part of this against real Radarr/Sonarr/qBittorrent: the tests use fake servers built from the OpenAPI files.
- TMDB's API terms page could not be read (robots.txt). The attribution text follows the TMDB FAQ.
