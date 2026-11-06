# Changelog

All notable changes to dash are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [2.0.0] - Unreleased

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

[2.0.0]: https://github.com/Lokkisanek/Guest-HA-Dashboard/releases/tag/v2.0.0
