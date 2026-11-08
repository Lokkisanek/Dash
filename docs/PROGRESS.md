# Progress: phase 2 (branch feat/phase2-wide-music-library)

Baseline before this branch (main at 2326a2e, v2.1.0-beta.3): build 690 KB `dist/`, panel.js 137 475 B, vitest 173, pytest (pure) 519, ruff clean, 6 Playwright specs green.

## Part A: fixes from the screenshots — done

| Item | What changed | Proof |
|---|---|---|
| A0 | One packing function `shared/layout.mjs` (`packTiles`, `indexForCell`), generated into `www/layout.js` (`npm run gen:layout`, in `check:generated`). App (`PageGrid.vue`) and editor set `grid-column`/`grid-row` explicitly; drop cell → array index with the same function; no `dense` anywhere. Preview gets the draft over `dash-preview` messages (origin-checked) | `tests/js/layout.test.js` (golden fixtures incl. the screenshot config), `scripts/layout-parity.mjs` (editor vs preview cells, drag, reload) |
| A0 | Unavailable tiles: one dimmed look + "Nedostupné" for every entity tile (missing entity or `unavailable`; media also `unknown`) | stage 2 / smoke specs |
| A1 | Vinyl rewritten: no tonearm, record = min(width, height) of a size container, spinning wrapper `<div>`, 2×2 without controls, 4×3 with controls; panel editor and style picker show a turning record | `scripts/player.mjs` (centre fixed, angle changes, pause/resume ≤ 15°, inside tile 2×2/4×3 light/dark, reduced motion) |
| A2 | Panel names entity-less tiles by type (`_tileName`) | `scripts/layout-parity.mjs` (no `^[a-z_]+-[0-9a-f]{8}$` label) |
| A3 | Compact header always leads with the time; only the rest truncates; `showTime` not offered for compact | `scripts/header-tiles.mjs` (390 px, 320 px with `showTime: false`) |
| A4 | Flat tonal placeholders (media art, editor cover deco, preview backdrop, phone bezel) | grep `gradient(` (kept: light tracks, login wallpaper, dock highlight, album-art scrim, colon dots) |
| A5 | Editor tiles use the app's corner radius (2rem, squircle); 1×1 no longer a circle | visual |
| A6 | Dock: blur + saturate always, solid translucent fallback, refraction only top-level; dark-mode ink | `scripts/dock-glass.mjs` (luminance ≥ 60 % over a white card, app and preview) |

## Part B: wide mode, tablets, preview, side dock — done

