# Changelog

All notable changes to dash are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- The app now shows exactly the layout the editor shows. Both pack tiles with one function (`shared/layout.mjs`, in array order, no dense backfill). Before, the editor packed one dense grid and the app one per divider section, so tiles moved between sections.
- The live preview follows the editor draft at once, before **Uložit**.
- Unavailable tiles: one quiet dimmed look with "Nedostupné" for every tile type.
- Record-player style rewritten:
  - no tonearm;
  - the record is sized to the tile and never overflows;
  - 2×2 without controls, 4×3 with controls;
  - it turns at 33⅓ rpm while playing and keeps its angle when paused.
  - The panel shows it turning.
- The panel names tiles without an entity by type, never by an internal id.
- The compact header always starts with the time; a narrow tile cuts the weather, never the time.
- Flat tonal placeholders instead of gradients (media artwork, editor decorations, preview backdrop).
- Editor tiles use the app's corner radius.
- The dock stays legible over content: blur and a solid translucent fill always; refraction only as an addition and never in the preview iframe; dark-mode ink.

### Added

- Wide and tablet layouts:
  - several pages side by side (`general.layoutMode`), paging by one page with swipe or ← →;
  - a side dock on a phone in landscape (`general.dockPosition`);
  - left/right safe areas.
- Panel live preview:
  - phone, tablet and wall-display presets (generated from Playwright's device list);
  - rotate, fit or 100 %;
  - a custom size with a safe area;
  - remembered per browser.
- Player engines (`docs/PLAYER_ENGINES.md`):
  - a `player` tile with radio in the browser: the owner's https stations, the HA media folder, a direct address, autoplay unlock, retries, Media Session;
  - an optional radio directory proxy;
  - an optional **Spotify** engine: PKCE sign-in kept in the integration, Connect control, search, playlists, owner-only Web Playback SDK, a setup wizard;
  - the panel **Hudba** tab.
- **Videotéka** (`docs/LIBRARY.md`):
  - discover and search (TMDB or the Arr lookup);
  - automatic request or "Vybrat release" with a ghost-add and a release picker, safe ghost cleanup;
  - downloads merged from Radarr/Sonarr and qBittorrent;
  - a requests inbox with an HA event and a notification;
  - posters through the integration;
  - the panel **Videotéka** tab.
- Guest capabilities, all off by default: `allow_local_player`, `spotify_control`, `spotify_search`, `library_browse`, `library_request`, `library_pick_release`, `library_activity`, `library_max_per_day`, `library_allow_tv`.
- A secrets vault (`guest_ha_dashboard.vault`) with log redaction.
- Docs: `SPOTIFY.md`, `LIBRARY.md`, `PLAYER_ENGINES.md`; `SPEAKERS.md` rewritten ("bez doplňků"); `COMMERCIAL.md` third-party addendum.

### Changed

- Tile packing (see Fixed): a gap in a row stays empty until you move a tile into it.
- CSP: `https://sdk.scdn.co` allowed in `script-src` and `frame-src` (only used once the owner turns on the Spotify browser player).

## [2.1.0-beta.3] - 07.11.2026

### Added

- Header tiles: `header`, `clock`, `greeting`, `weather` and `wifi`, placed anywhere on a page.
  - Styles: card, no background (text colour auto/white/dark), lock screen, one line, glass (the dock's material).
  - One shared clock and one shared weather source.
- Config version 3: the old header switches in `general` become one header tile at the top of page 1, done by the integration and by the app for older integrations. The General tab keeps the 24-hour clock and the iPhone status bar setting.
- Scene tile with a check confirmation; sensor, binary sensor (wording for all 29 device classes) and generic entity tiles (read only); fan tile with speed, oscillation and presets.
- Long-press light controls:
  - brightness, white temperature with presets, colour (swatches and hue) and effects, only what the light supports;
  - cancelled by movement, scrolling and page swipes; right-click, Shift+Enter or a keyboard button open it too.
- dash light groups (`light_group`, 2–20 lights): one tile, one service call with a list of lights, values shown as mixed when the lights disagree, controls limited to what all lights support.
- Music:
  - capability table of every MediaPlayerEntityFeature bit;
  - "Now playing" and record-player styles;
  - a player sheet with players (volume, power, grouping), browse and search (with play next / add to queue where supported).
- Guest passes:
  - `light` calls may target a list of lights (light groups, every light checked);
  - new fields and services for lights, fans and media players, each checked against the device's own support;
  - profile capabilities (colour, colour temperature, effects, transition, music browse, speaker grouping, maximum volume) with safe defaults;
  - `browse_media` / `search_media` on the guest socket with filtered results; `play_media` only for ids the pass was given.
- Panel: "+ Přidat" menu grouped by kind, inline options for every tile, a checklist for light groups and media outputs, capability switches in the Guests tab.
- Opt-in `general.statusBarStrip` (dark strip behind the iPhone status bar).
- `docs/SPEAKERS.md` (Music Assistant, MPD, Snapcast, Bluetooth) and `docs/PROGRESS.md`.
- Browser tests for the screen edges, header tiles, stage 2 tiles and the player; HA tests for config v3, light groups, colour checks and media browse rules.

### Changed

- The wallpaper runs under the iPhone status bar and to the bottom edge. The dark status bar strip is no longer on by default. The dock sits a fixed 12 px above the home indicator.
- Media tiles show a control only when the player reports it; a player without `supported_features` gets none. They also handle the unavailable, off, idle and buffering states.
- Guests: colour and effects are off by default for every profile (colour temperature stays allowed); the volume is capped at 70 % unless the owner changes it.
- The status badge (Demo, offline) is an overlay under the status bar, not part of the header.

### Fixed

- A black strip behind the iPhone status bar, a grey band under the dock, and the dock sitting too high in the installed app.
- `tests/js/tiles.test.js` failed on Windows checkouts (CRLF after the shebang of `scripts/gen-tiles.mjs`).
- The slider tile toggled the light on `pointercancel`.

## [2.1.0-beta.2] - 07.11.2026

### Added

- Pages reorder by drag in the panel (mouse at once, touch after a short hold, Alt + ←/→ from the keyboard, announced to screen readers). The order is the swipe order in the app.
- Section divider tile (`divider`): a section name with a line, edited inline in the grid. In the app each divider starts its own section. Guests see dividers only on pages that still show something they may use.
- One header (`HeaderCard`) with the clock row (time, date, Wi-Fi icon, status badge only when the connection is not healthy), the greeting and the outside weather. All existing `general` options keep their meaning.
- Icon picker with about 340 lucide icons: search (case and diacritics insensitive, Czech and English keywords), ten categories, recently used first, keyboard navigation. The panel loads the catalog only when the picker opens, and the app loads icons beyond the base set as a separate chunk.
- One tile registry, `shared/tiles.json`, generated for the app, the panel and the integration (`npm run gen:tiles`). `npm run check:generated` runs in CI.
- Config versioning: `configVersion` 2 with automatic migration from 1. Unknown tile types are dropped with a log warning, and unknown styles or sizes fall back to defaults.
- Unit tests (vitest, `npm test`), a StandBy photo browser test, and HA tests for photos and config migration.
- `docs/DIAGNOSTICS.md`: the photo frame and music player code paths, the fixes, and a manual checklist.

### Changed

- StandBy photo frame:
  - Photos are kept in a page-wide cache (only new photos are downloaded).
  - The first photo appears as soon as it is decoded, and the start photo is random.
  - Errors show on the clock ("Fotky se nepodařilo načíst" / "Zatím žádné fotky"), with a retry every 30 s and after a reconnect.
  - The demo draws real photos instead of placeholders.
- Media tiles show only the controls the player supports (`supported_features`). Unavailable players get no controls.
- Deleting a page moved to the bottom of the page editor with an inline confirmation; deleting all pages is quieter and confirmed too.
- `showTemperature` / `showHumidity` now apply to the weather block; the top bar no longer repeats temperature and humidity.
- In the light theme, the installed iPhone app paints a dark strip behind the status bar (status bar style `black-translucent`).
- The resize handle is hidden for tile types with a single size.

### Fixed

- Photos never loaded in the app, and panel thumbnails and delete failed. The photo id was sent as `id`, the websocket message id. `photo_get` and `photo_delete` now take `photo_id`, so the integration and the app must be updated together.
- Large photo uploads could exceed Home Assistant's 4 MiB websocket message limit and drop the panel connection; the panel now re-encodes smaller.
- Album art stayed hidden for later tracks after one broken image.
- `mediaPosition` returned `NaN` for an unparsable timestamp, and `formatTime` shows hours.

## [2.1.0-beta.1] - 07.11.2026

### Added

- **Guest passes** (*Přístupy pro hosty*): server-enforced guest access. A guest or wall tablet pairs with a one-time code / QR and gets a dash guest token, never a Home Assistant token. The integration only allows the entities and services of the pass's room profile, within value limits and between the pass's start and end. Design and threat model: `docs/GUEST_PASSES.md`.
- Room profiles created from Home Assistant areas, per-entity services and ranges (heating always limited, 16–26 °C by default), Wi-Fi visible or hidden per profile.
- Always refused for guests, whatever the profile says: locks, alarm panels, cameras, sirens, scripts, automations, buttons, people, trackers, updates, `homeassistant.*`, door/garage/gate covers.
- `POST /api/guest_ha_dashboard/pair` (single-use 12-character codes valid 15 minutes, stored hashed, rate-limited per IP and globally) and the restricted guest WebSocket `/api/guest_ha_dashboard/ws` (filtered states and config, validated service calls, proxied artwork; revocation and expiry close the connection at once).
- Panel tab **Hosté**: profiles with inline editing, passes with QR, manual code, countdown, extend and revoke, printable A6/A4 card with pairing and Wi-Fi QR codes, audit log.
- Guest app: pairing screen (install-first flow for iOS Home Screen apps, manual code entry), calm "access ended" screen, short message and snap-back when the server refuses a value.
- pytest suite (`tests/`) and a CI job running ruff and pytest; the smoke test covers the guest flows in demo mode.

### Changed

- Owner sign-in is labelled as full, unrestricted access; guests should use passes.
- `manifest.json` declares the `http` dependency (needed for the guest endpoints).

## [2.0.0] - 06.11.2026

First public release under the name **dash**.

### Added

- Hosted mode at `dash.matyas.online/<your-ha-host>` with tokens stored per Home Assistant host. The browser talks to Home Assistant directly.
- Self-hosted mode: Docker image with nginx on port 86.
- Hosting choice in the Home Assistant panel: hosted link with Copy and Open, or your own self-hosted URL.
- Live preview in the panel signs in through `postMessage` with a short-lived access token only, origin-checked in both directions. The preview can be hidden.
- StandBy: idle timer, bold or minimal clock in portrait and landscape, and a photo frame with crossfade. Photos are stored in `/config/dash_photos` and served only over the authenticated WebSocket.
- Grid editor: drag to reorder with live reflow, resize handle that snaps to the tile variants.
- Media player tiles in several styles (card, mini, cover, button), with Spotify, Apple Music, YouTube Music and Chromecast branding and an output picker.
- `hello.dash` intro on first setup and a new login card.
- Unlimited pages; the liquid-glass dock holds up to 6 page shortcuts.
- Guest Wi-Fi card with a QR code, weather and greeting header, light and dark mode, Czech and English.
- Brand icon for Home Assistant and HACS (`custom_components/guest_ha_dashboard/brand/`).
- Public demo build (`VITE_MODE=mock`) with `noindex`, `robots.txt`, a "Demo" badge and `docker-compose.demo.yml`.
- CI (build, smoke test, ruff), hassfest and HACS validation, and a release workflow.
- Documentation: configuration, self-hosting, security & privacy (guest account limits, logging, known trade-offs), release guide.
- License: GNU AGPL-3.0-or-later, with notes on commercial licensing (`COMMERCIAL.md`) and contributing (`CONTRIBUTING.md`).

### Changed

- Renamed the project to **dash**. The integration domain stays `guest_ha_dashboard`, so existing installs keep working.
- nginx: `index.html` is served with `no-cache`, access logs are off, and a Content-Security-Policy and other security headers are sent.
- iOS: liquid-glass lens fallback, solid status-bar area, slider ticks inside the tile.
- Tailwind only scans `src/` and `index.html`, so docs and CI files no longer add unused CSS.

### Removed

- The bundled demo Wi-Fi password in the default config. The mock/demo build shows `demo-password` instead.
- The old React liquid-glass demo page and its unused dependencies.

[2.1.0-beta.3]: https://github.com/Lokkisanek/Guest-HA-Dashboard/releases/tag/v2.1.0-beta.3
[2.1.0-beta.2]: https://github.com/Lokkisanek/Guest-HA-Dashboard/releases/tag/v2.1.0-beta.2
[2.1.0-beta.1]: https://github.com/Lokkisanek/Guest-HA-Dashboard/releases/tag/v2.1.0-beta.1
[2.0.0]: https://github.com/Lokkisanek/Guest-HA-Dashboard/releases/tag/v2.0.0
