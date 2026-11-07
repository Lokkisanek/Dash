# Diagnostics: photo frame and music player

Findings from the Stage 0 review (November 2026). Every claim was either checked in the code, run in the demo build with Playwright, or tried read-only against a real Home Assistant 2026.11.0 with dash installed. Unverified points are listed separately.

## Photo frame (StandBy, mode "Fotky")

### Code path

1. **Upload, in the panel** (`custom_components/guest_ha_dashboard/www/panel.js`, StandBy tab):
   - `_encodeImage` resizes the photo to 1920 px (JPEG 0.85) and makes a 360 px thumbnail (JPEG 0.75).
   - `_uploadPhotos` sends both as base64 in one `guest_ha_dashboard/photo_upload` message.
   - `_loadPhotos` lists the photos and fetches the thumbnails; `_deletePhoto` deletes one.
2. **Integration** (`websocket_api.py`):
   - `ws_photo_upload` (admin) checks the magic bytes and `PHOTO_MAX_BYTES` (3 MiB per image), then writes `<uuid>.img` and `<uuid>_t.img` to `/config/dash_photos` (`PHOTOS_DIR`). It refuses uploads beyond `PHOTOS_MAX` (60).
   - `_list_photos` returns the ids, oldest first (by mtime), ignoring `*_t.img`.
   - `ws_photo_list` and `ws_photo_get` work for any signed-in HA user; `ws_photo_delete` is admin only.
3. **Guest pass** (`guest_ws.py`): `_photo_list` and `_photo_get` exist only after the token was accepted.
   - The pass validity is enforced by the socket: expiry and revocation close it.
   - `photo_id` is checked against `^[a-f0-9]{32}$` before a path is built.
4. **App**:
   - `src/composables/useHomeAssistant.js`: `ownerTransport` / `guestTransport` / `mockTransport` `.photoList()` and `.photoGet()`. `photoApi` is the throwing variant used by the cache. `listPhotos` / `fetchPhoto` are kept as non-throwing wrappers.
   - `src/composables/usePhotoCache.js` and `src/lib/photoCache.js` hold the cache.
   - `src/components/StandbyScreen.vue` runs the slideshow.
5. **Settings to screen**:
   - Defaults: `DEFAULT_STANDBY` in `const.py`, normalized by `_normalize_standby` in `store.py`; `get_config` returns them unchanged.
   - Owner mode: `applyGuestConfig` in `useGuestConfig.js` merges them over the fallback.
   - Guest mode: `filter_config` (`guest_policy.py`) copies `standby` unchanged.
   - Mock mode: `src/config/guestDashboard.js`.
   - `App.vue` passes `standby` to `useIdle(idleMinutes, enabled || ?standby=1)` and mounts `<StandbyScreen :settings="standby">` while idle. `?standby=1` forces idle on mount even if StandBy is switched off.

### Bugs found

**1. Root cause: `photo_get` and `photo_delete` could never succeed from a client.** Fixed.

Where:
- `websocket_api.py`, schemas of `ws_photo_get` and `ws_photo_delete`.
- `panel.js`, `_loadPhotos` and `_deletePhoto`.
- `useHomeAssistant.js`, `ownerTransport.photoGet`.

What happened:
- The photo id was sent in the field `id`. In the Home Assistant websocket protocol, `id` is the message id. home-assistant-js-websocket always overwrites it with its counter, and HA requires it to be an increasing integer (`connection.py`, `cur_id`).
- The command schema replaced `id` with "32 hex chars", so every request failed validation.
- On the real instance, `photo_get` returned `invalid_format: expected str at 'id'. Got 96` for all 4 stored photos.
- Effects:
  - The app got no photos and silently fell back to the clock.
  - The panel showed empty thumbnails, because errors were swallowed.
  - Deleting a photo always failed.

Fix:
- The field is now `photo_id` in the integration, the panel and the app. The guest socket already used `photo_id`.
- New tests: `tests/ha/test_ha_photos.py`.

