# Changelog

All notable changes to dash are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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

[2.1.0-beta.2]: https://github.com/Lokkisanek/Guest-HA-Dashboard/releases/tag/v2.1.0-beta.2
[2.1.0-beta.1]: https://github.com/Lokkisanek/Guest-HA-Dashboard/releases/tag/v2.1.0-beta.1
[2.0.0]: https://github.com/Lokkisanek/Guest-HA-Dashboard/releases/tag/v2.0.0
