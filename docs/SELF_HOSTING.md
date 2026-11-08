# Self-hosting dash

The dashboard is a static PWA served by nginx on port **86**.

## Docker Compose

```bash
git clone https://github.com/Lokkisanek/Dash dash
cd dash
docker compose up -d --build
# → http://SERVER:86/<your-ha-host>
```

Then, in the Home Assistant panel, go to **General → Dashboard → Self-hosted** and enter your URL, e.g. `https://dash.example.com`. The live preview uses it.

### Build arguments

| Arg | Purpose |
|---|---|
| `VITE_HA_URL` | Optional default Home Assistant URL. With it, the app skips the HA field and always uses this instance. `mock` builds a demo. |
| `VITE_MODE` | `mock` for a demo build. |

No long-lived token is needed; login happens via OAuth in the browser.

## Coolify

1. New resource → **Docker Compose** → this repository.
2. Port mapping `86:86`, and attach your domain.
3. Redeploy after every update. `index.html` is served with `Cache-Control: no-cache`, so phones pick up new versions on the next launch.

## Behind a reverse proxy

Any proxy works; just forward to port 86. Keep these properties from the bundled `nginx.conf`:

- SPA fallback: every unknown path (`/<ha-host>`) must return `index.html`.
- No access logs on the dashboard host, because the first OAuth redirect carries a one-time code in the query string.
- `Cache-Control: no-cache` for `index.html`, and long caching for `/assets/*` (hashed file names).

## Logging checklist

The bundled nginx has `access_log off`, but every layer in front of it keeps its own logs. The first OAuth redirect carries a one-time `code` in the query string.

- [ ] Reverse proxy (Coolify's Traefik, Caddy, nginx, …): access logs for the dash host disabled, or query strings stripped.
- [ ] CDN / tunnel (Cloudflare, …): request logs and log push for the dash host disabled, or query strings stripped.
- [ ] Any other access logs, analytics or error tracking on the path: no full URLs with query strings.

See [Logging](SECURITY.md#logging) in the security notes.

## Public demo

A demo with mock data runs without Home Assistant:

```bash
docker compose -f docker-compose.demo.yml up -d --build
# → http://SERVER:87/
```

It builds the same Dockerfile with `VITE_MODE=mock`. The demo build:

- shows mock entities and a "Demo" badge in the top bar, with no login screen;
- uses the fake Wi-Fi password `demo-password`;
- adds `<meta name="robots" content="noindex,nofollow">` and a `robots.txt` with `Disallow: /`, so search engines skip it.

## Guest passes behind a proxy

Guest devices talk to two endpoints on your **Home Assistant** host (not the dash host):

- `POST /api/guest_ha_dashboard/pair`
- `GET /api/guest_ha_dashboard/ws` (WebSocket)

A proxy in front of Home Assistant must pass WebSocket upgrades for `/api/guest_ha_dashboard/ws` as it does for `/api/websocket` (nginx: `proxy_http_version 1.1` plus the `Upgrade` and `Connection` headers), must not strip CORS headers, and should keep idle timeouts above 60 s (the app pings every 50 s).

No `http: cors_allowed_origins` entry is needed for guest passes. For correct per-client rate limiting behind a proxy, set `http: use_x_forwarded_for: true` and `trusted_proxies` in Home Assistant; otherwise all guests share the proxy's IP and its failed-attempt limit.

## Home Assistant requirements

- The phone must reach Home Assistant at the address in the URL path.
- If the dashboard is served over HTTPS, Home Assistant must be HTTPS too. Browsers block `ws://` from an `https://` page.
- No CORS configuration is needed. HA's OAuth endpoints and WebSocket accept cross-origin clients.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

The integration panel (`custom_components/guest_ha_dashboard/www/panel.js`) is plain JS. Copy the folder to your HA `/config/custom_components/` and restart Home Assistant.
