# Progress: stage 2–3 (branch feat/header-tiles-stage2-3)

## Done

| Part | Item | Proof |
|---|---|---|
| A | Wallpaper under the status bar and to the bottom edge; dark strip only as `general.statusBarStrip` (off) | `scripts/layout-edges.mjs` (pixel rows vs. wallpaper, 2 viewports × light/dark) |
| A | Dock fixed at `safe-bottom + 12 px`, last tile row clears it | `scripts/layout-edges.mjs` |
| A | `?safe=top,bottom` inset override, dev and demo builds only | used by the browser tests |
| B | Tile types `header`, `clock`, `greeting`, `weather`, `wifi`; styles card, plain, lockscreen, compact, glass | `scripts/header-tiles.mjs` (10 renders, contrast ≥ 3), `tests/js/configMigrate.test.js` |
| B | One clock ticker, one weather source, connection badge as an overlay | header tiles test |
| B | Panel: "+ Přidat" menu with groups, inline tile options, General tab without header switches | panel harness test (scratch) |
| B | Config v3 migration (server + app), idempotent; guest filtering of header tiles | `tests/pure/test_config_schema.py` (256 combinations × 2), `tests/fixtures/header-migration.json`, `tests/ha/test_ha_config.py` |
| C8 | Scene tile (button, row), check feedback, aria-live | `scripts/stage2-tiles.mjs`, `tests/pure/test_policy_tiles.py` |
| C9 | Sensor, binary sensor, fan, generic entity | stage 2 test, `tests/pure/test_device_classes.py` |
| C10 | Long-press light sheet; profile capabilities | stage 2 test, policy tests |
| C11 | dash light groups, list targets in the guest policy | `tests/js/lights.test.js`, policy tests, `tests/ha/test_ha_guest_ws.py` |
| D13 | `mediaCaps.js` (all 22 feature bits, compared with installed HA), states, media guest rules | `tests/js/mediaCaps.test.js`, `tests/pure/test_device_classes.py`, `tests/pure/test_policy_tiles.py` |
| D12 | nowplaying and vinyl styles (rotation state, angle kept, reduced motion, off-screen pause) | `scripts/player.mjs` |
| D12b | Player sheet: now playing, players, browse, search; guest `browse_media`/`search_media` with issued-id store | `scripts/player.mjs`, policy tests, `tests/ha/test_ha_guest_ws.py` |
| D14 | `docs/SPEAKERS.md`, link in the panel and the sheet | – |

## Not done

- Queue tab: Music Assistant documents `music_assistant.get_queue`, but its response shape was not verified in installed code; skipped (SPEAKERS.md).
- Guest thumbnails in browse: not sent (would need a proxy for HA browse images); guests see icons.
- Live style previews in the panel's media style picker: the picker uses names only.
- Panel tests run against a local harness in the scratch directory, not in CI.

## Needs a real Home Assistant or iPhone

- `tests/ha` runs only in CI (Home Assistant cannot run on Windows).
- iPhone: status bar contrast, the bottom edge, long-press feel, vinyl rotation in the installed app.
- Real players: Spotify, Music Assistant and MPD capabilities, browse and search results, grouping.
