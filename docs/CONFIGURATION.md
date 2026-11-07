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

## Guests (Hosté)

Guest passes give a guest or a wall tablet access to one room only. The integration enforces it; see [SECURITY.md](SECURITY.md#owner-mode-and-guest-passes).

**Room profiles** (*Šablony pokojů*)

- **Z místnosti** suggests a profile from a Home Assistant area: the area's entities with their default services. Nothing is saved until you press **Uložit**.
- Tick devices, switch services on or off (e.g. allow `set_temperature` but not `turn_off`) and set ranges. Heating always has a range: 16–26 °C unless you set your own.
- Devices that cannot be given to guests are greyed out with the reason: locks, alarms, cameras, scripts, automations, buttons, garage doors and gates.
- Sensors and weather are view only.
- **Wi-Fi hostům** decides whether the guest sees the Wi-Fi card. Rename a profile by editing its name in place.
- Saving a profile reconnects its guests with the new rules.

**Passes** (*Přístupy*)

- **Vytvořit přístup**: profile, label (e.g. "Pokoj 3 – Novák"), device (guest phone or wall tablet), from and until. Defaults are check-in 14:00 and check-out 11:00 (`PASS_DEFAULT_*` in `const.py`). Phone passes always end; a tablet can run without an end.
- After creating, the panel shows the QR code, the manual code `XXXX-XXXX-XXXX` and how long the code is still valid (15 minutes, single use). **Tisk A6 / A4** prints a card with both QR codes (pass and Wi-Fi) and short Czech/English instructions.
- **QR / nový kód** issues a new code (the old one stops working; pairing again logs out the previously paired device). **Prodloužit** moves the end. **Ukončit** revokes the pass and disconnects the device at once. Ended passes can be deleted.
- Times are entered in the browser's local time.

**Log** (*Záznam*): pairings, failed codes and sign-ins, refused actions with the reason. No device states are logged.

On the guest's phone: scan the QR code. On iPhone, add dash to the Home Screen first (Share → Add to Home Screen) and enter the code in the installed app; iOS keeps the app's storage separate from Safari.
