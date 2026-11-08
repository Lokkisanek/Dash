# Spotify v dash (volitelné)

Spotify je v dash **vypnutý**. Zapíná ho majitel v panelu (Hudba → Spotify) a připojuje **vlastní** účet přes **vlastní** aplikaci Spotify. dash nemá sdílené Client ID a mít ho nebude.

## Požadavky

- **Spotify Premium.** Web Playback SDK i ovládání Connect fungují jen s Premium. Od února 2026 musí Premium mít i vlastník aplikace (Development Mode).
- **Vlastní aplikace** na [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) se zaškrtnutým „Web API“ a „Web Playback SDK“.
  - Nová aplikace v Development Mode má nejvýš **5 uživatelů**; přidáš je v User Management.
  - Limit Client ID na vývojáře je od července 2026 25.
- **Redirect URI přes https.** Spotify přijímá jen https, nebo adresu `http://127.0.0.1` / `http://[::1]`. `localhost` nebere a obyčejnou http adresu Home Assistantu taky ne.
  - Panel proto ukazuje adresu stránky `spotify-callback.html` na doméně dashboardu: hostovaný `https://dash.matyas.online/spotify-callback.html`, nebo tvoje vlastní https nasazení.

## Podmínky Spotify

Stránka Web Playback SDK říká: *„This SDK must not be used in commercial projects without Spotify's prior written approval.“*

- dash používá Spotify jen jako volitelnou funkci pro domácnost majitele.
- **Hotely, pronájmy a firmy musí mít Spotify vypnutý.** Komerční licence dash nedává žádná práva ke službám Spotify (viz [COMMERCIAL.md](../COMMERCIAL.md)).

## Připojení (průvodce v panelu)

1. Vytvoř aplikaci (Web API + Web Playback SDK).
2. Zadej Redirect URI, kterou ukazuje panel (tlačítko Zkopírovat).
3. V User Management přidej e-mail svého účtu.
4. Vlož Client ID a dej Uložit.
5. „Připojit Spotify“: otevře se okno Spotify. Po potvrzení se okno vrátí a panel ukáže „Připojeno jako …“.
   - Když se okno nevrátí (prohlížeč spojení přeruší), stránka ukáže kód. Vlož ho do pole „Vložit kód“.

Co se děje uvnitř: Authorization Code s PKCE, bez client secret.

- `state` a PKCE verifier vytváří a drží integrace. `state` platí 10 minut a jen jednou.
- Tokeny jsou jen v úložišti integrace (`guest_ha_dashboard.vault`). Nikdy nejsou v logu, v konfiguraci, v událostech HA ani v auditu hostů.
- Prohlížeč refresh token nikdy nedostane. „Odpojit“ tokeny smaže.

Podrobnosti a zdroje: [PLAYER_ENGINES.md](PLAYER_ENGINES.md).

## Co funguje

- **Dlaždice „Přehrávač dash“ se zdrojem Spotify**: co hraje, play/pauza, další/předchozí, posun, hlasitost.
- **Zdroje**: seznam zařízení Spotify Connect a přepnutí přehrávání („Přehrát zde“).
- **Procházet**: tvoje playlisty a uložené skladby. **Hledat**: nejvýš 10 výsledků (limit Spotify).
- **„Spustit přehrávání zde“** (jen tvoje zařízení, přepínač „Přehrávat i v prohlížeči“): načte Web Playback SDK z `sdk.scdn.co`.
  - Bez tohoto přepínače prohlížeč s dashboardem nekontaktuje Spotify vůbec.
  - Na iPhonu přehrávání po přepnutí samo nezačne; tlačítko je to klepnutí, které iOS vyžaduje.

## Hosté

Hosté nikdy nedostanou token. Ovládají Spotify jen přes integraci a jen s oprávněními profilu (výchozí stav: vypnuto):

- `spotify_control`: co hraje, play/pauza, další/předchozí, posun, hlasitost do limitu profilu;
- `spotify_search`: hledání, a pustit lze jen to, co host právě našel (10 minut).

Přenos na jiné zařízení a Web Playback SDK jsou jen pro majitele.

## Neověřeno

Bez účtu Premium a skutečného iPhonu nebylo vyzkoušeno:

- celé připojení;
- přehrávání v SDK;
- ovládání Connect;
- jestli `window.opener` přežije přesměrování přes accounts.spotify.com.

Seznam: [PLAYER_ENGINES.md](PLAYER_ENGINES.md#unverified-not-presented-as-working-until-tested).

## English summary

Spotify is off by default.

- Each owner needs Premium and their own Spotify app (Development Mode: 5 users), with an https redirect URI on the dash origin.
- Sign-in uses PKCE. Tokens never leave the integration's vault, except a short-lived access token for the owner's own Web Playback SDK.
- Guests control playback only through the integration with `spotify_control` / `spotify_search` (off by default).
- Spotify's SDK terms forbid commercial use without their approval, so hotel and business deployments must keep it off. The commercial license grants no Spotify rights.
