# Player engines (design gate C0)

dash plays music through one of three engines behind one interface (`src/lib/player/`). Any media style (nowplaying, vinyl, card, mini, cover, button) can show any engine.

| Engine | Where the sound comes from | Account | Default |
|---|---|---|---|
| `HaEngine` | a Home Assistant `media_player` (speaker, TV, Music Assistant…) | none in dash | on |
| `BrowserEngine` | this browser (`HTMLAudioElement`): owner's radio stations, files from HA's media folder, a direct https URL | none | on for the owner; guests only with `allow_local_player` |
| `SpotifyEngine` | Spotify Connect devices, and optionally this browser via the Web Playback SDK | the owner's Spotify Premium + the owner's own Spotify app | **off** (`spotify.enabled`) |

Every fact below was read on 2026-11-08 in the official documentation linked next to it. Anything not confirmed there is listed under **UNVERIFIED**.

## Spotify: verified

**Authorization: Authorization Code with PKCE** ([PKCE tutorial](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow))
- Authorize: `GET https://accounts.spotify.com/authorize` with `client_id`, `response_type=code`, `redirect_uri`, `code_challenge_method=S256`, `code_challenge`, `state` ("strongly recommended") and `scope`.
- Code verifier: 43–128 characters from letters, digits, `_ . - ~`, cryptographically random. Challenge = base64url(SHA-256(verifier)) without padding.
- Token: `POST https://accounts.spotify.com/api/token`, `application/x-www-form-urlencoded`, `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`. **No client secret.** Response: `access_token`, `token_type`, `scope`, `expires_in`, `refresh_token`.

**Refresh** ([Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens))
- `grant_type=refresh_token`, `refresh_token`, `client_id`; no `Authorization` header for PKCE.
- A response "might not include a new refresh token": keep the old one then.

**Redirect URIs** ([Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri))
- HTTPS required, except a loopback IP literal (`http://127.0.0.1:PORT`, `http://[::1]:PORT`); `localhost` is not allowed.
- The URI must exactly match the registered one, except that loopback literals may use a dynamic port. Enforced for new apps since 9 April 2025, for all apps from November 2025.
- Consequence: a Home Assistant reached over plain `http://homeassistant.local:8123` can **not** be the redirect target.

