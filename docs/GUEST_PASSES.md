# Guest passes

Server-enforced guest access for dash. A guest never gets a Home Assistant token. The integration issues its own **guest pass**, and every read and every service call goes through an allowlist that the integration checks on the server.

Why: Home Assistant has no per-entity permissions for non-admin users. A non-admin token can read and control every entity and open the full HA UI ([discussion](https://github.com/orgs/home-assistant/discussions/1171)). Hiding tiles in a dashboard does not change that.

Two modes:

| | Owner mode | Guest pass |
|---|---|---|
| Sign-in | Home Assistant OAuth (unchanged) | Pairing code / QR |
| Token | HA access + refresh token | dash guest token |
| Access | **Everything** the HA user can do (unrestricted) | Only the entities and services in the pass's profile |
| Use for | You and your household | Guests, rental units, wall tablets |

## Threat model

| Attacker has | Can | Cannot |
|---|---|---|
| A guest token (from their own pass) | Read the states of the entities in their profile; call the allowed services with values inside the limits; read the filtered dashboard config, the Wi-Fi password (if `show_wifi`), the StandBy photos and the artwork of allowed media players, until the pass expires or is revoked | See or control any other entity; call any other service; target areas, devices, labels, lists or `all`; exceed limits; read registries, areas, users, HA config, history, logbook, templates, other profiles, the audit log; use HA's own APIs (the token is not an HA token) |
| A leaked QR / pairing code | Pair **once**, within 15 minutes of its creation, if nobody used it first | Pair after it was used or expired; learn whether a guessed code exists (generic errors); brute-force it (31¹² ≈ 2⁵⁹ codes, 5 failures per IP per minute with backoff, global cap) |
| A stolen tablet | Everything the tablet's pass allows, until the owner revokes the pass | Anything beyond the tablet's profile; get an HA token |
| The hosted dash server or a proxy in front of it | See the HA host in the URL path | See pairing codes (they are in the URL fragment, never sent), guest tokens (sent only to HA, inside the WebSocket) or states |
| Network access to HA, no pass | Call `/api/guest_ha_dashboard/pair` and `/api/guest_ha_dashboard/ws` | Anything without a valid code or token; rate limits apply per IP and globally |

**Deliberately not protected (residual risks)**

- A pass works until it expires or is revoked. A guest can copy their token to another device; the per-pass socket limit (3) caps this, it does not prevent it.
- Physical effects: an allowed light or cover is fully usable within its limits.
- The guest device must reach Home Assistant directly (public HTTPS URL or same network). dash does not hide where HA is.
- A compromised HA host, HA admin account or HA add-on bypasses everything.
- Shared Wi-Fi: anyone who knows the guest Wi-Fi password is on the same network as HA if the networks are not separated.
- Kiosk lockdown of a tablet (leaving the browser, opening other apps) is the device's job (Fully Kiosk, WallPanel, Guided Access). dash only hides its own sign-out and host switching on tablet passes.
- The audit log keeps client IP addresses of failed pairing and auth attempts (no states, no tokens).

## Architecture

```text
 Guest device (PWA)                       Home Assistant
┌────────────────────────┐               ┌───────────────────────────────────────────┐
│ dash  /<ha-host>#pair= │  POST code    │ /api/guest_ha_dashboard/pair  (no HA auth)│
│                        │ ────────────► │   rate limit → code hash → new token      │
│ token in localStorage  │ ◄──────────── │                                           │
│   dash_guest:<host>    │  token        │ /api/guest_ha_dashboard/ws    (no HA auth)│
│                        │  WebSocket    │   auth(token) → session → allowlist       │
│ GuestPassTransport     │ ◄───────────► │     filtered states / config / artwork    │
└────────────────────────┘               │     call_service → validator → hass.services
                                          │                                           │
 Owner (HA admin) ─ HA panel "Hosté" ──►  │ guest_ha_dashboard/pass|profile|audit/*   │
                    (HA websocket, admin) │   storage: .storage/guest_ha_dashboard.guests
                                          └───────────────────────────────────────────┘
```

The guest endpoints are ordinary `HomeAssistantView`s with `requires_auth = False` (`homeassistant/helpers/http.py`); they do their own authentication. The guest WebSocket is a separate `aiohttp` `WebSocketResponse`, not HA's `/api/websocket`.

## Data model

Stored in `.storage/guest_ha_dashboard.guests` (new key, version 1, `private=True` → file mode 0600). The existing dashboard config (`guest_ha_dashboard.config`) is unchanged, so no migration of existing data is needed. Only hashes of secrets are stored.

- **Profile** (`šablona pokoje`): `id` (uuid4 hex), `name`, `area_ids` (informational), `entities: {entity_id: {services: ["domain.service"], limits: {"domain.service": {field: {min,max} | {enum:[…]}}}, read_only: bool}}`, `show_wifi` (default true), `created_at`, `updated_at`.
- **Pass** (`přístup`): `id`, `profile_id`, `label`, `kind` (`phone` | `tablet`), `valid_from`, `valid_until` (required for phones, optional for tablets), `revoked_at`, `token_hash` (SHA-256 hex, null until paired), `created_at`, `paired_at`, `device_name` (short name sent by the app, e.g. "iPhone"), `last_seen` (written at most every 5 minutes), `max_sockets` (default 3).
- **Pairing code**: `code_hash`, `pass_id`, `expires_at` (15 minutes), `used_at`. One active code per pass; a new code invalidates the old one. Pairing replaces the pass's token, so re-pairing a pass logs out the previous device.
- **Audit log**: ring buffer of 200 entries `{ts, event, pass_id?, profile_id?, entity_id?, service?, reason?, ip?}`. Events: `pair_code_created`, `pair_ok`, `pair_failed`, `pass_created`, `pass_revoked`, `pass_extended`, `pass_deleted`, `pass_expired`, `auth_failed`, `call_denied`, `profile_saved`, `profile_deleted`. Never entity states, tokens or codes.

Times are ISO 8601 UTC strings. Status is derived, never stored: `revoked` (revoked_at set) → `expired` (now ≥ valid_until) → `pending` (now < valid_from) → `active`.

### Allowed domains (const.py, v1)

| Domain | Services (default) | Data fields |
|---|---|---|
| light | turn_on, turn_off, toggle | turn_on: brightness (0–255, checked against the brightness_pct limit after conversion; not together with brightness_pct), brightness_pct (0–100), color_temp_kelvin (1000–12000 and the light's own min/max), hs_color ([0–360, 0–100]), rgb_color ([0–255]×3), effect (must be in the light's effect_list), transition (0–60 and ≤ the profile's max_transition, default 5 s). One colour field per call. Colour, colour temperature and effects also need the profile capability and a light that supports them |
| switch, input_boolean | turn_on, turn_off, toggle | – |
| fan | turn_on, turn_off, set_percentage, oscillate, set_preset_mode | percentage (0–100, SET_SPEED), oscillating (bool, OSCILLATE), preset_mode (in the fan's preset_modes, PRESET_MODE) |
| cover | open_cover, close_cover, stop_cover, set_cover_position | position (0–100). **device_class door/garage/gate denied** |
| climate | set_temperature, set_hvac_mode, turn_on, turn_off | temperature (**limit required**, default 16–26 °C), hvac_mode (enum: off, heat, cool, heat_cool, auto, dry, fan_only) |
| media_player | media_play, media_pause, media_play_pause, media_stop, media_next_track, media_previous_track, media_seek, volume_set, volume_mute, volume_up, volume_down, turn_on, turn_off, select_source, join, unjoin, play_media | Each service needs its feature bit (below). volume_level (0–1, clamped to the profile's max_volume, default 0.7; volume_up refused at the maximum), is_volume_muted (bool), seek_position (0–86400), source (must be in source_list), group_members (≤ 10 players, all in the profile; needs media_group), play_media: media_content_type, media_content_id, enqueue (add/next/play/replace); needs media_browse and an id this pass got from browse/search in the last 10 minutes; URL-like ids are never played |
| scene | turn_on | no fields (scene.turn_on's `transition` is refused) |
| humidifier | turn_on, turn_off, set_humidity | humidity (0–100) |
| vacuum | start, pause, return_to_base | – |
| sensor, binary_sensor, weather, sun | read only | – |

Hard denied always, even if a profile in storage lists them: `lock`, `alarm_control_panel`, `camera`, `siren`, `script`, `automation`, `button`, `input_button`, `person`, `device_tracker`, `update`, `shell_command`, `command_line`, `homeassistant`, `persistent_notification`, every domain not in the table, every service not in the table.

## Service call validation

`guest_policy.validate_call(profile, entity_meta, domain, service, entity_id, data)` is a pure function. It returns `(ok, reason_code, clean_data)` and never raises. A call is allowed only if **all** hold:

1. `entity_id` is a single string matching `domain.object_id`; no `area_id`/`device_id`/`label_id`/`floor_id`, no `all`. Since 2.1 a **list** is accepted for `light` only (dash light groups): at most 20 ids, deduplicated, every one checked like a single call (profile, services, limits, the light's own support); one failure rejects the whole call, which then runs once with the list.
2. `domain` equals the entity's domain, is in the table and not hard denied; `domain.service` is in the global table and in the entity's profile services.
3. The entity is in the profile and not `read_only`; for covers, the live and registry device class is not door/garage/gate.
4. Only the top-level keys `domain, service, entity_id, data` are present; every key of `data` is in that service's field allowlist; every value has the right type (bools are not numbers, NaN/∞ rejected) and lies inside the global range **and** the profile limit.
5. `climate.set_temperature` always uses a limit: the profile's, or the default 16–26 °C.
6. Device-dependent rules use the entity's current state attributes (unknown = denied): the `supported_features` bit of the service (`GUEST_SERVICE_FEATURES`: fan SET_SPEED 1, OSCILLATE 2, PRESET_MODE 8; media PAUSE 1, SEEK 2, VOLUME_SET 4, VOLUME_MUTE 8, PREVIOUS_TRACK 16, NEXT_TRACK 32, TURN_ON 128, TURN_OFF 256, PLAY_MEDIA 512, VOLUME_STEP 1024, SELECT_SOURCE 2048, STOP 4096, PLAY 16384, GROUPING 524288; read from Home Assistant 2026.10.4), the light's colour modes, colour temperature range and effect list, the fan's preset modes, the player's source list.
7. Profile capabilities (`capabilities`, Guests tab, defaults in `GUEST_CAPABILITY_DEFAULTS`): `allow_color` (off), `allow_color_temp` (on, as before), `allow_effects` (off), `max_transition` (5 s), `media_browse` (off), `media_group` (off), `max_volume` (0.7). Stored profiles without the field get these defaults. The guest config carries them, so the app hides what the profile does not allow.

Reason codes: `bad_request`, `entity_not_allowed`, `entity_read_only`, `domain_denied`, `service_not_allowed`, `field_not_allowed`, `invalid_value`, `out_of_range`, `device_class_denied`, `capability_disabled`, `feature_unsupported`, `rate_limited`, `pass_inactive`. Denied calls are audited with the reason code only. The call runs as `hass.services.async_call(domain, service, {entity_id, **clean_data}, blocking=True, context=Context())` with a 10 s timeout.

## Pairing

1. Admin creates a pass in the panel → `guest_ha_dashboard/pass/create` returns the pass and a code.
2. Code: 12 characters from a **31-symbol** alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, shown as `XXXX-XXXX-XXXX`, case-insensitive, dashes and spaces ignored. *Refinement:* the spec asked for 32 symbols without 0/O/1/I/L; only 31 exist (23 letters + 8 digits). 31¹² ≈ 2⁵⁹.
3. QR content: `<dash_origin>/<ha_host>#pair=<CODE>`. The code is in the **fragment**, which browsers never send to a server, so the hosted dash server and its proxies never see it.
4. The app reads `#pair=`, removes it from the address bar (`history.replaceState`) and:
   - in an installed app (`display-mode: standalone` or `navigator.standalone`) pairs immediately;
   - in a browser tab shows install instructions (Share → Add to Home Screen) and a **Continue in browser** button. It does **not** consume the code, because an iOS Home Screen app has storage separate from Safari (Apple, WWDC23 "What's new in web apps"), so a token stored in the tab would not exist in the app.
5. The installed app without a token shows a code field. The manifest has `start_url: "/"`, and it is not documented whether iOS keeps the install-time path or fragment, so the app also asks for the Home Assistant address when the path has none.
6. `POST /api/guest_ha_dashboard/pair` `{code, device_name?}` → `{token, pass: {id, label, kind, valid_from, valid_until}, profile: {name}}`. The token is `secrets.token_urlsafe(32)`; only its SHA-256 is stored.

Errors are generic: `invalid_code` (wrong, expired, used, or pass revoked/expired — indistinguishable), `rate_limited` (with `retry_after`), `bad_request`.

### CORS

Verified in `homeassistant/helpers/http.py` and `homeassistant/components/http/cors.py`: a view with `cors_allowed = True` gets `Access-Control-Allow-Origin` for any origin (no credentials); with `cors_allowed = False` only the origins in `http: cors_allowed_origins` are allowed, and none if that list is empty.

The guest endpoints set `cors_allowed = True`. They use no cookies or HA credentials, so a cross-origin page gains nothing it could not do with `curl`; the code or token is the only credential. **No `cors_allowed_origins` configuration is needed** for guest passes (owner mode never needed it either). WebSockets are not subject to CORS, and the guest WebSocket authenticates by token in the first message, so cross-site WebSocket hijacking does not apply.

If a reverse proxy strips CORS headers or blocks `/api/guest_ha_dashboard/*`, the app shows "Home Assistant nepovolil spojení z tohoto webu" (a browser `TypeError` on `fetch` with the host otherwise reachable) instead of failing silently.

## Guest WebSocket protocol

`GET /api/guest_ha_dashboard/ws` (upgrade). Server limits: inbound message ≤ 16 KiB, ≤ 3 sockets per pass, 1 state subscription per socket, `call_service` token bucket (burst 20, 5/s), heartbeat 55 s, idle timeout 180 s without any client message (the client pings every 50 s).

```text
S: {"type":"auth_required"}
C: {"type":"auth","token":"…"}                              (within 10 s, else close)
S: {"type":"auth_ok","pass":{…},"profile":{"name":…},"server_time":"…"}
 | {"type":"auth_invalid","code":"invalid_auth|expired|revoked|not_yet_valid|rate_limited|too_many_connections"}  → close

C: {"id":1,"type":"get_config"}                  S: {"id":1,"type":"result","success":true,"result":{config}}
C: {"id":2,"type":"subscribe_states"}            S: result {"states":{entity_id: state}}  then  {"type":"state","entity_id":…,"state":{…}|null}
C: {"id":3,"type":"call_service","domain":…,"service":…,"entity_id":…,"data":{…}}   S: result {} | {"success":false,"error":{"code":…}}
C: {"id":4,"type":"media_image","entity_id":…}   S: result {"mime":…,"data":base64}
C: {"id":5,"type":"photo_list"} / {"type":"photo_get","photo_id":…,"thumb":bool}
C: {"id":6,"type":"ping"}                        S: {"id":6,"type":"pong"}
S: {"type":"config","config":{…}}                (pushed when the owner saves the dashboard)
```

Close codes: 4000 invalid auth, 4001 profile changed (client reconnects), 4002 expired, 4003 revoked/deleted, 4004 too many connections, 4008 idle, 1009 message too big.

Every message re-checks that the pass exists, is not revoked and is within its validity. A timer closes the socket at `valid_until`; revoke, delete and re-pair close all sockets of the pass immediately (registry `pass_id → sockets`). Saving a profile closes the sockets of its passes with 4001, so they reconnect with the new allowlist.

**Filtering**

- States: only profile entities. `entity_picture`, `entity_picture_local`, `access_token` and any string attribute containing `token=` are removed; the client asks for artwork with `media_image`.
- Config: tiles whose entity is not in the profile are removed, then empty pages and dock entries pointing to removed pages. Any other page or tile field whose value is an entity id outside the profile (e.g. legacy `temperatureEntity`) and `haAreaId` are dropped. `hosting` and `dashboardUrl` are dropped. Without `show_wifi` the Wi-Fi block is removed and `general.showWifi` is false. `general.weatherEntity` is kept only if it is in the profile.
- Never exposed: entity/device/area registries, users, HA config (including home coordinates; the Open-Meteo fallback is off in guest mode), other profiles, passes, audit log, history, logbook, templates.

*Refinements against the spec:* `media_image` is answered over the WebSocket (base64) instead of a separate HTTP view, so no token ever appears in an image URL. `photo_list`/`photo_get` are added so a guest tablet keeps the StandBy photo frame; the photos are the ones the owner uploaded for the dashboard.

**Header tiles and other tiles (config v3).**
- Header, clock, greeting, weather and Wi-Fi tiles have no entity. Like dividers they are never dropped for that, and a page still needs one usable tile.
- A weather source outside the profile is removed from the tile; the app then uses the first weather entity the guest may see, or shows "—".
- Without `show_wifi` the Wi-Fi tile is dropped and the header's Wi-Fi button is switched off.
- Scenes, sensors, binary sensors, fans and generic `entity` tiles are ordinary entity tiles: shown only when the entity is in the profile. Hard-denied domains can never be in a profile, so a generic tile can never show a lock or a camera.
- A dash light group shows only the lights that are in the profile, and is dropped when none is (the stricter of the two options).
- Media `outputs` outside the profile are removed.

**Browse and search (stage 3).** The guest socket has the message kinds `browse_media` `{entity_id, media_content_type?, media_content_id?}` and `search_media` `{entity_id, search_query}`. Every request is checked:
- The player must be in the profile, the profile must have `media_browse`, and the player must report BROWSE_MEDIA (131072) or SEARCH_MEDIA (4194304).
- Requests use the same token bucket as service calls. A search query is at most 100 characters.
- Browsing below the root needs an id this pass was given before. The server keeps a small store of issued ids per pass: up to 500, each valid for 10 minutes.
- The result is reduced to title, media class, content type and id, can_play, can_expand and children class. It has at most 100 children, no thumbnails (they are Home Assistant URLs, often with a token), nothing token-like, and no items with URL-like ids (http, https, ftp, file, data, rtsp, rtmp, ws, wss, `/…`).
- `play_media` accepts only issued ids.
Calls are made with the player entity's own `async_browse_media` and `async_internal_search_media`, the same methods Home Assistant's `media_player/browse_media` and `media_player/search_media` websocket commands use (2026.10.4).

**Section dividers (2.1).** A divider tile (`type: "divider"`) has no entity, so it is not part of a profile and never an allowed or denied entity. `filter_config` keeps dividers on the pages it sends, but a page is sent only if it still contains at least one tile the guest may use. Without that rule, a page that consists only of dividers after filtering would reveal its name, icon and section names to guests of other rooms. A divider id (`divider-…`) is not an entity id, so a `call_service` aimed at it fails validation like any other id outside the profile.

**Photos (2.1).** The guest socket already sent the photo id as `photo_id`. The owner API used `id`, which collides with the websocket message id; it now uses `photo_id` too (see [DIAGNOSTICS.md](DIAGNOSTICS.md)). Nothing about what guests receive changed.

## Rate limits

| What | Limit |
|---|---|
| Failed pairing / failed WS auth, per client IP | 5 per minute; then locked for 60 s × 2ⁿ (n = consecutive lockouts, max 1 h) |
| Failed pairing / auth, all IPs | 50 per minute; then every attempt is rejected for 60 s |
| `call_service` per socket | burst 20, refill 5 per second |
| Sockets per pass | 3 |

Client IP is `request.remote`, which HA rewrites from `X-Forwarded-For` only when `http: use_x_forwarded_for` and `trusted_proxies` are set. Without them, every guest behind the proxy shares the proxy's IP and therefore its limit.

## Expiry and revocation

- `valid_from`: pairing is allowed before it, the WebSocket answers `not_yet_valid`.
- `valid_until`: the socket is closed at that time (4002); the app shows "Přístup skončil. Požádejte ubytovatele o nový kód." and deletes the token.
- Revoke / delete: immediate (4003), same message.
- Extend: changes `valid_until`; running sockets reschedule their timer.
- New code: invalidates the previous unused code; pairing with it replaces the pass token and closes the sockets of the previous device (4003).

## Implementation map

| Part | File |
|---|---|
| Tables, limits, timeouts | `custom_components/guest_ha_dashboard/const.py` |
| Codes, tokens, hashing | `guest_codes.py` |
| Validation, filtering, profiles (pure) | `guest_policy.py` |
| Profiles, passes, codes, audit (pure) | `guest_model.py` |
| Rate limits (pure) | `guest_ratelimit.py` |
| Storage (`private=True`) | `guest_store.py` |
| Live sockets, close on revoke/expiry | `guest_runtime.py` |
| Pairing endpoint | `guest_http.py` |
| Guest websocket | `guest_ws.py` |
| Admin commands | `guest_admin.py` |
| Panel tab, QR, print card | `www/guests.js`, `www/vendor/qrcode-generator/` |
| App transport, pairing, mock | `src/lib/guestPass.js`, `src/lib/guestTransport.js`, `src/lib/mockGuest.js`, `src/composables/useHomeAssistant.js` |
| Tests | `tests/pure/` (no Home Assistant needed), `tests/ha/` (pytest-homeassistant-custom-component) |

## Open questions

1. iOS: does the Home Screen app keep `/<ha-host>` from install time with `start_url: "/"`? The fallback asks for the host either way; consider removing `start_url` (spec default = document URL) after a device test.
2. Should profiles get an optional "lock with confirmation" in v2?
3. Should a phone pass allow more than one device (family) by default? v1: one pairing, max 3 sockets.
