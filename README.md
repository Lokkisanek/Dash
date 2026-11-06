# dash

**dash** is an open-source, iOS-style dashboard for Home Assistant, built for wall-mounted phones, MagSafe stands and guests. You design it in a Home Assistant sidebar panel with a live iPhone preview. The phone runs it as a PWA.

- Control-Center-style grid with lights, switches, covers, climate and media; drag to reorder, pull the corner to resize.
- Liquid-glass dock with up to 6 pages, plus unlimited pages.
- Media player in several styles, with Spotify, Apple Music and YouTube Music (via Music Assistant) and Chromecast output switching.
- StandBy: after a period of inactivity the phone shows a big clock (portrait and landscape) or a slowly fading photo frame.
- Guest Wi-Fi card with a QR code, a weather and greeting header, light and dark mode, Czech and English.
- A playful `hello.dash` intro on first setup.

```text
 Phone (PWA)                         Your Home Assistant
┌──────────────────────┐  OAuth +   ┌──────────────────────────────┐
│ dash                 │ WebSocket  │ dash integration (HACS)      │
│ dash.matyas.online/  │ ─────────► │ • sidebar config panel       │
│   <your-ha-host>     │  direct    │ • config + photos stored     │
└──────────────────────┘            │   in /config                 │
                                    └──────────────────────────────┘
```

The page is static. Your browser talks to your Home Assistant directly, and nothing passes through or is stored on the dash server.

## Two ways to run it

| | Hosted (free) | Self-hosted |
|---|---|---|
| URL | `https://dash.matyas.online/<your-ha-host>` | your own domain / LAN |
| Setup | none | Docker, port 86 |
| Requirement | HA reachable over **public HTTPS** | HA reachable from the phone |
| Who sees your data | nobody but your browser and your HA | you |

Pick the mode in the panel under **General → Dashboard**. Hosted mode shows your personal link with Copy and Open buttons.

## Install

### 1. Home Assistant integration (HACS)

1. HACS → Integrations → ⋮ → **Custom repositories**.
2. Add `https://github.com/Lokkisanek/Guest-HA-Dashboard` with category **Integration**.
3. Install **dash** and restart Home Assistant.
4. Go to Settings → Devices & services → **Add integration** → **dash**.
5. Open **dash** in the sidebar, build your pages and press **Save**.

### 2. Open the dashboard on the phone

- **Hosted:** open the link from the panel, e.g. `https://dash.matyas.online/home.example.com`. Then sign in with your Home Assistant account and "Add to Home Screen".
- **Self-hosted:** see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

Use a dedicated, non-admin Home Assistant user for guest phones.

## Documentation

- [Configuration](docs/CONFIGURATION.md): pages, tile styles, dock, media, StandBy, photos.
- [Self-hosting](docs/SELF_HOSTING.md): Docker, Coolify, nginx, reverse proxies.
- [Security & privacy](docs/SECURITY.md): what is stored where and why the host can't see it.

## Development

```bash
cp .env.example .env      # VITE_HA_URL=mock → demo data without Home Assistant
npm install
npm run dev               # PWA on http://localhost:5173
npm run build
```

Useful URL flags:

- `?standby=1` forces StandBy.
- `?glass=lens` forces the WebKit liquid-glass path in Chrome.

The integration lives in `custom_components/guest_ha_dashboard/`. The panel is a single web component (`www/panel.js`) with no build step.

## Stack

Vue 3 · Vite · Tailwind 4 · daisyUI 5 · home-assistant-js-websocket · nginx · Home Assistant custom integration.
