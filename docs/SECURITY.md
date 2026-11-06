# Security & privacy

dash is designed so that the server that hosts it, including the public `dash.matyas.online`, **never receives your Home Assistant tokens, entity states, Wi-Fi passwords or photos**.

That is not the same as "you don't have to trust anyone". In hosted mode your browser runs JavaScript delivered by the operator of that server. You have to trust that the deployed code is the code in this repository and does what it says. Self-hosting removes that trust: you run code you built yourself.

## How it works

1. The server only hands out static files (HTML, JS, CSS). There is no backend, database, proxy or analytics.
2. The Home Assistant address is part of the URL path (`/home.example.com`). The app reads it in the browser and starts the standard Home Assistant OAuth login. You type your password on **your Home Assistant's** login page, never on dash.
3. Home Assistant redirects back with a one-time `code`. The browser exchanges it for tokens directly with Home Assistant.
4. Tokens are stored in the phone's `localStorage`, scoped per Home Assistant host (`dash_tokens:<host>`).
5. All live traffic (states, service calls, config, photos) goes over a WebSocket **from the phone straight to Home Assistant**.

## What the server could observe

- **The URL path, and the one-time OAuth `code` in the first request's query string.** The bundled nginx config sets `access_log off`, so nginx writes neither anywhere. Proxies or CDNs in front of it are a separate matter, see [Logging](#logging). The code is single-use and expires within minutes. It is useless without the browser's matching login flow.
- **Your IP address**, as with any website.

The server never receives access tokens, refresh tokens, entity states, Wi-Fi passwords or photos.

If you don't want to trust a third-party server at all, [self-host](SELF_HOSTING.md). The build is identical.

## Guest accounts are not sandboxed

Home Assistant has no per-entity permissions for non-admin users. A non-admin user can still see and control **all** entities, and can open the full Home Assistant UI with the same login.

dash only hides tiles in its own UI. It does **not** enforce any access limits.

- Do not expose locks, alarms, garage doors or cameras to a guest account unless access is restricted another way (separate network, a permissions add-on, kiosk lockdown of the device).
- When the guest leaves, revoke the guest user's refresh token under *Profile → Security*.

Background: <https://github.com/orgs/home-assistant/discussions/1171>

## Data stored in Home Assistant

| What | Where |
|---|---|
| Dashboard config (pages, dock, Wi-Fi, StandBy, styles) | `.storage/guest_ha_dashboard` |
| StandBy photos | `/config/dash_photos/*.img` |

The Wi-Fi password is stored in Home Assistant and returned by `guest_ha_dashboard/get_config` to **any signed-in Home Assistant user**, admin or not. That is intended: guests need it to join the network. Saving the config requires an admin.

Photos are **not** under `/config/www`, so they are not served at the unauthenticated `/local/` path. They are read only through the authenticated WebSocket (`guest_ha_dashboard/photo_get`). Upload and delete require a Home Assistant admin.

The browser resizes and re-encodes photos to JPEG before upload, which also strips EXIF metadata such as GPS location.

## Weather (Open-Meteo)

If Home Assistant has no `weather.*` entity, the browser fetches the outside weather from `api.open-meteo.com`. That request contains the **latitude and longitude of your Home Assistant home** (from the HA core config) and comes from the phone's IP address. It is refreshed every 15 minutes. See `src/composables/useWeather.js`.

With a `weather.*` entity in Home Assistant, no request goes to Open-Meteo.

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
- `frame-ancestors 'self' https: http:`, which allows the HA panel to embed the preview.

## Known trade-offs

- **`frame-ancestors` allows any origin.** Every user's Home Assistant runs on a different host, so the hosted page cannot list them in advance, and the HA panel must be able to embed the preview. As a result, any website can embed dash in an iframe. The embedding page does not get tokens (the preview only accepts them from its own Home Assistant origin), but a framed, signed-in dashboard could in principle be used for clickjacking. A self-hosted instance can restrict `frame-ancestors` to its own Home Assistant origin.
- **One origin for all hosted users.** Everyone on `dash.matyas.online` shares that origin, so the tokens for all Home Assistant hosts used on a device live in the same `localStorage`. An XSS bug in dash would expose all of them. The strict CSP reduces this risk but does not remove it. A self-hosted instance only holds your own tokens.

## Logging

nginx inside the container has `access_log off`.

Anything in front of it, such as Coolify's Traefik, Cloudflare, another reverse proxy or a CDN, keeps **its own** logs. The first OAuth redirect contains a one-time `code` in the query string, so the operator must disable those logs or strip query strings from them. See the checklist in [SELF_HOSTING.md](SELF_HOSTING.md#logging-checklist).

### Hosted instance (`dash.matyas.online`)

TODO(owner): confirm Coolify/Traefik and Cloudflare logging for dash.matyas.online

## Recommendations

- Create a **separate non-admin user** for guest phones, and read [Guest accounts are not sandboxed](#guest-accounts-are-not-sandboxed).
- Expose Home Assistant only over HTTPS.
- Report vulnerabilities privately via GitHub Security Advisories on the repository.