Note: the hosted app and the integration must both be updated. A new app talking to an old integration still gets an error, but now shows "Fotky se nepodařilo načíst" instead of failing silently.

**2. Silent fallback.** Fixed.
- `listPhotos` / `fetchPhoto` turned every error into `[]` / `null` with only a `console.warn`, and StandbyScreen then showed the clock.
- Now the fallback clock shows "Fotky se nepodařilo načíst" or "Zatím žádné fotky". `.standby[data-photo-status]` carries `idle | loading | ready | empty | error`, and the console gets a collapsed group `[dash] StandBy photos: <status>` with the reason.

**3. Everything was downloaded again on every idle entry, sequentially.** Fixed.
- StandbyScreen is mounted with `v-if="idle"`. It listed and downloaded every photo one by one and showed nothing until all had arrived. On leaving, it revoked all object URLs.
- Now a page-wide cache keeps the decoded photos. Each idle entry lists the ids, reuses cached photos and downloads only new ones, 2 at a time.

**4. The watcher only reacted to `settings.mode`.** Fixed.
- Changes of the photo list, a reconnect, or `photoSeconds` while the frame was open were ignored.
- Now:
  - The list is reloaded on each entry and every 10 minutes while open.
  - After an error it retries after 30 s, and again on reconnect.
  - A changed `photoSeconds` reschedules the slideshow.

**5. Cross-fade with 1 and 2 photos, and the first-photo flash.** Fixed.
- With 1 photo the old code never scheduled a slide, which was correct, but it also never faded in.
- Each photo was swapped in before the browser had decoded it.
- Now every photo is decoded (`img.decode()`) before it is used, and the first one fades in.
- A photo that is deleted while on screen is replaced. One that fails to decode is skipped for good, not retried in a loop.

**6. `revokeObjectURL` timing.** Fixed.
- URLs were revoked while the cross-fade layer could still show them, and on every unmount.
- Now a URL is revoked only when its photo leaves the list (3 s later), on logout or a change of home, or when a download finishes after the cache was cleared.

**7. Upload size versus the websocket message limit.** Fixed in the panel.
- HA's websocket (`websocket_api/http.py`) uses aiohttp's default `max_msg_size` of 4 MiB per incoming message (aiohttp 3.14).
- `PHOTO_MAX_BYTES` allows 3 MiB per image, which is 4 MiB as base64, plus the thumbnail. A large 1920 px JPEG would close the panel's whole websocket instead of returning an error.
- Typical 1920 px JPEGs at 0.85 are 0.3–1.5 MB (0.4–2 MB as base64), so this was rare.
- The panel now keeps photo plus thumbnail under 3.5 M base64 characters. It re-encodes at a lower quality or size, and if that is not enough it shows "Fotka je i po zmenšení příliš velká".

**8. Demo placeholders hid the real code path.** Fixed.
- The mock transport returned no photos, and StandbyScreen painted CSS gradients.
- The demo now draws 4 flat images at runtime (`src/lib/mockPhotos.js`) and serves them through the same cache and slideshow.
- Demo-only switches: `?mockPhotos=1` (photo mode, 3 s per photo), `?mockPhotos=empty`, `?mockPhotos=fail`.

### Checked and fine

- **CSP**:
  - `nginx.conf` (also used by `docker-compose.yml`, `docker-compose.demo.yml` and the Dockerfile) allows `img-src 'self' data: blob: https: http:`, so `background-image: url("blob:…")` is allowed.
  - The live `https://dash.matyas.online/` sends the same header.
- **Permissions**:
  - `photo_list` / `photo_get` are registered without `require_admin`, so non-admin owner accounts can read photos.
  - Guest tokens cannot call them on `/api/websocket` at all. They use the guest socket, which has its own `photo_list` / `photo_get` and the same id regex.
