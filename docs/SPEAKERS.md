# Jak připojit reproduktor

dash přehrává hudbu jen přes Home Assistant. Každá entita domény `media_player` funguje jako dlaždice hudby a jako přehrávač v listu „Teď hraje“. Co dlaždice nabídne (přehrát a pozastavit, hlasitost, výběr výstupu, procházení, hledání, seskupení), určuje přehrávač sám přes `supported_features`.

dash **neumí**:

- přehrávat zvuk v prohlížeči nebo na tabletu, na kterém běží (Home Assistant pro to nemá entitu),
- přihlašovat se ke streamovacím službám. To dělá integrace přehrávače nebo Music Assistant.

Zdroje v tomto návodu: dokumentace na home-assistant.io (integrace Music Assistant, MPD, Snapcast a Bluetooth) a music-assistant.io (podporované přehrávače), staženo 7. 11. 2026. Co v nich není, je označené **neověřeno**.

## Music Assistant (doporučeno)

Music Assistant je hudební server. Integrace Music Assistant v Home Assistantu se k němu připojí.

- **Instalace:** na Home Assistant OS umí nastavení integrace samo nainstalovat a spustit oficiální aplikaci Music Assistant. U ostatních instalací musí server Music Assistant už běžet, třeba v samostatném Docker kontejneru. Postup najdeš v dokumentaci Music Assistant.
- **Verze:** integrace potřebuje server Music Assistant 2.4 nebo novější.
- **Připojení:** běžící server Home Assistant obvykle sám najde a nabídne ho jako „Objeveno“. Jinak zadej adresu serveru ručně.
- **Přehrávače:** všechny přehrávače a skupiny Music Assistant se v Home Assistantu objeví jako entity `media_player`, takže je dash hned vidí. Přehrávače z Home Assistantu přidané do Music Assistant se objeví dvakrát.
- **Podporované přehrávače** (podle music-assistant.io): AirPlay, Alexa, AmpliPi, Bluesound, Bose SoundTouch, DLNA, Fully Kiosk, Google Cast, HEOS, přehrávače Home Assistantu, MSX Bridge, MPD, MusicCast, Roku Media Assistant, Samsung WAM, Sendspin, Snapcast, Sonos, Squeezelite, WiiM a Yandex Station. Položka „Local Audio Out“ je vedená jako vyřazená.

**Fronta:** integrace má akci `music_assistant.get_queue` (podrobnosti o aktivní frontě přehrávače). dash ji zatím nepoužívá, a proto nemá záložku Fronta:

- tvar odpovědi jsem neověřil v nainstalovaném kódu,
- pro hosty by fronta potřebovala vlastní pravidla.

Standardní Home Assistant frontu přehrávače nenabízí.

## MPD (Music Player Daemon)

- Integrace MPD ovládá běžící server MPD nebo server s ním kompatibilní (Mopidy s Mopidy-MPD).
- Přidáš ji v *Nastavení → Zařízení a služby → Přidat integraci → Music Player Daemon (MPD)*.
- Server MPD musí běžet zvlášť. Dokumentace integrace o tom, jak ho nainstalovat nebo jak ho nasměrovat na USB či Bluetooth zvukovku, nepíše: **neověřeno**, hledej v dokumentaci MPD.
- Integrace umí spustit uložený playlist a nastavit hlasitost. Procházení knihovny dokumentace nezmiňuje, takže v dash nečekej záložku Procházet. Obal alba a hlasitost závisí na serveru.

## Snapcast (multiroom)

- Integrace Snapcast přidá entity `media_player` s ovládáním přehrávání.
- Přehrát, pozastavit a skladby dopředu a dozadu fungují jen se streamem s podporovaným pluginem (například `meta_mopidy.py` nebo `meta_mpd.py`).
- Ostatní streamy mají hlasitost, výběr zdroje a seskupení.
- Přidáš ji přes *Přidat integraci → Snapcast*.

## Bluetooth reproduktory

Home Assistant nemá vestavěný `media_player` pro Bluetooth reproduktor. Integrace Bluetooth podle své dokumentace podporuje jen Bluetooth Low Energy a klasický Bluetooth výslovně ne. Zvuk přes A2DP tedy nepřenáší.

Bluetooth reproduktor proto potřebuje zařízení nebo server, které se k němu spojí a samo se v Home Assistantu ukáže jako přehrávač. Například:

- přehrávač, který má Bluetooth výstup a vlastní integraci (Google Cast, AirPlay, Sonos a podobně; Bluetooth výstup daného zařízení je **neověřeno** a záleží na výrobci),
- počítač s MPD, Snapcast klientem nebo Squeezelite, jehož zvukový výstup je spárovaný reproduktor. Spárování v operačním systému je mimo Home Assistant a dash: **neověřeno**, podle dokumentace systému.

## Řešení potíží

| Co vidíš | Proč | Co s tím |
|---|---|---|
| V panelu není žádný přehrávač | Home Assistant nemá entitu `media_player` | Nainstaluj integraci přehrávače nebo Music Assistant (výše) |
| V listu chybí záložka Procházet | Přehrávač nemá funkci `BROWSE_MEDIA` | Použij přehrávač z Music Assistant, nebo jiný s procházením |
| Chybí záložka Hledat | Přehrávač nemá funkci `SEARCH_MEDIA` | Stejně jako výše |
| Chybí posuvník hlasitosti | Přehrávač nemá funkci `VOLUME_SET` | Hlasitost řídí zařízení samo |
| Chybí záložka Přehrávače | Dlaždice nabízí jen jeden přehrávač | V panelu u dlaždice vyber další výstupy (Přehrávače), nebo jich mít víc v Home Assistantu |
| Host nevidí Procházet ani Hledat | Šablona hosta nemá „Procházet a pouštět hudbu“ | Zapni to v záložce Hosté u šablony |
| Host nemůže seskupit reproduktory | Šablona hosta nemá „Seskupovat reproduktory“, nebo druhý reproduktor není v šabloně | Zapni volbu a přidej přehrávač do šablony |
| Host nedá hlasitost výš | Šablona omezuje nejvyšší hlasitost (výchozí 70 %) | Změň „Nejvyšší hlasitost“ v záložce Hosté |
| Obaly alb u hosta v Procházet chybí | Náhledy jsou odkazy do Home Assistantu, často s tokenem | Záměr. Host vidí ikony, obal právě hrající skladby ano |

## English summary

- dash plays music only through Home Assistant `media_player` entities. It never plays audio in the browser and never logs in to streaming services.
- **Music Assistant:**
  - On Home Assistant OS the integration can install the Music Assistant app; elsewhere run the server first (version 2.4 or later).
  - All its players and groups become `media_player` entities.
  - It has a `music_assistant.get_queue` action, which dash does not use yet, so there is no queue tab.
- **MPD:** controls a separately running MPD or Mopidy server. Its documentation does not mention browsing.
- **Snapcast:** adds `media_player` entities with volume, source and grouping. Transport controls need a supported stream plugin.
- **Bluetooth:** Home Assistant's Bluetooth integration supports BLE only, not classic Bluetooth audio, so there is no built-in Bluetooth speaker player. Use a device or a server (MPD, Snapcast client, Squeezelite) that outputs to the speaker and appears as a `media_player`. The pairing steps are outside Home Assistant and are unverified here.