| Item | What changed | Proof |
|---|---|---|
| B1 | `useLayoutMode` (+ pure `lib/layoutMode.js`): phone/tablet/desktop × orientation, `pagesPerView = clamp(floor(w/420), 1, 4)`; wide modes put every page on one track that moves by one page (swipe, ← →); dock marks the visible pages; `general.layoutMode` auto/single (General tab); `--safe-left/right` used by content and dock; standby fits | `tests/js/layoutMode.test.js`, `scripts/wide-layout.mjs` (844×390, 820×1180, 1280×800, light/dark, same cells as the phone, keyboard paging, standby, no horizontal scroll) |
| B2 | `general.dockPosition` auto/bottom/right/left; vertical dock with the same glass, centred, `right: safe-right + 12px`; content keeps `--dock-space-*` free | `scripts/wide-layout.mjs` (side dock 8–24 px from the safe edge, no tile under it); HA test `test_layout_settings_are_validated` |
| B3 | `scripts/gen-device-presets.mjs` → `www/devices.js` (15 phones/tablets from Playwright's registry, 4 typical wall displays; safe areas marked approximate), in `check:generated`; dropdown with groups, rotate, Přizpůsobit / 100 %, remembered (try/catch); frames per class | `scripts/preview-devices.mjs` |
| B4 | Custom size 200–4000 px (validated, swap) and collapsed safe area T R B L | `scripts/preview-devices.mjs` |
| B5 | Real iframe at the CSS px size, scaled by a transform; insets and the draft over `dash-preview`, honoured only embedded and from the trusted origin | `scripts/preview-devices.mjs` (sizes, rotate, custom, 100 %, reload, wide parity with the editor, untrusted parent and top-level refused) |

Sheets (light, player) are full-screen layers above the dock (z-index 80 vs 30), so the side dock never covers them.

## Part C: standalone music player — done (Spotify parts UNVERIFIED without Premium)

| Item | What changed | Proof |
|---|---|---|
| C0 | `docs/PLAYER_ENGINES.md`: PKCE, refresh, redirect URI rules, SDK, Development Mode, Connect endpoints, scopes, CSP, http-HA redirect design; UNVERIFIED list | official pages read 2026-11-08 |
| C1 | `src/lib/player/` (PlayerState, HaEngine normalisation, engine registry); dash engines are virtual `media_player` entities, so every style and the sheet work unchanged; tile type `player` (`source` browser/spotify) | `tests/js/player.test.js` |
| C2 | BrowserEngine: one audio element, backoff 1-2-4-8-16 s then "Stream nedostupný", "Klepnutím povolíš zvuk", detected volume, Media Session, one engine at a time; `radio.stations` (≤ 50, https, ≤ 60 chars), HA media folder (owner: `media_source/*`; guest: issued ids, 5 min signed path), optional directory proxy | `tests/pure/test_music.py`, `tests/js/player.test.js`, `scripts/music.mjs` |
| C3 | Spotify (off): PKCE + single-use 10 min state in the vault, refresh keeps the old token when none comes back, Connect proxy (volume capped), guest kinds `spotify_state/control/search` (issued URIs), owner-only SDK token; callback page `public/spotify-callback.html`; log redactor | `tests/pure/test_music.py` (RFC 7636 vector, fake Spotify), `tests/ha/test_ha_music.py` |
| C4 | Panel "Hudba": HA players, station editor (validate, test, ↑↓/drag, remove), media-folder and directory switches, Spotify wizard; per-tile source switch | `scripts/music.mjs` |
| C5 | Player sheet: "Zdroje" tab for dash engines (stream address; Spotify devices, "Spustit přehrávání zde") | `scripts/music.mjs` |

Not done / decided: the Web Playback SDK runs only on owner devices (a guest would need a token); guests get Spotify only through the proxy.

## Part D: Videotéka — done (against fakes; real services UNVERIFIED)

| Item | What changed | Proof |
|---|---|---|
| D0 | `docs/LIBRARY.md`: Omniseerr behaviour, Radarr/Sonarr OpenAPI paths and fields, TMDB, qBittorrent; responsibility section; UNVERIFIED list | sources read 2026-11-08 |
| D1 | `library/` package (client, arr, tmdb, qbittorrent, posters, ghosts, requests, service, guest_rules, config); credentials only in the vault; base-URL validation, no redirects, timeouts (release search 60 s), sanitized errors; log redaction | `tests/pure/test_library.py`, `tests/ha/test_ha_library.py` |
| D2 | Status model (available / downloading % / monitored / requested / unrequested / unavailable), cached 45 s, invalidated on actions | status-model test |
| D3 | "Automaticky" and "Vybrat release" (ghost-add unmonitored, release list, grab → monitored); ghosts recorded; cleanup only of own ghosts, never with files or a queue entry, `deleteFiles=false`, 15 min + start-up + on close | ghost tests |
| D4 | Activity hub: polls only while subscribed (owner WS, guest kind), merge by upper-case infohash; owner-only pause/resume/delete/recheck; qBittorrent stop/start vs pause/resume by version with 404 fallback | activity + qBittorrent tests |
| D5 | Requests inbox (cap 200), HA event `guest_ha_dashboard_library_request` + persistent notification, approve / pick / decline with note, owner badge | inbox test, `scripts/library.mjs` |
| D6 | Guest kinds default-deny, daily cap, TV switch, issued (guid, indexerId) per pass and item, audit | guest-rules tests, HA test |
| D7 | Posters via opaque ids: TMDB image host from `/configuration` or the configured Arr host only, strict paths, size cap, image bytes check, LRU | poster/SSRF tests |
| D8 | `library` tile (trending/search/activity), Videotéka sheet (discover, search, detail, picker with sort/filter/rejections, activity, inbox), TMDB notice; panel Videotéka tab; mock catalogue | `scripts/library.mjs`, `tests/js/library.test.js` |
| D9 | `docs/LIBRARY.md` "Odpovědnost", `COMMERCIAL.md` addendum | – |

Root causes (A0): the editor packed every tile in one `grid-auto-flow: row dense` grid, the app in one dense grid per divider section, so tiles backfilled into different sections; and the preview showed the saved config, not the draft. Details in the final report.