- **Config path**:
  - `standby.enabled`, `mode`, `idleMinutes` and `photoSeconds` reach StandbyScreen unchanged in owner, guest and mock mode.
  - On the real instance: `enabled: true`, `mode: "photos"`, `idleMinutes: 1`, `photoSeconds: 5`, 4 photos.
- **`?standby=1`** forces the screen even with StandBy off. Tapping wakes it up, and the idle timer then runs with the configured minutes.

### Not verified

- The fix on a real Home Assistant, because the integration on your server still has the old schema. The protocol fix itself is covered by `tests/ha/test_ha_photos.py`, which runs in CI on Linux; Home Assistant cannot run on Windows.
- How iOS Safari (Home Screen app) behaves with many 1920 px photos held in memory. 60 photos at about 1 MB each is the worst case.
- Upload of a real 3 MiB photo through a proxy (Cloudflare, nginx) with its own body or frame limits.

### Manual checklist (real Home Assistant)

1. Update the integration (HACS or copy `custom_components/guest_ha_dashboard`), restart Home Assistant, and hard-reload the dash page and the panel. The hosted app must be the new build too.
2. In the panel → **StandBy**: **Zapnout standby** is on, **Režim** is **Fotky**, and the thumbnails are visible (they were empty before). If you changed something, press **Uložit**.
3. On the server, `ls -la /config/dash_photos` should show `<32 hex>.img` and `<32 hex>_t.img` per photo.
4. Open `<dash-url>?standby=1` (for example `https://dash.matyas.online/ha.matyas.online?standby=1`). A photo should appear within a few seconds and change every *photoSeconds*.
5. If you see the clock with a grey line under the date:
   - "Fotky se nepodařilo načíst": open the console (Safari: Develop → your iPhone; Chrome: F12) and expand **`[dash] StandBy photos: error`**. The reason is inside, for example `photo_list failed: Unknown command.` (old integration) or `expected str at 'id'` (old integration with the new app).
   - "Zatím žádné fotky": the list is empty. Check step 3.
6. Websocket frames (Chrome F12 → Network → WS → `websocket` → Messages):
   - You should see `{"type":"guest_ha_dashboard/photo_list","id":N}` → `{"photos":[…]}`.
   - Then `{"type":"guest_ha_dashboard/photo_get","photo_id":"…","id":N}` → `{"mime":"image/jpeg","data":"…"}`.
7. Wake the screen by tapping and wait for StandBy again: the photos must appear immediately, with no new `photo_get` frames.
8. Delete a photo in the panel. Within 10 minutes it leaves the frame; on the next StandBy entry it is gone at once.
9. As a guest: open dash with a guest pass and `?standby=1`. On the guest socket (`/api/guest_ha_dashboard/ws`) the frames are `photo_list` and `photo_get` with `photo_id`.
10. On iPhone (Home Screen app): leave it idle for *idleMinutes*. The photos must fade in without a white flash, and the clock in the corner must be readable.

## Music player

### Code path

- `src/components/tiles/MediaTile.vue` has the variants `card`, `mini`, `cover` and `button`, with the style and size from the panel.
- `src/lib/mediaBrand.js` contains `detectMediaBrand`, `mediaPosition` and `formatTime`.
- `src/lib/mediaFeatures.js` is new: the `supported_features` bits and `mediaControls`.
- `useHomeAssistant.js`:
  - `mediaCommand` → `callService('media_player', …)`. Errors are caught and logged in `sendService`; guest refusals show a toast.
  - `mediaArtwork`: in owner mode, `haAssetUrl(entity_picture_local || entity_picture)`. In guest mode it asks the guest socket (`media_image`), keyed by content id, title and artist; in the guest state `attrs.dash_artwork` replaces the token URL.
- Panel: the media tile offers the styles `tile`, `mini`, `cover` and `button`.

### Bugs found