**Web Playback SDK** ([overview](https://developer.spotify.com/documentation/web-playback-sdk), [getting started](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started))
- Requires Spotify Premium. Supported by Chrome, Firefox, Safari and Edge on desktop and mobile.
- Script `https://sdk.scdn.co/spotify-player.js`, global callback `onSpotifyWebPlaybackSDKReady`, `new Spotify.Player({ name, getOAuthToken, volume })`, event `ready` with `device_id`.
- "The playback does not start automatically after transfering playback" on iOS: the user has to interact. Cross-origin iframes must allow `encrypted-media` and `autoplay`.
- Terms on the same page: **"This SDK must not be used in commercial projects without Spotify's prior written approval."**

**Development Mode (February 2026)** ([migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide))
- The app owner needs Premium. New apps: 5 users. Client IDs per developer: 1, raised to 25 in July 2026.
- Search `limit`: max 10, default 5.
- Removed: browse new releases and categories, artist top tracks, batch `GET /tracks|/albums|/artists|…`, other users' profiles and playlists, the old per-type library save/follow endpoints. `/playlists/{id}/tracks` became `/items`, which only works for playlists the user owns or collaborates on.
- `GET /me` no longer returns `country`, `email`, `explicit_content`, `followers`, `product`.

**Connect endpoints used** (reference pages; Premium only; `204` on success)
| Action | Request | Scope |
|---|---|---|
| devices | `GET /v1/me/player/devices` → `devices[]{id, is_active, is_restricted, name, type, volume_percent, supports_volume}` | `user-read-playback-state` |
| state | `GET /v1/me/player` → `device`, `is_playing`, `progress_ms`, `item{name, artists, album.images, duration_ms}` | `user-read-playback-state` |
| transfer | `PUT /v1/me/player` body `{device_ids: [one id], play}` | `user-modify-playback-state` |
| play | `PUT /v1/me/player/play?device_id` body `{context_uri | uris, offset, position_ms}` | `user-modify-playback-state` |
| pause | `PUT /v1/me/player/pause?device_id` | `user-modify-playback-state` |
| next / previous | `POST /v1/me/player/next`, `POST /v1/me/player/previous` | `user-modify-playback-state` |
| seek | `PUT /v1/me/player/seek?position_ms` | `user-modify-playback-state` |
| volume | `PUT /v1/me/player/volume?volume_percent=0..100` | `user-modify-playback-state` |

**Scopes requested (minimum):** `streaming` (the only scope the scopes page ties to the Web Playback SDK), `user-read-playback-state`, `user-modify-playback-state`, `user-read-private` (search), `playlist-read-private` (own playlists), `user-library-read` (saved tracks). Not requested: `user-read-email`.

## Redirect design that works with an http Home Assistant

1. The owner creates their own Spotify app and registers **`https://<dash app origin>/spotify-callback.html`** (the hosted `https://dash.matyas.online/spotify-callback.html`, or their own https deployment). The panel shows this URI with a copy button.
2. "Připojit Spotify" in the panel asks the integration for an authorize URL. The integration creates `state` (random, single use, 10 min) and the PKCE verifier, and keeps both **server-side**.
3. The popup returns to the static callback page on the dash origin. It never talks to Spotify itself; it hands `code` + `state` back to the panel with `window.opener.postMessage` (target origin = the opener's origin, the HA panel). If the opener is gone, the page shows the code with a copy button and the wizard has an inline "Vložit kód" field.
4. The panel sends `code` + `state` to the integration (`guest_ha_dashboard/spotify/callback`). The integration checks `state` and exchanges the code with the verifier. No client secret exists, and a leaked code is useless without the verifier, which never leaves Home Assistant.
5. Tokens live only in the integration's Store (`guest_ha_dashboard.vault`). They are never logged and never put in the config, events or the audit log. The browser never receives the refresh token. The owner's own browser asks `spotify/token` for the current access token when it runs the Web Playback SDK.

## Content-Security-Policy

`nginx.conf` already allows `media-src 'self' blob: https: http:` (radio streams, HA media) and `connect-src https: wss:`, which covers `api.spotify.com`. Added: `https://sdk.scdn.co` to `script-src` and to a new `frame-src` (the SDK's player iframe). A CSP entry only permits a host; nothing is loaded until the owner turns Spotify on. The HA panel serves no CSP of its own.

## Radio directory (optional, `radio.directory`, off)

[radio-browser API](https://api.radio-browser.info/), [docs](https://docs.radio-browser.info/): server list via DNS `all.api.radio-browser.info`, "send a descriptive HTTP agent string", search `GET /json/stations/search` (`name`, `limit`, `hidebroken`, `order`, `is_https`), fields `stationuuid, name, url_resolved, favicon, codec, bitrate, lastcheckok`. The integration proxies the search (User-Agent `dash-ha/<version>`, `is_https=true`, `hidebroken=true`, `limit` ≤ 20, 10 min cache). The browser never calls it, and favicons are not shown (a third-party host).

## HA media library (verified in the installed homeassistant 2026.10.4, `components/media_source/http.py`)

- `media_source/browse_media {media_content_id}` → BrowseMedia dict.
- `media_source/resolve_media {media_content_id, expires}` → `{url, mime_type}`, where `url` is processed by `async_process_play_media_url` (a signed, relative path).
- Guests: the integration calls `media_source.async_browse_media` / `async_resolve_media` itself. This needs `allow_local_player` and `media_browse`. Only ids this pass received from its own browse results in the last 10 minutes can be resolved. The signed path expires after 5 minutes.

## UNVERIFIED (not presented as working until tested)

- Whether `window.opener` survives the round trip through `accounts.spotify.com` (COOP may cut it). The manual "Vložit kód" path exists for that case.
- Whether the Web Playback SDK needs `user-read-email` / `user-read-private` in practice (older Spotify examples requested them; the current scopes page lists only `streaming`).
- The origin of the SDK's iframe (assumed `https://sdk.scdn.co`).
- Whether a `204` from `GET /me/player` means "nothing playing" (the reference lists 204 without saying when).
- iOS Safari: programmatic `audio.volume` is ignored, so dash detects it (set, read back) and hides the slider instead of assuming. Autoplay needs a tap: the "Klepnutím povolíš zvuk" button.
- Media Session API metadata and actions: set only when `navigator.mediaSession` exists; lock-screen behaviour on iOS is untested.
- Everything that needs a Spotify Premium account, a real Spotify app and a real iPhone: the full connect flow, playback in the SDK, Connect control.
