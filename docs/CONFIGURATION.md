# Configuring dash

Everything is configured in the **dash** sidebar panel in Home Assistant and saved with **Save**. Phones pick up changes live.

## Panel settings (⚙)

- Panel theme and language.
- **Live preview**: turn the iPhone preview off and the editor uses the full width. This is stored per browser.

## General

- **Dashboard**: hosted (`dash.matyas.online/<your-ha-host>`) or self-hosted URL.
- Top bar, greeting, weather (taken from your HA home location), 12/24 h clock.

## Pages

Add as many pages as you like. Each page has a name, an icon and a 4-column grid of tiles.

- **Select** a tile by clicking it; its settings open below the grid.
- **Move**: drag a tile. The other tiles make room as you go. On touch screens, hold briefly before dragging.
- **Resize**: drag the rounded corner at the **bottom-left** of a tile. The tile grows to the left and down, and snaps to the closest supported style. For example, a small round light button pulled wide becomes a slider.

### Tile styles

| Type | Styles (size = columns × rows) |
|---|---|
| Light | button 1×1/2×1, slider 4×1/2×1, vertical 1×2/2×2, card 2×2/4×2 |
| Switch | button 1×1/2×1, row 4×1, card 2×2/4×2 |
| Cover | slider 4×1/2×1, vertical 1×2/2×2, card 2×2 |
| Climate | card 2×2, dial 4×3 |
| Media player | card 4×2/2×2, mini 4×1/2×1, cover 2×2/4×3/4×4, button 1×1 |

## Media

Any `media_player` entity works. dash recognises the source and shows its brand:

- **Spotify**: the official Spotify integration. The output button lists your Spotify Connect devices (`source_list`), including phones running Spotify.
- **Apple Music / YouTube Music**: through [Music Assistant](https://music-assistant.io), which exposes them as media players.
- **Chromecast / Google TV**: the Google Cast integration; cast-capable speakers and TVs appear as outputs.

Bluetooth speakers paired to the phone are handled by the phone's OS. Browsers cannot route audio to Bluetooth themselves. Expose the speaker through Home Assistant (e.g. via Music Assistant or an ESPHome / Bluetooth proxy) to control it from dash.

## Dock

Up to 6 page shortcuts in the liquid-glass dock.

## Wi-Fi

Guest network name and password. The dashboard shows them with a QR code to join.

## StandBy

After a chosen time without touches (1–30 min), the phone switches to StandBy. A tap wakes it up.

- **Clock**: big rounded digits. In portrait, hours sit above minutes; in landscape, they form one wide row. The clock drifts slightly to avoid burn-in. Pick the colourful *bold* style or a thin *minimal* style.
- **Photo frame**: your photos slowly cross-fade with a gentle zoom; a small clock stays in the corner. Choose the interval (5–60 s).

Photos are uploaded in the StandBy tab. The browser resizes them to at most 1920 px, so even large originals stay small. Up to 60 photos are stored in Home Assistant (see [Security](SECURITY.md)).

Use **Show in preview** to see StandBy in the panel's iPhone preview without waiting.

## Styles

Accent colour, light and dark mode, and glass options.
