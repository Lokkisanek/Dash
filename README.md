# Guest HA Dashboard

Hostovský PWA tablet (MagSafe) + **Home Assistant integrace** (HACS) pro interaktivní konfiguraci.

```text
Coolify / server          Home Assistant
┌─────────────────┐       ┌──────────────────────────┐
│ Guest PWA :86   │ ◄WS── │ Guest HA Dashboard       │
│ OAuth login     │       │ Sidebar panel = config UI│
└─────────────────┘       └──────────────────────────┘
```

## Co kam patří

| Kde | Co děláš |
|---|---|
| **Home Assistant** (HACS) | Místnosti, entity, scény, Wi‑Fi — sidebar **Guest Dashboard** |
| **PWA na serveru** | Hosté ovládají dům; přihlášení přes normální HA účet (OAuth) |

## 1) Instalace do Home Assistant (HACS)

1. HACS → **Integrations** → ⋮ → **Custom repositories**
2. URL tohoto repa, kategorie **Integration**
3. Nainstaluj **Guest HA Dashboard** → restart HA
4. Settings → Devices & services → **Add integration** → Guest HA Dashboard
5. V sidebaru otevři **Guest Dashboard** a nastav místnosti / zařízení / scény / Wi‑Fi → **Uložit**

## 2) Hostování PWA (Coolify / Compose)

```bash
docker compose up -d --build
# → http://SERVER:86
```

V Coolify: **Docker Compose**, port **86:86**.  
Build arg `VITE_HA_URL` je volitelný hint pro login obrazovku (OAuth běží v prohlížeči — **nepotřebuješ long-lived token**).

Na tabletu otevři PWA → zadej URL Home Assistantu → přihlas se HA účtem → config se stáhne z integrace.

## Lokální vývoj

```bash
cp .env.example .env
# VITE_HA_URL=mock   → demo bez HA
# VITE_HA_URL=https://ha.local:8123 → OAuth proti tvé HA
npm install
npm run dev
```

## Stack

Vue 3 · Vite · Tailwind · daisyUI · home-assistant-js-websocket · nginx · HA custom integration (HACS)
