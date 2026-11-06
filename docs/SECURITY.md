# Security & privacy

dash is designed so that whoever operates the web server, including the public `dash.matyas.online`, **cannot see your Home Assistant data or credentials**.

## How it works

1. The server only hands out static files (HTML, JS, CSS). There is no backend, database, proxy or analytics.
2. The Home Assistant address is part of the URL path (`/home.example.com`). The app reads it in the browser and starts the standard Home Assistant OAuth login. You type your password on **your Home Assistant's** login page, never on dash.
3. Home Assistant redirects back with a one-time `code`. The browser exchanges it for tokens directly with Home Assistant.
4. Tokens are stored in the phone's `localStorage`, scoped per Home Assistant host (`dash_tokens:<host>`).
5. All live traffic (states, service calls, config, photos) goes over a WebSocket **from the phone straight to Home Assistant**.

## What the server could observe

- **The URL path, and the one-time OAuth `code` in the first request's query string.** The bundled nginx config sets `access_log off`, so neither is written anywhere. The code is single-use and expires within minutes. It is useless without the browser's matching login flow.
- **Your IP address**, as with any website.

The server never receives access tokens, refresh tokens, entity states, Wi-Fi passwords or photos.

If you don't want to trust a third-party server at all, [self-host](SELF_HOSTING.md). The build is identical.

## Data stored in Home Assistant

| What | Where |
|---|---|
| Dashboard config (pages, dock, Wi-Fi, StandBy, styles) | `.storage/guest_ha_dashboard` |
| StandBy photos | `/config/dash_photos/*.img` |

Photos are **not** under `/config/www`, so they are not served at the unauthenticated `/local/` path. They are read only through the authenticated WebSocket (`guest_ha_dashboard/photo_get`). Upload and delete require a Home Assistant admin.

The browser resizes and re-encodes photos to JPEG before upload, which also strips EXIF metadata such as GPS location.

## Live preview in the panel

The HA panel embeds the dashboard in an iframe. Instead of logging in again, the iframe asks the panel for credentials:

- The panel only answers when the request comes from the exact origin of the configured dashboard URL.
- It sends only the **short-lived access token**, never the refresh token.
- The dashboard accepts the token only if the message really comes from the Home Assistant origin it belongs to.
- Preview tokens are kept in memory and never written to storage.

## Headers

The nginx config sends:

- A strict Content-Security-Policy: first-party scripts only, `connect-src` limited to `https:`/`wss:` (plus `http:`/`ws:` for LAN setups), and `object-src 'none'`.
- `Referrer-Policy: no-referrer`, so your HA host never leaks to other sites.
- `X-Content-Type-Options` and a restrictive `Permissions-Policy`.
- `frame-ancestors`, which allows the HA panel to embed the preview.

## Recommendations

- Create a **separate non-admin user** for guest phones. You can revoke its tokens any time under *Profile → Security*.
- Expose Home Assistant only over HTTPS.
- Report vulnerabilities privately via GitHub Security Advisories on the repository.
