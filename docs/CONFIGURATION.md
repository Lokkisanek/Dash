# Configuring dash

Everything is configured in the **dash** sidebar panel in Home Assistant and saved with **Save**. Phones pick up changes live.

## Panel settings (⚙)

- Panel theme and language.
- **Live preview**: turn the iPhone preview off and the editor uses the full width. This is stored per browser.

## General

- **Dashboard**: hosted (`dash.matyas.online/<your-ha-host>`) or self-hosted URL.
- **Header** (*Hlavička*): one surface at the top of the dashboard. Parts that are switched off take no space; with everything off there is no header.
  - **Row with time, date and Wi-Fi** (`showTopBar`) has the sub-options **Time** (`showTime`), **24-hour clock** (`use24h`), **Date** (`showDate`) and **Wi-Fi button** (`showWifi`, an icon on the right that opens the Wi-Fi card). When the connection is not healthy (demo, connecting, offline), a small status badge appears next to it.
  - **Greeting and weather** (`showWelcome`): "Dobrý večer, Matyáš" with the HA user's first name, then the outside weather. **Outside temperature** (`showTemperature`) is the big number; **Outside humidity** (`showHumidity`) appears next to the condition.
  - **Weather**: a `weather.*` entity, or Auto (the first `weather.*` entity, else Open-Meteo at your HA home location).
- Since 2.1 `showTemperature` and `showHumidity` apply only to the weather block. The top bar used to show its own small temperature and humidity; that duplicate is gone. If you had them switched off, switch them on to see the big temperature.
- iPhone: the app draws under the status bar (`black-translucent`). In the light theme the installed app paints a dark strip behind the status bar, so its white clock stays readable. Dark theme and StandBy need none.

## Pages

Add as many pages as you like. Each page has a name, an icon and a 4-column grid of tiles.

- **Order of pages**: drag a page pill to a new place. With a mouse this works at once; on touch screens, press and hold first. From the keyboard, focus a pill and press **Alt + ←/→**. The order is the swipe order in the app. The dock links to pages by id, so reordering never changes it. The phone preview shows the new order after **Uložit**, like every other change.
- **Delete a page**: **Smazat stránku** is the last thing in the page editor and asks **Opravdu smazat? Ano / Zrušit** inline. The neighbouring page is selected afterwards, and dock entries pointing to the deleted page are removed. **Smazat všechny Pages** sits below it, also with a confirmation.
- **Select** a tile by clicking it; its settings open below the grid.
- **Move**: drag a tile. The other tiles make room as you go. On touch screens, hold briefly before dragging.
- **Resize**: drag the rounded corner at the **bottom-right** of a tile. The tile grows to the right and down, and snaps to the closest supported style. For example, a small round light button pulled wide becomes a slider. Types with a single size (the divider) have no handle.
- **Section divider**: **+ Oddělovač** adds a full-width row: a section name on the left, a thin line after it. Type the name straight into the divider in the grid (Enter or click elsewhere to finish, at most 60 characters). Leave it empty for just a line. In the app, everything after a divider until the next one forms its own section.

### Icons

Pages, tiles and dock entries share one icon picker with about 340 [lucide](https://lucide.dev) icons. It has:

- A search box that ignores case and diacritics. It matches the icon name and Czech and English keywords ("lampa", "koupelna", "žaluzie", "vrata", "kamera"…), as well as the category.
- Category chips: Domov a místnosti, Světla, Kuchyně a spotřebiče, Topení a klima, Zabezpečení a vstup, Média a zábava, Počasí a příroda, Auto a doprava, Rodina a zvířata, Ostatní.
- Recently used icons shown first. They are kept per browser.
- Keyboard use: arrows move between icons, Enter picks one, Esc closes the picker.

The catalog lives in `scripts/icon-catalog.json`; `npm run gen:icons` regenerates the app and panel files. All 56 icons offered before 2.1 are still there. An icon name the app does not know falls back to ✨ (Sparkles).

### Tile styles

| Type | Styles (size = columns × rows) |
|---|---|
| Light | button 1×1/2×1, slider 4×1/2×1, vertical 1×2/2×2, card 2×2/4×2 |
| Switch | button 1×1/2×1, row 4×1, card 2×2/4×2 |
| Cover | slider 4×1/2×1, vertical 1×2/2×2, card 2×2 |
| Climate | card 2×2, dial 4×3 |
| Media player | card 4×2/2×2, mini 4×1/2×1, cover 2×2/4×3/4×4, button 1×1 |
| Divider | line 4×1 (full row, no entity) |

All types, styles and sizes come from one file, `shared/tiles.json`. `npm run gen:tiles` turns it into the app's `src/lib/tileRegistry.generated.js`, the panel's `www/tiles.js` and the integration's `tile_registry.py`. CI fails if a generated file is out of date (`npm run check:generated`).

### Stored config and versions

The integration stores the dashboard config with a `configVersion`:

- **1**: everything saved before 2.1 (no field).
- **2**: the field exists, and tiles are checked against the tile registry on every load and save.

Migration from 1 to 2 runs automatically on load and changes no data. Legacy `rooms` still become `pages`, and missing `general`/`standby` sections get their defaults.

The checks on load and save:

- A tile of an **unknown type** is dropped, with a warning in the Home Assistant log (`dash: dropped … tile(s) of unknown type …`).
- A tile **without** a type gets it from its entity (`light.x` → light), as long as that is a known type.
- An unknown **style** or **size** falls back to the type's default.
- Tiles without an entity yet (an empty entity field) are kept.
- Dividers get an id `divider-<8 hex>` if they have none.

Downgrading to an older version keeps the stored file, but an older integration drops tile types it does not know the next time you save.

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
  - The first photo appears as soon as it is loaded, and the rest join while the frame runs.
  - Photos stay in memory, so going idle again shows them at once and only new photos are downloaded.
  - The order is the upload order, starting at a random photo each time.
  - With *reduce motion* on, there is no zoom.
  - If the photos cannot be loaded, the clock shows a grey line "Fotky se nepodařilo načíst", or "Zatím žádné fotky" when none are uploaded, and the app retries every 30 s. See [Diagnostics](DIAGNOSTICS.md) for how to find the reason.

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
