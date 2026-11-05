# Guest HA Dashboard

Ultra-sleek Progressive Web App for an **iPhone on MagSafe** — a Smart Home Guest Controller for **Home Assistant** (Zigbee2MQTT).

## Quick start (Mock Mode)

```bash
npm install
npm run dev
```

With `VITE_HA_URL=mock` (default in `.env`), the app runs fully interactive Local Mock Mode — no HA required.

## Connect to Home Assistant

1. Copy `.env.example` → `.env`
2. Set your values:

```env
VITE_HA_URL=https://homeassistant.local:8123
VITE_HA_TOKEN=your_long_lived_access_token
```

3. Restart `npm run dev`

Create a Long-Lived Access Token in HA: **Profile → Security → Long-Lived Access Tokens**.

## Configure rooms / lights / scenes

Edit **`src/config/guestDashboard.js`** — add rooms, devices, scenes, or guest Wi-Fi in seconds.

## Docker (homelab)

Container listens on **port 86**.

```bash
# Mock / demo image
docker build -t guest-ha-dashboard .

# Live HA image
docker build \
  --build-arg VITE_HA_URL=https://homeassistant.local:8123 \
  --build-arg VITE_HA_TOKEN=your_token \
  -t guest-ha-dashboard .

docker run -d --name guest-ha -p 86:86 guest-ha-dashboard
```

## Coolify

1. **New Resource → Public/Private Repository** (nebo GitHub/GitLab) → vyber tenhle repo.
2. Build Pack: **Dockerfile** (Coolify ho detekuje sám).
3. **Ports Exposes:** `86`  
   **Ports Mappings:** `86:86` (nebo v UI jen Expose `86` a mapuj host `86`).
4. **Build Arguments** (Environment → Build-time):

   | Name | Value |
   |---|---|
   | `VITE_HA_URL` | `https://tvoje-ha:8123` (nebo `mock`) |
   | `VITE_HA_TOKEN` | long-lived access token z HA |

   Vite je peče do JS při buildu — po změně URL/tokenu musíš **Rebuild**.
5. Doména (volitelně): přidej domain v Coolify; reverse proxy pak míří na container port **86**.
6. Deploy → otevři `http://SERVER_IP:86` (nebo tvoji doménu).

> HA WebSocket: pokud HA běží jinde, musí být dostupné z prohlížeče hosta (CORS / same network), ne jen z Coolify kontejneru.

## iPhone kiosk setup

1. Open the URL in Safari
2. Share → **Add to Home Screen**
3. Launch the icon (standalone fullscreen)
4. Mount on MagSafe — Screen Wake Lock keeps the display awake

## Stack

Vue 3 · Vite · Tailwind CSS · lucide-vue-next · home-assistant-js-websocket · nginx