**1. Controls were shown for features the player does not have.** Fixed.
- Previous, play/pause, next, volume and the output picker were always rendered.
- On the real instance, `media_player.spotify_matyas_odehnal` is `idle` with `supported_features: 2048` (only `SELECT_SOURCE`). Play/pause there makes HA reject the call ("does not support this service"), so the tile looked broken.
- The bits are now read from `supported_features`, with the values copied from `MediaPlayerEntityFeature` in the installed HA source. Requirements follow `media_player/services.py`:
  - play/pause needs `PLAY` or `PAUSE`;
  - next needs `NEXT_TRACK`, previous `PREVIOUS_TRACK`;
  - volume needs `VOLUME_SET`;
  - output needs `SELECT_SOURCE` and a non-empty `source_list`.
- `unavailable` and `unknown` disable all controls.
- A player without the attribute (old integrations, demo data) keeps every control.

**2. Album art stayed hidden after one failed image.** Fixed. `artFailed` was never reset, so after one broken picture no artwork came back for later tracks. It is now reset whenever the artwork URL changes.

**3. `mediaPosition` returned `NaN` for an unparsable `media_position_updated_at`, and `0` for a `null` position.** Fixed: it returns the reported position, or `null` when there is none.

**4. `formatTime` showed 75:00 for long media.** It now shows `1:15:00`.

### Checked and fine

- `volume_set` sends 0–1 (the slider is 0–100, divided by 100), and HA expects 0–1.
- `select_source` is offered only when `source_list` has entries.
- `mediaPosition` does not run backwards when the device clock is behind, and stops at `media_duration`.
- **Owner mode on another origin (hosted)**:
  - `entity_picture` is relative (`/api/media_player_proxy/<entity>?token=…&cache=…`), and `haAssetUrl` prefixes the HA URL.
  - The URL carries HA's per-entity access token, so `<img>` needs no auth header. CSP `img-src https:` allows it.
- **Guest mode**:
  - `sanitize_state` drops `entity_picture` (it carries a token) and sets `dash_artwork: true`.
  - Artwork comes over the guest socket (`media_image`) as an object URL.
  - Old URLs are revoked when the track changes, and a stale answer is revoked immediately.

### Findings for Stage 3 (not started)

- `off`, `standby` and `idle` show the same "Nic nehraje" layout. A `turn_on` button (bit 128) for `off` players would make sense, as would a "buffering" hint.
- There is no seek bar (bit 2, `media_seek`) and no mute (bit 8).
- A mixed-content case: an HA on `http://` behind an `https://` dash page cannot load artwork in owner mode, because browsers block mixed images. The fix would be to proxy artwork the same way as in guest mode.
- Owner mode always uses HA's proxy URL with `cache=`. HA changes the token every few minutes, which reloads the image; this is harmless but causes extra requests.
- Guest artwork is fetched once per track; a failed fetch is not retried until the track changes.
- The output picker is a bottom sheet with its own card. For the style pass, consider an inline list.

### Manual checklist (music)

1. Start music on a player, for example a Chromecast or the Spotify app on your phone. In dash (owner), the tile must show the artwork, title and artist, and only the buttons the player supports.
2. Skip to the next track: the artwork must change, including after a track that had no picture.
3. With Spotify idle: only the output button (if it has devices) is shown, with no play/pause.
4. Volume: drag the slider. HA → Developer tools → States → `volume_level` must follow (0–1).
5. As a guest with the player in the profile: the artwork comes over the guest socket, and `media_image` frames are visible in DevTools. No `token=` may appear anywhere in the guest app (search the Network panel).
6. Switch the player off: the tile must not offer actions that HA would refuse.

## How to run the automated checks

```
npm test                       # vitest: media helpers, photo cache, tile registry, icons
VITE_MODE=mock npm run build && npx vite preview --port 4173 --strictPort &
node scripts/smoke.mjs && node scripts/standby-photos.mjs
pytest                         # Linux/macOS; on Windows: pytest tests/pure -p no:homeassistant
```
