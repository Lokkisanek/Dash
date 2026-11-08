/**
 * dash — config panel
 * Full-screen layout + live dashboard preview (iPhone 15 Pro frame).
 *
 * The preview iframe is created once and never re-mounted; the dashboard
 * picks up saved config through its own HA subscription.
 */
import { ICONS } from "./icons.js?v=2.1.1";
import { GuestsTab } from "./guests.js?v=2.1.1";
import { TILE_TYPES } from "./tiles.js?v=2.1.1";
import { packTiles, indexForCell } from "./layout.js?v=2.1.1";
import { DEVICE_PRESETS, DEFAULT_DEVICE } from "./devices.js?v=2.1.1";

const PANEL_VERSION = "2.1.1";
const UI_THEME_KEY = "guest_ha_panel_ui_theme";
const UI_LANG_KEY = "guest_ha_panel_ui_lang"; // auto | cs | en — default auto = HA language
const ORIENT_KEY = "guest_ha_panel_preview_orient"; // before 2.1: orientation only
const DEVICE_KEY = "guest_ha_panel_preview_device"; // { id, orient, scale, custom }
const CUSTOM_MIN = 200;
const CUSTOM_MAX = 4000;
const PREVIEW_KEY = "guest_ha_panel_preview"; // on | off
const DOCK_MAX = 6;
/** base64 characters per photo upload (photo + thumbnail); HA's limit is 4 MiB per message. */
const PHOTO_UPLOAD_BUDGET = 3_500_000;
/** Free hosted dash: https://dash.matyas.online/<ha-host> */
const HOSTED_BASE = "https://dash.matyas.online";

/**
 * Control-Center-like grid (4 square columns). First entry = default.
 * Generated from shared/tiles.json (www/tiles.js), same as the guest PWA.
 */
const TILE_STYLES = Object.fromEntries(Object.entries(TILE_TYPES).map(([type, t]) => [type, t.styles]));

/**
 * Every (style, size) a device type can take, for the resize handle: dragging
 * the corner picks the closest size and switches style when needed.
 */
function tileVariants(type) {
  const styles = TILE_STYLES[type] || TILE_STYLES.switch;
  return Object.entries(styles).flatMap(([style, sizes]) =>
    sizes.map((size) => {
      const [cols, rows] = size.split("x").map(Number);
      return { style, size, cols, rows };
    }));
}

const DEFAULT_STANDBY = {
  enabled: false,
  idleMinutes: 2,
  mode: "clock",
  clockStyle: "bold",
  photoSeconds: 8,
};
const DEVICE_TYPES = Object.keys(TILE_STYLES);
/** Types offered in the entity tile's type select (dividers are added separately). */
const ENTITY_TYPES = DEVICE_TYPES.filter((t) => TILE_TYPES[t].needsEntity);
const DIVIDER_LABEL_MAX = TILE_TYPES.divider?.fields?.label?.max || 60;
const DEFAULT_DEVICE_ICON = Object.fromEntries(Object.entries(TILE_TYPES).map(([type, t]) => [type, t.icon]));

function resolveTile(device) {
  const styles = TILE_STYLES[device?.type] || TILE_STYLES.switch;
  const style = styles[device?.style] ? device.style : Object.keys(styles)[0];
  const sizes = styles[style];
  const size = sizes.includes(device?.size) ? device.size : sizes[0];
  const [cols, rows] = size.split("x").map(Number);
  return { style, size, cols, rows };
}

/**
 * Full icon catalog (~340 icons with categories and cs/en keywords). Loaded on
 * demand: when the picker opens, or when the config uses an icon outside the
 * base set in icons.js, so the panel starts as fast as before.
 */
const ICON_CATALOG_URL = "./icon-catalog.js?v=2.1.1";
const RECENT_ICONS_KEY = "guest_ha_panel_recent_icons";
let ICON_CATALOG = null;
let iconCatalogLoading = null;
function loadIconCatalog() {
  iconCatalogLoading ||= import(ICON_CATALOG_URL)
    .then((mod) => {
      const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const catLabel = Object.fromEntries(mod.CATEGORIES.map((c) => [c.id, `${c.cs} ${c.en}`]));
      ICON_CATALOG = {
        ...mod,
        fold,
        hay: new Map(mod.ICON_LIST.map((i) => [i.n, fold([
          i.n, i.n.replace(/([a-z])([A-Z0-9])/g, "$1 $2"), ...i.cs, ...i.en, catLabel[i.c],
        ].join(" "))])),
      };
      return ICON_CATALOG;
    })
    .catch((err) => {
      iconCatalogLoading = null;
      throw err;
    });
  return iconCatalogLoading;
}
function knownIcon(name) {
  return Boolean(ICONS[name] || ICON_CATALOG?.SVG[name]);
}
function readRecentIcons() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_ICONS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((n) => typeof n === "string").slice(0, 12) : [];
  } catch {
    return [];
  }
}
function pushRecentIcon(name) {
  try {
    const list = [name, ...readRecentIcons().filter((n) => n !== name)].slice(0, 12);
    localStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(list));
  } catch { /* storage blocked: recent icons are a convenience only */ }
}

/** Inline lucide SVG (same set the PWA renders). */
/**
 * A small record for the vinyl style (flat circles, like the app's), turning
 * continuously in the editor so the style can be seen without music.
 * Reduced motion: it stands still.
 */
function vinylSvg(cls = "") {
  const grooves = [17, 22, 27, 32, 37, 42].map((r, i) =>
    `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#9a9a9a" stroke-width="${i % 2 ? 0.8 : 1.4}" stroke-opacity="${i % 2 ? 0.25 : 0.45}"/>`).join("");
  return `<svg class="vinyl-mini ${cls}" viewBox="0 0 100 100" aria-hidden="true" data-vinyl-preview>
    <circle cx="50" cy="50" r="49" fill="#141414" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.2"/>${grooves}
    <circle cx="50" cy="50" r="13" fill="var(--accent)"/><circle cx="50" cy="50" r="2" fill="var(--card)"/></svg>`;
}

function iconSvg(name, size = 20) {
  const inner = ICONS[name] || ICON_CATALOG?.SVG[name] || ICONS.Sparkles || "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/**
 * Frame drawing per preset class (www/devices.js): bezel and screen corner
 * radius in CSS px. Phones: rounded, Dynamic Island / notch / punch hole where
 * the device has one; tablets: a thin bezel; wall displays: a square bezel.
 */
const FRAME_METRICS = {
  island: { bezel: 10, radius: 55 },
  notch: { bezel: 10, radius: 44 },
  home: { bezel: 10, radius: 30 },
  punch: { bezel: 9, radius: 40 },
  tablet: { bezel: 14, radius: 20 },
  wall: { bezel: 16, radius: 4 },
  custom: { bezel: 8, radius: 10 },
};

/** Remembered preview device, read defensively (private mode, bad JSON). */
function loadDeviceState() {
  const base = { id: DEFAULT_DEVICE, orient: "portrait", scale: "fit", custom: { w: 700, h: 500, safe: { t: 0, r: 0, b: 0, l: 0 } } };
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_KEY) || "null");
    if (raw && typeof raw === "object") {
      const known = raw.id === "custom" || DEVICE_PRESETS.some((d) => d.id === raw.id);
      const n = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
      const cs = raw.custom?.safe || {};
      return {
        id: known ? raw.id : base.id,
        orient: raw.orient === "landscape" ? "landscape" : "portrait",
        scale: raw.scale === "100" ? "100" : "fit",
        custom: {
          w: n(raw.custom?.w, CUSTOM_MIN, CUSTOM_MAX, base.custom.w),
          h: n(raw.custom?.h, CUSTOM_MIN, CUSTOM_MAX, base.custom.h),
          safe: { t: n(cs.t, 0, 400, 0), r: n(cs.r, 0, 400, 0), b: n(cs.b, 0, 400, 0), l: n(cs.l, 0, 400, 0) },
        },
      };
    }
    if (localStorage.getItem(ORIENT_KEY) === "landscape") base.orient = "landscape";
  } catch {
    /* storage blocked: defaults */
  }
  return base;
}

/** Since config version 3 the header, clock, greeting, weather and Wi-Fi button are tiles. */
const DEFAULT_GENERAL = {
  use24h: true,
  statusBarStrip: false,
  layoutMode: "auto",
  dockPosition: "auto",
};
const GENERAL_ENUMS = {
  layoutMode: ["auto", "single"],
  dockPosition: ["auto", "bottom", "right", "left"],
};

const PANEL_I18N = {
  cs: {
    title: "Config",
    save: "Uložit",
    saving: "Ukládám…",
    saved: "Uloženo",
    tabGeneral: "Obecné",
    tabPages: "Pages",
    tabDock: "Dock",
    tabGuests: "Hosté",
    tabGuest: "Wi-Fi",
    tabStyles: "Styly",
    previewTitle: "Live preview",
    previewMeta: (label, w, h) => `${label} · ${w} × ${h} px`,
    previewApprox: "safe area přibližně",
    previewTypical: "typické rozměry",
    previewViewport: "viewport prohlížeče",
    previewDevice: "Zařízení",
    devGroup_phone: "Telefony",
    devGroup_tablet: "Tablety",
    devGroup_wall: "Nástěnné displeje",
    devGroup_custom: "Vlastní",
    devCustom: "Vlastní velikost",
    previewScale: "Měřítko",
    scaleFit: "Přizpůsobit",
    scale100: "100 %",
    customW: "Šířka",
    customH: "Výška",
    swapWH: "Prohodit",
    customSafe: "Safe area (px)",
    safeT: "Nahoře",
    safeR: "Vpravo",
    safeB: "Dole",
    safeL: "Vlevo",
    customInvalid: `Šířka a výška musí být ${CUSTOM_MIN}–${CUSTOM_MAX} px.`,
    previewEmpty: "Nastav v záložce Obecné, kde dashboard běží, a ulož.",
    rotateLandscape: "Na šířku",
    rotatePortrait: "Na výšku",
    dashboardUrl: "URL tvého web dashboardu",
    headerTilesHint: "Hlavičku, hodiny, pozdrav a počasí přidáš jako dlaždice na stránce.",
    clockSection: "Hodiny",
    weatherAuto: "Auto — první entita počasí, jinak poloha domova v HA",
    genUse24h: "24hodinový formát",
    addMenuLabel: "Přidat dlaždici",
    group_devices: "Zařízení",
    group_info: "Informace",
    group_header: "Hlavička",
    group_layout: "Rozvržení",
    type_header: "Hlavička",
    type_clock: "Hodiny",
    type_greeting: "Pozdrav",
    type_weather: "Počasí",
    type_wifi: "Wi-Fi",
    style_card: "Karta",
    style_plain: "Bez pozadí",
    style_lockscreen: "Zamčená obrazovka",
    style_compact: "Jeden řádek",
    style_glass: "Sklo",
    opt_showTime: "Čas",
    opt_showDate: "Datum",
    opt_showGreeting: "Pozdrav",
    opt_showWeather: "Počasí",
    opt_showTemperature: "Teplota venku",
    opt_showHumidity: "Vlhkost venku",
    opt_showWifi: "Tlačítko Wi-Fi",
    opt_entity: "Zdroj počasí",
    opt_contrast: "Barva textu",
    opt_contrast_auto: "Podle motivu",
    opt_contrast_light: "Bílá",
    opt_contrast_dark: "Tmavá",
    optionsHint: "Volby se ukládají u dlaždice, každá dlaždice může vypadat jinak.",
    iphoneSection: "iPhone",
    statusBarStrip: "Tmavý pruh pod stavovým řádkem",
    statusBarStripHint: "Pomůže, když je světlé pozadí a bílé hodiny iOS nejsou čitelné.",
    layoutSection: "Rozložení",
    layoutMode: "Stránky",
    layoutMode_auto: "Automaticky",
    layoutMode_single: "Jeden sloupec",
    layoutModeHint: "Automaticky: na tabletu a širokém displeji je víc stránek vedle sebe. Jeden sloupec: vždy jedna stránka uprostřed.",
    dockPosition: "Dok",
    dockPosition_auto: "Automaticky",
    dockPosition_bottom: "Dole",
    dockPosition_right: "Vpravo",
    dockPosition_left: "Vlevo",
    dockPositionHint: "Automaticky: vpravo na telefonu na šířku, jinak dole.",
    wifiSsid: "Wi-Fi SSID",
    wifiPassword: "Wi-Fi heslo",
    wifiSecurity: "Zabezpečení",
    dashTheme: "Dashboard theme",
    accent: "Accent",
    addPage: "+ Page",
    clearPages: "Smazat všechny Pages",
    pagesEmpty: "Zatím žádné Pages — přidej první tlačítkem + Page.",
    pageName: "Název page",
    pageIcon: "Ikona",
    devices: "Zařízení",
    addDevice: "+ Přidat",
    delete: "Smazat",
    deletePage: "Smazat stránku",
    confirmDelete: "Opravdu smazat?",
    confirmYes: "Ano",
    confirmNo: "Zrušit",
    confirmClearPages: (n) => (n === 1 ? "Opravdu smazat jedinou stránku?"
      : n < 5 ? `Opravdu smazat všechny ${n} stránky?` : `Opravdu smazat všech ${n} stránek?`),
    pagesReorderHint: "Pořadí změníte přetažením (na dotyk podržte), z klávesnice Alt + ← / →. Pořadí odpovídá swipování v aplikaci.",
    pageMoved: (label, pos, total) => `${label}: pozice ${pos} z ${total}`,
    dockAdd: "+ Page do docku",
    dockPage: "Page",
    dockLabel: "Název (volitelný override)",
    dockShowLabel: "Zobrazit název",
    dockFull: `Dock je plný (max. ${DOCK_MAX}).`,
    gridEmpty: "Prázdná page — přidej první zařízení.",
    devType: "Typ",
    devEntity: "Entita",
    devLabel: "Název",
    devStyle: "Styl",
    devSize: "Velikost",
    moveLeft: "← Posunout",
    moveRight: "Posunout →",
    pickIcon: "Vybrat ikonu",
    iconSearch: "Hledat ikonu (např. lampa, koupelna, vrata)",
    iconAll: "Vše",
    iconRecent: "Naposledy použité",
    iconNone: "Žádná ikona neodpovídá hledání.",
    iconLoading: "Načítám ikony…",
    iconLoadFailed: "Ikony se nepodařilo načíst.",
    iconCount: (n) => `${n} ikon`,
    type_divider: "Oddělovač",
    type_scene: "Scéna",
    type_fan: "Ventilátor",
    type_light_group: "Skupina světel",
    type_player: "Přehrávač dash (rádio, Spotify)",
    type_library: "Videotéka",
    style_trending: "Trendy",
    style_search: "Hledání",
    style_activity: "Stahování",
    type_sensor: "Senzor",
    type_binary_sensor: "Binární senzor",
    type_entity: "Entita",
    style_value: "Hodnota",
    style_status: "Stav",
    style_toggle: "Tlačítko",
    opt_attribute: "Atribut",
    attributeNone: "— jen stav —",
    opt_entities: "Světla ve skupině",
    opt_outputs: "Další přehrávače v listu",
    outputsHint: "Prázdné = všechny přehrávače, které dashboard (nebo host) vidí.",
    style_nowplaying: "Teď hraje",
    style_vinyl: "Gramofon",
    speakerGuide: "Jak připojit reproduktor",
    mediaHint: "Klepnutím na dlaždici se otevře přehrávač: přehrávače, procházení a hledání podle toho, co přehrávač umí.",
    entitiesSearch: "Hledat světlo",
    entitiesCount: (n, min, max) => `Vybráno ${n} (nejméně ${min}, nejvýš ${max})`,
    entitiesTooFew: (min) => `Skupina potřebuje aspoň ${min} světla.`,
    entityGenericHint: "Jen ke čtení. Zámky, alarmy, kamery a další zakázané domény tu nejsou.",
    longPressHint: "V aplikaci: podržením dlaždice světla otevřeš jas, teplotu bílé, barvu a efekty (jen co světlo umí).",
    addDivider: "+ Oddělovač",
    dividerPlaceholder: "Název sekce (nepovinný)",
    dividerHint: "Oddělovač je přes celý řádek: text vlevo, za ním linka. Prázdný = jen linka.",
    type_light: "Světlo",
    type_switch: "Vypínač",
    type_climate: "Klima",
    type_cover: "Roleta",
    type_media_player: "Media player",
    style_tile: "Karta",
    style_slider: "Slider",
    style_vertical: "Svislý slider",
    style_button: "Tlačítko",
    style_row: "Řádek",
    style_dial: "Kolečko",
    style_mini: "Mini",
    style_cover: "Obal alba",
    resizeTile: "Táhni pro změnu velikosti a stylu",
    tabStandby: "Standby",
    tabLibrary: "Videotéka",
    libEnable: "Zapnout Videotéku",
    libIntro: "Objevit, požádat a vybrat release na jednom místě. Ovládá tvůj Radarr, Sonarr a qBittorrent. Klíče a hesla zůstávají jen v Home Assistantu.",
    libServices: "Služby",
    libSvc_tmdb: "TMDB (objevování, plakáty)",
    libSvc_radarr: "Radarr (filmy)",
    libSvc_sonarr: "Sonarr (seriály)",
    libSvc_qbittorrent: "qBittorrent (rychlost, pauza)",
    libConfigured: (url) => (url ? `Nastaveno · ${url}` : "Nastaveno"),
    libNotConfigured: "Nenastaveno",
    libUrl: "Adresa",
    libApiKey: "API klíč",
    libUser: "Uživatel",
    libPassword: "Heslo",
    libQbitAuth: "Přihlášení do qBittorrentu",
    libQbitAuth_api_key: "API klíč",
    libQbitAuth_password: "Jméno a heslo",
    libQbitKeyHint: "qBittorrent 5.2 a novější: klíč najdeš v Nastavení → WebUI → API klíč (začíná na qbt_). Nepotřebuje heslo ani přihlašovací cookie.",
    libQbitPasswordHint: "Uživatel a heslo z Nastavení → WebUI. Funguje i se staršími verzemi qBittorrentu.",
    libKeepKey: "•••••• (beze změny)",
    libSave: "Uložit",
    libChange: "Změnit",
    libRemove: "Odebrat",
    libTest: "Otestovat připojení",
    libTestOk: (v) => (v ? `Funguje (verze ${v})` : "Funguje"),
    libTestFail: (code) => `Nefunguje: ${code}`,
    libDefaults: "Výchozí nastavení",
    libDefaultsHint: "Profil kvality a složka pro „Automaticky“ a „Vybrat release“. Nabídka se načte po úspěšném testu Radarru / Sonarru.",
    libMovieProfile: "Filmy: profil",
    libMovieRoot: "Filmy: složka",
    libTvProfile: "Seriály: profil",
    libTvRoot: "Seriály: složka",
    libInterval: "Obnovení stahování",
    libGuestsHint: "Hosté nemají do Videotéky přístup, dokud ho nezapneš v záložce Hosté u profilu.",
    libTmdbAttribution: "Atribuce TMDB (zobrazuje se v aplikaci)",
    tabMusic: "Hudba",
    musicHaPlayers: "Přehrávače v Home Assistantu",
    musicHaPlayersHint: "Dlaždice „Přehrávač médií“ ovládá tyto přehrávače. Žádné doplňky nejsou potřeba.",
    musicNoPlayers: "Home Assistant teď nevidí žádný media_player.",
    radioSection: "Rádio v prohlížeči",
    radioHint: "Hraje přímo v telefonu nebo tabletu s dashboardem. Jen adresy https:// (stránka na https nepřehraje http stream).",
    radioName: "Název",
    radioUrl: "Adresa streamu",
    radioAdd: "Přidat stanici",
    radioTest: "Test",
    radioTestStop: "Zastavit",
    radioTesting: "Zkouším…",
    radioTestOk: "Hraje",
    radioTestFail: "Nehraje",
    radioRemove: "Odebrat",
    radioUp: "Výš",
    radioDown: "Níž",
    radioEmpty: "Zatím žádná stanice.",
    radioErrName: "Zadej název (nejvýš 60 znaků).",
    radioErrUrl: "Jen adresa https:// bez jména a hesla. Stream na http:// stránka na https nepřehraje.",
    radioErrMax: "Nejvýš 50 stanic.",
    radioErrDup: "Tahle adresa už v seznamu je.",
    radioLibrary: "Soubory z Home Assistantu (složka media) v prohlížeči",
    radioDirectory: "Hledat stanice v katalogu radio-browser.info",
    radioDirectoryHint: "Hledá Home Assistant, ne prohlížeč. Vypnuto = žádné spojení s katalogem.",
    radioSearch: "Hledat stanici",
    radioSearchBtn: "Hledat",
    radioSearchNone: "Nic nenalezeno.",
    radioSearchFail: "Katalog teď neodpovídá.",
    spotifySection: "Spotify (volitelné)",
    spotifyEnable: "Zapnout Spotify",
    spotifyNeeds: "Potřebuješ Spotify Premium a vlastní aplikaci na developer.spotify.com (nejvýš 5 uživatelů). Není určeno pro hotely a firmy: podmínky Spotify zakazují komerční použití bez jejich souhlasu.",
    spotifyStep1: "Otevři developer.spotify.com/dashboard a vytvoř aplikaci. Zaškrtni „Web API“ a „Web Playback SDK“.",
    spotifyStep2: "Jako Redirect URI zadej přesně tuto adresu:",
    spotifyStep2Warn: "Dashboard neběží na https: Spotify takovou adresu nepřijme. Použij hostovaný dash nebo vlastní https adresu.",
    spotifyStep3: "V User Management přidej e-mail svého účtu Spotify (a dalších, nejvýš 5).",
    spotifyStep4: "Zkopíruj Client ID aplikace a vlož ho sem:",
    spotifyClientId: "Client ID",
    spotifySaveId: "Uložit",
    spotifyStep5: "Připoj účet:",
    spotifyConnect: "Připojit Spotify",
    spotifyPaste: "Okno se nevrátilo? Vlož kód z něj:",
    spotifyPasteBtn: "Vložit kód",
    spotifyConnected: (name) => `Připojeno jako ${name || "účet Spotify"}`,
    spotifyDisconnect: "Odpojit",
    spotifyWebPlayer: "Přehrávat i v prohlížeči s dashboardem (jen tvoje zařízení)",
    spotifyErr: (code) => `Spotify: ${code}`,
    copy: "Zkopírovat",
    tileSource: "Zdroj",
    source_ha: "HA přehrávač",
    source_browser: "Rádio v prohlížeči",
    source_spotify: "Spotify",
    hosting: "Kde dashboard běží",
    hostingHosted: "Zdarma na dash.matyas.online",
    hostingSelf: "Vlastní hosting",
    hostedUrl: "Tvůj odkaz",
    hostedWarn: "Hosted dash potřebuje Home Assistant dostupný přes HTTPS z internetu (např. Nabu Casa nebo vlastní doména). Teď je HA otevřený přes:",
    openDashboard: "Otevřít",
    copyLink: "Kopírovat",
    copied: "Zkopírováno",
    uiPreview: "Live preview",
    standbyEnabled: "Zapnout standby",
    standbyIdle: "Spustit po nečinnosti",
    minutes: (n) => `${n} min`,
    standbyMode: "Zobrazení",
    modeClock: "Hodiny",
    modePhotos: "Fotorámeček",
    clockStyle: "Styl hodin",
    clockBold: "Barevné",
    clockMinimal: "Minimal",
    photoSeconds: "Fotka každých",
    seconds: (n) => `${n} s`,
    photos: "Fotky",
    addPhotos: "+ Přidat fotky",
    uploading: (n) => `Nahrávám ${n}…`,
    photosEmpty: "Zatím žádné fotky.",
    photoTooLarge: "Fotka je i po zmenšení příliš velká.",
    standbyPreview: "Ukázat v náhledu",
    standbyHide: "Skrýt",
    devicesCount: (n) => `${n} zařízení`,
    langAuto: "Auto (HA)",
    langCs: "Čeština",
    langEn: "English",
    uiSettings: "Nastavení config rozhraní",
    uiSettingsHint: "Jen vzhled tohoto config panelu. Žádný guest config.",
    uiSettingsBack: "← Zpět na config",
    uiTheme: "Vzhled panelu",
    uiLanguage: "Jazyk panelu",
    close: "Zavřít",
  },
  en: {
    title: "Config",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    tabGeneral: "General",
    tabPages: "Pages",
    tabDock: "Dock",
    tabGuests: "Guests",
    tabGuest: "Wi-Fi",
    tabStyles: "Styles",
    previewTitle: "Live preview",
    previewMeta: (label, w, h) => `${label} · ${w} × ${h} px`,
    previewApprox: "approximate safe area",
    previewTypical: "typical size",
    previewViewport: "browser viewport",
    previewDevice: "Device",
    devGroup_phone: "Phones",
    devGroup_tablet: "Tablets",
    devGroup_wall: "Wall displays",
    devGroup_custom: "Custom",
    devCustom: "Custom size",
    previewScale: "Scale",
    scaleFit: "Fit",
    scale100: "100 %",
    customW: "Width",
    customH: "Height",
    swapWH: "Swap",
    customSafe: "Safe area (px)",
    safeT: "Top",
    safeR: "Right",
    safeB: "Bottom",
    safeL: "Left",
    customInvalid: `Width and height must be ${CUSTOM_MIN}–${CUSTOM_MAX} px.`,
    previewEmpty: "Choose where the dashboard runs in General and save.",
    rotateLandscape: "Landscape",
    rotatePortrait: "Portrait",
    dashboardUrl: "Your web dashboard URL",
    headerTilesHint: "Add the header, clock, greeting and weather as tiles on a page.",
    clockSection: "Clock",
    weatherAuto: "Auto — first weather entity, else the HA home location",
    genUse24h: "24-hour clock",
    addMenuLabel: "Add a tile",
    group_devices: "Devices",
    group_info: "Info",
    group_header: "Header",
    group_layout: "Layout",
    type_header: "Header",
    type_clock: "Clock",
    type_greeting: "Greeting",
    type_weather: "Weather",
    type_wifi: "Wi-Fi",
    style_card: "Card",
    style_plain: "No background",
    style_lockscreen: "Lock screen",
    style_compact: "One line",
    style_glass: "Glass",
    opt_showTime: "Time",
    opt_showDate: "Date",
    opt_showGreeting: "Greeting",
    opt_showWeather: "Weather",
    opt_showTemperature: "Outside temperature",
    opt_showHumidity: "Outside humidity",
    opt_showWifi: "Wi-Fi button",
    opt_entity: "Weather source",
    opt_contrast: "Text colour",
    opt_contrast_auto: "Follow the theme",
    opt_contrast_light: "White",
    opt_contrast_dark: "Dark",
    optionsHint: "Options are stored on the tile, so every tile can look different.",
    iphoneSection: "iPhone",
    statusBarStrip: "Dark strip behind the status bar",
    statusBarStripHint: "Helps when the background is light and the white iOS clock is hard to read.",
    layoutSection: "Layout",
    layoutMode: "Pages",
    layoutMode_auto: "Automatic",
    layoutMode_single: "One column",
    layoutModeHint: "Automatic: tablets and wide screens show several pages side by side. One column: always one page in the middle.",
    dockPosition: "Dock",
    dockPosition_auto: "Automatic",
    dockPosition_bottom: "Bottom",
    dockPosition_right: "Right",
    dockPosition_left: "Left",
    dockPositionHint: "Automatic: on the right on a phone in landscape, at the bottom elsewhere.",
    wifiSsid: "Wi-Fi SSID",
    wifiPassword: "Wi-Fi password",
    wifiSecurity: "Security",
    dashTheme: "Dashboard theme",
    accent: "Accent",
    addPage: "+ Page",
    clearPages: "Clear all Pages",
    pagesEmpty: "No Pages yet — add one with + Page.",
    pageName: "Page name",
    pageIcon: "Icon",
    devices: "Devices",
    addDevice: "+ Add",
    delete: "Delete",
    deletePage: "Delete page",
    confirmDelete: "Really delete?",
    confirmYes: "Yes",
    confirmNo: "Cancel",
    confirmClearPages: (n) => (n === 1 ? "Really delete the only page?" : `Really delete all ${n} pages?`),
    pagesReorderHint: "Drag to reorder (on touch, press and hold), or Alt + ← / → from the keyboard. The order is the swipe order in the app.",
    pageMoved: (label, pos, total) => `${label}: position ${pos} of ${total}`,
    dockAdd: "+ Page to dock",
    dockPage: "Page",
    dockLabel: "Name (optional override)",
    dockShowLabel: "Show name",
    dockFull: `Dock is full (max ${DOCK_MAX}).`,
    gridEmpty: "Empty page — add the first device.",
    devType: "Type",
    devEntity: "Entity",
    devLabel: "Name",
    devStyle: "Style",
    devSize: "Size",
    moveLeft: "← Move",
    moveRight: "Move →",
    pickIcon: "Pick icon",
    iconSearch: "Search icons (e.g. lamp, bathroom, gate)",
    iconAll: "All",
    iconRecent: "Recently used",
    iconNone: "No icon matches the search.",
    iconLoading: "Loading icons…",
    iconLoadFailed: "Icons could not be loaded.",
    iconCount: (n) => `${n} icons`,
    type_divider: "Divider",
    type_scene: "Scene",
    type_fan: "Fan",
    type_light_group: "Light group",
    type_player: "dash player (radio, Spotify)",
    type_library: "Video library",
    style_trending: "Trending",
    style_search: "Search",
    style_activity: "Downloads",
    type_sensor: "Sensor",
    type_binary_sensor: "Binary sensor",
    type_entity: "Entity",
    style_value: "Value",
    style_status: "Status",
    style_toggle: "Button",
    opt_attribute: "Attribute",
    attributeNone: "— state only —",
    opt_entities: "Lights in the group",
    opt_outputs: "Other players in the sheet",
    outputsHint: "Empty = every player the dashboard (or the guest) can see.",
    style_nowplaying: "Now playing",
    style_vinyl: "Record player",
    speakerGuide: "How to connect a speaker",
    mediaHint: "A tap on the tile opens the player: players, browse and search, as far as the player supports them.",
    entitiesSearch: "Search lights",
    entitiesCount: (n, min, max) => `${n} selected (at least ${min}, at most ${max})`,
    entitiesTooFew: (min) => `A group needs at least ${min} lights.`,
    entityGenericHint: "Read only. Locks, alarms, cameras and other denied domains are not offered.",
    longPressHint: "In the app: hold a light tile for brightness, white temperature, colour and effects (only what the light supports).",
    addDivider: "+ Divider",
    dividerPlaceholder: "Section name (optional)",
    dividerHint: "A divider spans the whole row: text on the left, a line after it. Empty = just the line.",
    type_light: "Light",
    type_switch: "Switch",
    type_climate: "Climate",
    type_cover: "Cover",
    type_media_player: "Media player",
    style_tile: "Card",
    style_slider: "Slider",
    style_vertical: "Vertical slider",
    style_button: "Button",
    style_row: "Row",
    style_dial: "Dial",
    style_mini: "Mini",
    style_cover: "Album art",
    resizeTile: "Drag to change size and style",
    tabStandby: "Standby",
    tabLibrary: "Video library",
    libEnable: "Turn on the video library",
    libIntro: "Discover, request and pick a release in one place. It drives your Radarr, Sonarr and qBittorrent. Keys and passwords stay in Home Assistant only.",
    libServices: "Services",
    libSvc_tmdb: "TMDB (discovery, posters)",
    libSvc_radarr: "Radarr (films)",
    libSvc_sonarr: "Sonarr (series)",
    libSvc_qbittorrent: "qBittorrent (speed, pause)",
    libConfigured: (url) => (url ? `Configured · ${url}` : "Configured"),
    libNotConfigured: "Not configured",
    libUrl: "Address",
    libApiKey: "API key",
    libUser: "User",
    libPassword: "Password",
    libQbitAuth: "qBittorrent sign-in",
    libQbitAuth_api_key: "API key",
    libQbitAuth_password: "Username and password",
    libQbitKeyHint: "qBittorrent 5.2 or later: the key is in Preferences → WebUI → API key (it starts with qbt_). No password or login cookie needed.",
    libQbitPasswordHint: "The username and password from Preferences → WebUI. Works with older qBittorrent versions too.",
    libKeepKey: "•••••• (unchanged)",
    libSave: "Save",
    libChange: "Change",
    libRemove: "Remove",
    libTest: "Test connection",
    libTestOk: (v) => (v ? `Works (version ${v})` : "Works"),
    libTestFail: (code) => `Does not work: ${code}`,
    libDefaults: "Defaults",
    libDefaultsHint: "Quality profile and folder for \"Automatic\" and \"Pick a release\". The choices load after a successful Radarr / Sonarr test.",
    libMovieProfile: "Films: profile",
    libMovieRoot: "Films: folder",
    libTvProfile: "Series: profile",
    libTvRoot: "Series: folder",
    libInterval: "Download refresh",
    libGuestsHint: "Guests have no access to the video library until you turn it on for a profile in the Guests tab.",
    libTmdbAttribution: "TMDB attribution (shown in the app)",
    tabMusic: "Music",
    musicHaPlayers: "Home Assistant players",
    musicHaPlayersHint: "A media player tile controls these players. No add-ons needed.",
    musicNoPlayers: "Home Assistant has no media_player right now.",
    radioSection: "Radio in the browser",
    radioHint: "Plays on the phone or tablet showing the dashboard. https:// addresses only (an https page cannot play an http stream).",
    radioName: "Name",
    radioUrl: "Stream address",
    radioAdd: "Add station",
    radioTest: "Test",
    radioTestStop: "Stop",
    radioTesting: "Trying…",
    radioTestOk: "Playing",
    radioTestFail: "Not playing",
    radioRemove: "Remove",
    radioUp: "Up",
    radioDown: "Down",
    radioEmpty: "No station yet.",
    radioErrName: "Enter a name (60 characters at most).",
    radioErrUrl: "Only an https:// address without user and password. An https page cannot play an http:// stream.",
    radioErrMax: "50 stations at most.",
    radioErrDup: "This address is already in the list.",
    radioLibrary: "Files from Home Assistant (media folder) in the browser",
    radioDirectory: "Search stations in the radio-browser.info directory",
    radioDirectoryHint: "Home Assistant searches, not the browser. Off = no connection to the directory.",
    radioSearch: "Search a station",
    radioSearchBtn: "Search",
    radioSearchNone: "Nothing found.",
    radioSearchFail: "The directory does not answer right now.",
    spotifySection: "Spotify (optional)",
    spotifyEnable: "Turn on Spotify",
    spotifyNeeds: "You need Spotify Premium and your own app on developer.spotify.com (5 users at most). Not for hotels and businesses: Spotify's terms forbid commercial use without their consent.",
    spotifyStep1: "Open developer.spotify.com/dashboard and create an app. Tick \"Web API\" and \"Web Playback SDK\".",
    spotifyStep2: "Use exactly this Redirect URI:",
    spotifyStep2Warn: "The dashboard does not run on https: Spotify will not accept this address. Use hosted dash or your own https address.",
    spotifyStep3: "In User Management add the e-mail of your Spotify account (and others, 5 at most).",
    spotifyStep4: "Copy the app's Client ID and paste it here:",
    spotifyClientId: "Client ID",
    spotifySaveId: "Save",
    spotifyStep5: "Connect your account:",
    spotifyConnect: "Connect Spotify",
    spotifyPaste: "The window did not come back? Paste the code it shows:",
    spotifyPasteBtn: "Use code",
    spotifyConnected: (name) => `Connected as ${name || "your Spotify account"}`,
    spotifyDisconnect: "Disconnect",
    spotifyWebPlayer: "Also play in the dashboard's browser (your devices only)",
    spotifyErr: (code) => `Spotify: ${code}`,
    copy: "Copy",
    tileSource: "Source",
    source_ha: "HA player",
    source_browser: "Radio in the browser",
    source_spotify: "Spotify",
    hosting: "Where the dashboard runs",
    hostingHosted: "Free on dash.matyas.online",
    hostingSelf: "Self-hosted",
    hostedUrl: "Your link",
    hostedWarn: "Hosted dash needs Home Assistant reachable over HTTPS from the internet (e.g. Nabu Casa or your own domain). Right now HA is open via:",
    openDashboard: "Open",
    copyLink: "Copy",
    copied: "Copied",
    uiPreview: "Live preview",
    standbyEnabled: "Enable standby",
    standbyIdle: "Start after idle",
    minutes: (n) => `${n} min`,
    standbyMode: "Display",
    modeClock: "Clock",
    modePhotos: "Photo frame",
    clockStyle: "Clock style",
    clockBold: "Colourful",
    clockMinimal: "Minimal",
    photoSeconds: "Photo every",
    seconds: (n) => `${n} s`,
    photos: "Photos",
    addPhotos: "+ Add photos",
    uploading: (n) => `Uploading ${n}…`,
    photosEmpty: "No photos yet.",
    photoTooLarge: "The photo is too large even after resizing.",
    standbyPreview: "Show in preview",
    standbyHide: "Hide",
    devicesCount: (n) => `${n} devices`,
    langAuto: "Auto (HA)",
    langCs: "Čeština",
    langEn: "English",
    uiSettings: "Config UI settings",
    uiSettingsHint: "Only this config panel chrome. No guest dashboard config here.",
    uiSettingsBack: "← Back to config",
    uiTheme: "Panel theme",
    uiLanguage: "Panel language",
    close: "Close",
  },
};

const emptyConfig = () => ({
  configVersion: 3,
  guestInfo: {
    wifiSsid: "",
    wifiPassword: "",
    wifiSecurity: "WPA",
  },
  general: { ...DEFAULT_GENERAL },
  standby: { ...DEFAULT_STANDBY },
  pages: [],
  dock: [],
  hosting: "hosted",
  dashboardUrl: "",
  appearance: { mode: "light", accent: "#ff6b00" },
  radio: { stations: [], mediaLibrary: false, directory: false },
  spotify: { enabled: false, webPlayer: false },
  library: { enabled: false, movieProfileId: null, movieRootFolder: "", tvProfileId: null, tvRootFolder: "", interval: 3 },
});

function normalizeConfig(cfg = {}) {
  const base = emptyConfig();
  let pages = [];
  if (Array.isArray(cfg.pages) && cfg.pages.length) pages = cfg.pages;
  else if (Array.isArray(cfg.rooms) && cfg.rooms.length) pages = cfg.rooms;
  else if (Array.isArray(cfg.pages)) pages = cfg.pages;
  // Pages are free-form cards — drop legacy area linkage
  pages = pages.map((pg) => {
    if (!pg || typeof pg !== "object") return pg;
    const { haAreaId, temperatureEntity, humidityEntity, ...rest } = pg;
    return { ...rest, devices: Array.isArray(rest.devices) ? rest.devices : [] };
  });
  const g = cfg.guestInfo || {};
  const dock = (Array.isArray(cfg.dock) ? cfg.dock : [])
    .filter((d) => d && !d.entityId && !d.entity_id)
    .slice(0, DOCK_MAX)
    .map((d) => ({
      pageId: d.pageId || d.page_id || d.roomId || d.room_id || "",
      label: d.label || "",
      showLabel: d.showLabel !== false,
      icon: d.icon || "Home",
    }))
    .filter((d) => d.pageId);
  const out = {
    ...base,
    ...cfg,
    guestInfo: {
      wifiSsid: g.wifiSsid || "",
      wifiPassword: g.wifiPassword || "",
      wifiSecurity: g.wifiSecurity || "WPA",
    },
    general: { ...DEFAULT_GENERAL, ...(cfg.general || {}) },
    standby: { ...DEFAULT_STANDBY, ...(cfg.standby || {}) },
    hosting: cfg.hosting === "self" || cfg.hosting === "hosted" ? cfg.hosting : (cfg.dashboardUrl ? "self" : "hosted"),
    pages,
    dock,
    appearance: { ...base.appearance, ...(cfg.appearance || {}) },
  };
  delete out.rooms;
  delete out.scenes;
  return out;
}


class GuestHaDashboardPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = emptyConfig();
    this._saving = false;
    this._savedAt = null;
    this._error = null;
    this._info = null;
    this._tab = "general";
    this._pageIdx = 0;
    /** Selected tile in the Pages grid editor (-1 = none) */
    this._devIdx = -1;
    this._dragIdx = -1;
    this._iconOpen = null;
    this._iconPickers = new Map();
    this._previewOn = localStorage.getItem(PREVIEW_KEY) !== "off";
    /** Standby photos: ids from HA + thumbnail object URLs */
    this._photos = null;
    this._thumbs = new Map();
    this._uploading = 0;
    /** Live preview device: preset or custom size, orientation, scale (remembered) */
    this._dev = loadDeviceState();
    this._orient = this._dev.orient;
    this._rotating = false;
    /** Theme of the saved config — the phone screen chrome follows the live page, not the draft */
    this._liveMode = "light";
    this._uiTheme = localStorage.getItem(UI_THEME_KEY) || "auto";
    const storedLang = localStorage.getItem(UI_LANG_KEY);
    this._uiLangPref = storedLang === "en" || storedLang === "cs" ? storedLang : "auto";
    /** Live iframe src — updates only on load + Save, never while drafting */
    this._livePreviewSrc = "";
    /** "Hosté" tab: guest passes, profiles, audit (www/guests.js) */
    this._guests = new GuestsTab(this);
    this.attachShadow({ mode: "open" });
  }

  /** Home Assistant language / region → cs | en */
  _haLang() {
    const raw =
      this._hass?.locale?.language ||
      this._hass?.language ||
      this._hass?.locale?.languageCode ||
      "";
    const low = String(raw).toLowerCase();
    if (low.startsWith("en")) return "en";
    if (low.startsWith("cs") || low.startsWith("sk")) return "cs";
    return "cs";
  }

  _uiLang() {
    if (this._uiLangPref === "en" || this._uiLangPref === "cs") return this._uiLangPref;
    return this._haLang();
  }

  _t(key, ...args) {
    const pack = PANEL_I18N[this._uiLang()] || PANEL_I18N.cs;
    const val = pack[key] ?? PANEL_I18N.cs[key] ?? key;
    return typeof val === "function" ? val(...args) : val;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._syncTheme();
      this._load();
      return;
    }
    // HA pushes a new `hass` object very often — never wipe the editor for that.
    const wasDark = this.hasAttribute("dark");
    this._syncTheme();
    if (this._uiTheme === "auto" && this.hasAttribute("dark") !== wasDark) {
      this._render();
    }
  }
  get hass() { return this._hass; }
  set narrow(v) {
    const next = Boolean(v);
    if (this._narrow === next) return;
    this._narrow = next;
    this._render();
  }
  connectedCallback() {
    this._syncTheme();
    this._render();
    this._attachShellObservers();
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => this._tickStatusClock(), 15000);
  }
  disconnectedCallback() {
    clearInterval(this._clockTimer);
    if (this._onFrameMessage) window.removeEventListener("message", this._onFrameMessage);
    this._resizeObs?.disconnect();
    this._resizeObs = null;
  }

  _isDark() {
    if (this._uiTheme === "dark") return true;
    if (this._uiTheme === "light") return false;
    return Boolean(this._hass?.themes?.darkMode);
  }
  _syncTheme() { this.toggleAttribute("dark", this._isDark()); }

  _ensureDock() {
    if (!Array.isArray(this._config.dock)) this._config.dock = [];
    if (this._config.dock.length > DOCK_MAX) this._config.dock = this._config.dock.slice(0, DOCK_MAX);
    return this._config.dock;
  }

  /** HA address the browser uses right now (what the dashboard must reach too). */
  _haUrl() {
    const external = this._hass?.config?.external_url;
    return (external || this._hass?.auth?.data?.hassUrl || window.location.origin).replace(/\/$/, "");
  }

  /** Hosted dash puts the HA host in the path: https://dash.matyas.online/<ha-host> */
  _hostedUrl() {
    try {
      return `${HOSTED_BASE}/${new URL(this._haUrl()).host}`;
    } catch {
      return "";
    }
  }

  /** Public HTTPS is required for the hosted page to reach this HA. */
  _haReachableFromHosted() {
    try {
      const u = new URL(this._haUrl());
      const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(u.hostname);
      return u.protocol === "https:" && !privateHost;
    } catch {
      return false;
    }
  }

  /** Exact dashboard URL — nothing special, just the live page. */
  _buildPreviewSrc(config) {
    if (config?.hosting !== "self") return this._hostedUrl();
    const base = (config?.dashboardUrl || "").trim().replace(/\/$/, "");
    if (!base) return "";
    try {
      const u = new URL(base.includes("://") ? base : `https://${base}`);
      return u.toString();
    } catch {
      return "";
    }
  }

  _syncLivePreviewSrc(config = this._config) {
    this._livePreviewSrc = this._buildPreviewSrc(config);
    this._liveMode = config?.appearance?.mode === "dark" ? "dark" : "light";
  }

  async _load() {
    if (!this._hass) return;
    try {
      const cfg = await this._hass.connection.sendMessagePromise({
        type: "guest_ha_dashboard/get_config",
      });
      this._config = normalizeConfig(cfg);
      this._ensureDock();
      this._ensureConfigIcons();
      this._error = null;
      if (this._pageIdx >= (this._config.pages?.length || 0)) this._pageIdx = 0;
      this._syncLivePreviewSrc(this._config);
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._render();
  }

  async _save() {
    if (!this._hass || this._saving) return;
    this._saving = true; this._error = null; this._render();
    try {
      const saved = await this._hass.connection.sendMessagePromise({
        type: "guest_ha_dashboard/set_config",
        config: this._config,
      });
      this._config = normalizeConfig(saved);
      this._ensureDock();
      this._savedAt = new Date();
      // The guest page picks up saved config over its own HA subscription;
      // the iframe is only re-pointed if the dashboard URL itself changed.
      this._syncLivePreviewSrc(this._config);
      this._saving = false;
      this._render();
      return;
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._saving = false;
    this._render();
  }

  _escape(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  _friendly(id) {
    return this._hass?.states?.[id]?.attributes?.friendly_name || id;
  }
  /**
   * Name of a tile in the editor: its own label, else the entity's friendly
   * name (tiles with an entity), else the type name from the registry. Never
   * an internal id such as "header-0e313dab".
   */
  _tileName(d) {
    if (d?.label) return d.label;
    if (TILE_TYPES[d?.type]?.needsEntity && d?.id) return this._friendly(d.id);
    return this._t(`type_${d?.type}`);
  }
  _addEmptyPage() {
    this._config.pages.push({
      id: `page_${Date.now()}`,
      label: "Nova page",
      icon: "Home",
      devices: [],
    });
    this._pageIdx = this._config.pages.length - 1;
    this._devIdx = -1;
    this._render();
  }
  _removePage(i) {
    const removed = this._config.pages[i];
    this._config.pages.splice(i, 1);
    // Drop dock entries pointing at deleted page
    if (removed?.id && Array.isArray(this._config.dock)) {
      this._config.dock = this._config.dock.filter((d) => d.pageId !== removed.id);
    }
    this._pageIdx = Math.max(0, Math.min(this._pageIdx, this._config.pages.length - 1));
    this._render();
  }

  /**
   * Move a page to another position (= swipe order in the app). The selected
   * page stays selected; the dock refers to pages by id, so it is unaffected.
   */
  _movePage(from, to, { focus = false } = {}) {
    const pages = this._config.pages;
    if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return;
    const wrap = this.shadowRoot.getElementById("pagePills");
    const before = new Map(
      [...(wrap?.querySelectorAll(".pill[data-page-id]") || [])].map((el) => [el.dataset.pageId, el.getBoundingClientRect()]),
    );
    const selected = pages[this._pageIdx];
    const [moved] = pages.splice(from, 1);
    pages.splice(to, 0, moved);
    this._pageIdx = Math.max(0, pages.indexOf(selected));
    this._render();

    const pills = this.shadowRoot.getElementById("pagePills");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const el of pills?.querySelectorAll(".pill[data-page-id]") || []) {
      const old = before.get(el.dataset.pageId);
      if (!old || reduce) continue;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 300, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
      );
    }
    const id = moved.id || `#${to}`;
    if (focus) pills?.querySelector(`.pill[data-page-id="${CSS.escape(id)}"]`)?.focus();
    const live = this.shadowRoot.getElementById("pagesLive");
    // set after the render so screen readers announce the change
    if (live) setTimeout(() => { live.textContent = this._t("pageMoved", moved.label || moved.id, to + 1, pages.length); }, 60);
  }

  /** Page pills: drag to reorder (mouse at once, touch after a ~280 ms hold), Alt+←/→ from the keyboard. */
  _bindPagePills() {
    const wrap = this.shadowRoot.getElementById("pagePills");
    if (!wrap) return;
    const drop = wrap.querySelector(".pill-drop");
    const pills = () => [...wrap.querySelectorAll(".pill[data-page]")];
    let d = null;

    const target = (x, y) => {
      let best = null;
      let bestScore = Infinity;
      for (const el of pills()) {
        if (Number(el.dataset.page) === d.from) continue;
        const r = el.getBoundingClientRect();
        const score = Math.abs(x - (r.left + r.width / 2)) + Math.abs(y - (r.top + r.height / 2)) * 3;
        if (score < bestScore) { bestScore = score; best = { el, r }; }
      }
      if (!best) return null;
      const idx = Number(best.el.dataset.page);
      const before = x < best.r.left + best.r.width / 2;
      const pos = before ? idx : idx + 1;
      return { to: pos > d.from ? pos - 1 : pos, r: best.r, before };
    };
    const showDrop = (t) => {
      if (!drop) return;
      if (!t || t.to === d.from) { drop.classList.remove("on"); return; }
      const w = wrap.getBoundingClientRect();
      drop.style.left = `${(t.before ? t.r.left - 4.5 : t.r.right + 1.5) - w.left}px`;
      drop.style.top = `${t.r.top - w.top}px`;
      drop.style.height = `${t.r.height}px`;
      drop.classList.add("on");
    };
    const end = () => {
      clearTimeout(d?.hold);
      d?.el.classList.remove("lifting", "dragging");
      d?.el.style.removeProperty("--tx");
      d?.el.style.removeProperty("--ty");
      wrap.classList.remove("is-dragging");
      drop?.classList.remove("on");
      d = null;
    };

    wrap.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this._config.pages.length < 2) return;
      const el = e.target.closest(".pill[data-page]");
      if (!el) return;
      d = {
        el, from: Number(el.dataset.page), x0: e.clientX, y0: e.clientY,
        touch: e.pointerType !== "mouse", armed: e.pointerType === "mouse", started: false, to: null, id: e.pointerId,
      };
      if (d.touch) {
        d.hold = setTimeout(() => {
          if (!d) return;
          d.armed = true;
          el.classList.add("lifting");
          try { wrap.setPointerCapture(d.id); } catch { /* synthetic pointer */ }
        }, 280);
      }
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!d) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.armed) {
        // touch moved before the hold finished: it is a scroll, not a drag
        if (Math.hypot(dx, dy) > 8) end();
        return;
      }
      if (!d.started) {
        if (Math.hypot(dx, dy) < 5) return;
        d.started = true;
        try { wrap.setPointerCapture(d.id); } catch { /* synthetic pointer */ }
        d.el.classList.remove("lifting");
        d.el.classList.add("dragging");
        wrap.classList.add("is-dragging");
      }
      e.preventDefault();
      d.el.style.setProperty("--tx", `${dx}px`);
      d.el.style.setProperty("--ty", `${dy}px`);
      const t = target(e.clientX, e.clientY);
      d.to = t ? t.to : null;
      showDrop(t);
    });
    const finish = () => {
      if (!d) return;
      const { started, from, to } = d;
      end();
      if (!started) return;
      // the click that follows pointerup must not select the page
      this._pillDragged = true;
      setTimeout(() => { this._pillDragged = false; }, 0);
      if (to !== null && to !== from) this._movePage(from, to);
    };
    wrap.addEventListener("pointerup", finish);
    wrap.addEventListener("pointercancel", end);
    wrap.addEventListener("lostpointercapture", () => { if (d?.started) finish(); });

    wrap.addEventListener("keydown", (e) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const el = e.target.closest(".pill[data-page]");
      if (!el) return;
      e.preventDefault();
      const from = Number(el.dataset.page);
      this._movePage(from, from + (e.key === "ArrowLeft" ? -1 : 1), { focus: true });
    });
  }

  _addDivider(page) {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
    const divider = { id: `divider-${hex}`, type: "divider", label: "", style: "line", size: "4x1" };
    page.devices.push(divider);
    this._devIdx = -1;
    this._render();
    this.shadowRoot.querySelector(`[data-div-label="${page.devices.length - 1}"]`)?.focus();
  }

  /** A new tile of `type` with the registry defaults (first style and size, option defaults). */
  _newDevice(type) {
    const spec = TILE_TYPES[type];
    const style = Object.keys(spec.styles)[0];
    const device = { id: "", type, style, size: spec.styles[style][0] };
    if (spec.needsEntity) {
      device.label = this._t(`type_${type}`);
      device.icon = DEFAULT_DEVICE_ICON[type];
      if (type === "light") device.supportsBrightness = true;
    } else {
      const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
      device.id = `${type}-${hex}`;
    }
    for (const [name, f] of Object.entries(spec.fields || {})) {
      if (f.type === "bool" || f.type === "enum") device[name] = f.default;
      else if (f.type === "entities") device[name] = [];
      else device[name] = "";
    }
    return device;
  }

  _addDevice(page, type = "light") {
    page.devices.push(this._newDevice(type));
    this._devIdx = page.devices.length - 1;
    this._addOpen = false;
    this._render();
    this.shadowRoot.querySelector(".inspector")?.scrollIntoView?.({ block: "nearest" });
  }

  /** Inline list under "+ Přidat", grouped like the registry (devices, info, header). */
  _renderAddMenu() {
    if (!this._addOpen) return "";
    const groups = ["devices", "info", "header"];
    return `
      <div class="add-menu" id="addMenu" role="group" aria-label="${this._escape(this._t("addMenuLabel"))}">
        ${groups.map((g) => {
          const types = DEVICE_TYPES.filter((t) => TILE_TYPES[t].group === g);
          if (!types.length) return "";
          return `
            <div class="add-group">
              <span class="add-group-title">${this._t(`group_${g}`)}</span>
              <div class="add-items">${types.map((t) => `
                <button type="button" class="add-item" data-add-type="${t}">${iconSvg(DEFAULT_DEVICE_ICON[t], 16)}<span>${this._t(`type_${t}`)}</span></button>`).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>`;
  }

  /**
   * Icon button + popover grid with real SVG previews.
   * `key` must be unique per render; `onPick(name)` is called on selection.
   */
  _iconPicker(key, current, onPick) {
    this._iconPickers.set(key, onPick);
    const open = this._iconOpen === key;
    // unknown names (catalog not loaded yet, or a removed icon) show as Sparkles, like the app
    const name = knownIcon(current) ? current : "Sparkles";
    return `
      <div class="icon-picker" data-picker="${key}">
        <button type="button" class="icon-btn ${open ? "open" : ""}" data-icon-open="${key}" title="${this._t("pickIcon")}"
          aria-expanded="${open}">
          ${iconSvg(name, 20)}<span>${this._escape(this._iconName(name))}</span>
        </button>
        ${open ? this._iconPanel(key, name) : ""}
      </div>`;
  }

  /** Human name for aria-labels: first keyword in the panel language, then the lucide name. */
  _iconName(name) {
    const item = ICON_CATALOG?.ICON_LIST.find((i) => i.n === name);
    const word = item?.[this._uiLang() === "en" ? "en" : "cs"]?.[0];
    return word ? `${word} (${name})` : name;
  }

  _iconPanel(key, current) {
    if (!ICON_CATALOG) {
      return `<div class="icon-panel"><p class="hint" role="status">${this._t(this._iconLoadError ? "iconLoadFailed" : "iconLoading")}</p></div>`;
    }
    const lang = this._uiLang() === "en" ? "en" : "cs";
    const cat = this._iconCat || "all";
    this._iconCurrent = current;
    return `
      <div class="icon-panel" data-icon-panel="${key}">
        <input type="search" class="icon-search" data-icon-search="${key}" value="${this._escape(this._iconQuery || "")}"
          placeholder="${this._escape(this._t("iconSearch"))}" aria-label="${this._escape(this._t("pickIcon"))}" autocomplete="off" />
        <div class="icon-cats" role="group" aria-label="${this._escape(this._t("pickIcon"))}">
          <button type="button" class="icon-cat ${cat === "all" ? "on" : ""}" data-icon-cat="all" aria-pressed="${cat === "all"}">${this._t("iconAll")}</button>
          ${ICON_CATALOG.CATEGORIES.map((c) => `
          <button type="button" class="icon-cat ${cat === c.id ? "on" : ""}" data-icon-cat="${c.id}" aria-pressed="${cat === c.id}">${this._escape(c[lang])}</button>`).join("")}
        </div>
        <div class="icon-results" data-icon-results="${key}">${this._iconResults(key, current)}</div>
      </div>`;
  }

  _iconResults(key, current) {
    const { fold, hay, ICON_LIST } = ICON_CATALOG;
    const words = fold(this._iconQuery || "").split(/\s+/).filter(Boolean);
    const cat = this._iconCat || "all";
    const match = (i) => (cat === "all" || i.c === cat) && words.every((w) => hay.get(i.n).includes(w));
    const list = ICON_LIST.filter(match);
    const opt = (i) => `
      <button type="button" role="option" class="icon-opt ${i.n === current ? "on" : ""}" aria-selected="${i.n === current}"
        data-icon-pick="${key}" data-icon="${i.n}" title="${this._escape(this._iconName(i.n))}" aria-label="${this._escape(this._iconName(i.n))}">
        ${iconSvg(i.n, 20)}
      </button>`;
    const recent = !words.length && cat === "all"
      ? readRecentIcons().map((n) => ICON_LIST.find((i) => i.n === n)).filter(Boolean)
      : [];
    if (!list.length) return `<p class="hint icon-empty" role="status">${this._t("iconNone")}</p>`;
    return `
      ${recent.length ? `
        <p class="icon-sub">${this._t("iconRecent")}</p>
        <div class="icon-grid" role="listbox" aria-label="${this._escape(this._t("iconRecent"))}">${recent.map(opt).join("")}</div>
        <p class="icon-sub">${this._t("iconAll")} · ${this._t("iconCount", list.length)}</p>` : ""}
      <div class="icon-grid" role="listbox" aria-label="${this._escape(this._t("pickIcon"))}">${list.map(opt).join("")}</div>`;
  }

  _bindIconPickers() {
    this._on("[data-icon-open]", "click", (e) => {
      const key = e.currentTarget.dataset.iconOpen;
      this._iconOpen = this._iconOpen === key ? null : key;
      this._iconQuery = "";
      this._iconCat = "all";
      this._render();
      if (this._iconOpen) this._focusIconSearch();
    });
    if (this._iconOpen && !ICON_CATALOG) {
      loadIconCatalog()
        .then(() => { this._iconLoadError = false; this._render(); this._focusIconSearch(); })
        .catch((err) => {
          console.warn("[dash] icon catalog failed to load", err);
          this._iconLoadError = true;
          this._render();
        });
    }
    const panel = this.shadowRoot.querySelector("[data-icon-panel]");
    if (!panel) return;
    const key = panel.dataset.iconPanel;
    const results = panel.querySelector("[data-icon-results]");
    const refresh = () => { results.innerHTML = this._iconResults(key, this._iconCurrent); };
    const close = () => {
      this._iconOpen = null;
      this._render();
      this.shadowRoot.querySelector(`[data-icon-open="${CSS.escape(key)}"]`)?.focus();
    };

    const search = panel.querySelector("[data-icon-search]");
    search?.addEventListener("input", () => {
      this._iconQuery = search.value;
      refresh();
    });
    search?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        results.querySelector(".icon-opt")?.focus();
      }
    });
    panel.querySelectorAll("[data-icon-cat]").forEach((chip) => chip.addEventListener("click", () => {
      this._iconCat = chip.dataset.iconCat;
      panel.querySelectorAll("[data-icon-cat]").forEach((c) => {
        const on = c === chip;
        c.classList.toggle("on", on);
        c.setAttribute("aria-pressed", String(on));
      });
      refresh();
    }));
    // picks and keyboard navigation are delegated: the results are re-rendered while typing
    results.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-icon-pick]");
      if (!btn) return;
      this._iconPickers.get(key)?.(btn.dataset.icon);
      pushRecentIcon(btn.dataset.icon);
      close();
    });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      const btn = e.target.closest(".icon-opt");
      if (!btn || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const all = [...results.querySelectorAll(".icon-opt")];
      const i = all.indexOf(btn);
      const grid = btn.parentElement;
      const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
      const next = {
        ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - cols, ArrowDown: i + cols, Home: 0, End: all.length - 1,
      }[e.key];
      if (e.key === "ArrowUp" && next < 0) { search?.focus(); return; }
      all[Math.max(0, Math.min(all.length - 1, next))]?.focus();
    });
  }

  _focusIconSearch() {
    const input = this.shadowRoot.querySelector("[data-icon-search]");
    if (input) {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    }
  }

  /** Icons used in the config that are not in the base set: load the catalog so they render. */
  _ensureConfigIcons() {
    const c = this._config || {};
    const names = [
      ...(c.pages || []).flatMap((p) => [p?.icon, ...(p?.devices || []).map((d) => d?.icon)]),
      ...(c.dock || []).map((d) => d?.icon),
      // default icons of every tile type (the add menu shows them)
      ...Object.values(DEFAULT_DEVICE_ICON),
    ].filter(Boolean);
    if (ICON_CATALOG || names.every((n) => ICONS[n])) return;
    loadIconCatalog().then(() => this._render()).catch((err) => console.warn("[dash] icon catalog failed to load", err));
  }
  _entities(domain) {
    return Object.keys(this._hass?.states || {})
      .filter((id) => id.startsWith(`${domain}.`))
      .sort();
  }

  /** Entities offered for a tile type (registry domains; "*" = all but excludeDomains). */
  _entitiesForType(type) {
    const spec = TILE_TYPES[type];
    if (!spec) return [];
    if (spec.domains.includes("*")) {
      const skip = new Set(spec.excludeDomains || []);
      return Object.keys(this._hass?.states || {}).filter((id) => !skip.has(id.split(".")[0])).sort();
    }
    return spec.domains.flatMap((d) => this._entities(d));
  }
  _on(sel, ev, fn) {
    this.shadowRoot.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
  }

  _styles() {
    return `
      :host {
        --bg: #efe8f4;
        --card: rgba(255,255,255,0.88);
        --text: #1a1220;
        --muted: rgba(26,18,32,0.58);
        --border: rgba(0,0,0,0.1);
        --input-bg: #ffffff;
        --input-text: #111111;
        --accent: #ff6b00;
        --danger-bg: #fee2e2; --danger-text: #991b1b;
        --ok-bg: #dcfce7; --ok-text: #166534;
        --btn: #ffffff; --btn-text: #1a1220;
        --btn-primary: #1a1220; --btn-primary-text: #fff;
        --phone-frame: #1a1220;
        display: block; width: 100%; min-height: 100vh; height: 100%;
        overflow: hidden; background: var(--bg) !important; color: var(--text);
        font-family: system-ui, -apple-system, sans-serif; color-scheme: light;
        box-sizing: border-box;
      }
      :host([dark]) {
        --bg: #0e1014;
        --card: rgba(28,30,36,0.94);
        --text: #f3f4f6;
        --muted: rgba(243,244,246,0.62);
        --border: rgba(255,255,255,0.12);
        --input-bg: #1c1e24; --input-text: #f5f5f5;
        --danger-bg: #3f1d1d; --danger-text: #fecaca;
        --ok-bg: #14532d; --ok-text: #bbf7d0;
        --btn: #2a2d36; --btn-text: #f3f4f6;
        --btn-primary: #ff6b00; --btn-primary-text: #fff;
        --phone-frame: #000;
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      .shell {
        /* Right column sized for iPhone 12 Pro preview (+ a little padding) */
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(420px, 0.72fr);
        gap: 16px; height: 100%; min-height: 100vh; padding: 16px;
      }
      @media (max-width: 1100px) {
        .shell { grid-template-columns: minmax(0, 1fr) 420px; }
      }
      @media (max-width: 980px) {
        :host { overflow: auto; }
        .shell { grid-template-columns: 1fr; grid-template-rows: auto auto; height: auto; }
        .editor { height: auto; max-height: calc(100vh - 32px); }
        .preview { height: max(620px, 85vh); }
      }
      .editor, .preview {
        min-height: 0; height: calc(100vh - 32px);
        background: var(--card); border: 1px solid var(--border); border-radius: 22px;
        overflow: hidden; display: flex; flex-direction: column; position: relative;
      }
      .editor-scroll { overflow: auto; padding: 16px 16px 20px; flex: 1; }
      .editor-footer {
        display: flex; justify-content: flex-end; align-items: center;
        gap: 12px; padding: 14px 16px; border-top: 1px solid var(--border);
        background: color-mix(in srgb, var(--card) 92%, transparent);
        flex-shrink: 0;
      }
      .footer-status { flex: 1; min-width: 0; display: flex; }
      .footer-status .msg {
        margin: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        animation: msg-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2);
      }
      @keyframes msg-in {
        from { opacity: 0; transform: translateY(6px) scale(0.98); }
        to { opacity: 1; transform: none; }
      }
      .btn.save-xl {
        font-size: 1.08rem; font-weight: 700; letter-spacing: -0.01em;
        padding: 16px 34px; min-width: 168px; border-radius: 18px;
        background: var(--accent); color: #fff;
        box-shadow: 0 10px 28px color-mix(in srgb, var(--accent) 35%, transparent);
      }
      .btn.save-xl:disabled { opacity: 0.6; cursor: default; }
      .gear-btn {
        width: 52px; height: 52px; padding: 0; border-radius: 50%; border: 1px solid var(--border);
        background: var(--btn); color: var(--text); display: grid; place-items: center;
        cursor: pointer; font-size: 1.6rem; line-height: 1;
        transition: border-color 0.2s, transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.3);
      }
      .gear-btn:hover { border-color: var(--accent); transform: rotate(45deg); }
      header {
        display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
        justify-content: space-between; margin-bottom: 16px;
      }
      h1 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; }
      .version {
        display: inline-flex; padding: 5px 12px; border-radius: 999px;
        font-size: 0.78rem; font-weight: 700;
        background: color-mix(in srgb, var(--accent) 20%, transparent);
        border: 1px solid var(--border);
      }
      .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .tabs {
        display: flex; gap: 8px; flex-wrap: wrap;
        padding-bottom: 14px; margin-bottom: 18px; border-bottom: 1px solid var(--border);
      }
      .tab-body { animation: tab-in 0.3s ease-out; }
      @keyframes tab-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: none; }
      }
      .toggle-list { display: grid; gap: 2px; }
      .toggle {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 10px 2px; color: var(--text); font-size: 0.92rem; cursor: pointer;
      }
      .toggle input { position: absolute; opacity: 0; pointer-events: none; width: 1px; height: 1px; }
      .toggle .track {
        position: relative; width: 46px; height: 28px; border-radius: 999px; flex-shrink: 0;
        background: color-mix(in srgb, var(--text) 18%, transparent);
        transition: background 0.25s ease;
      }
      .toggle .track::after {
        content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px;
        border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.25);
      }
      .toggle input:checked + .track { background: var(--accent); }
      .toggle input:checked + .track::after { transform: translateX(18px); }
      .toggle input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
      .tab, button, .btn {
        font: inherit; cursor: pointer; border: 0; border-radius: 999px;
        padding: 8px 14px; background: var(--btn); color: var(--btn-text);
      }
      .tab.active, .btn.primary { background: var(--btn-primary); color: var(--btn-primary-text); }
      button:disabled { opacity: 0.4; cursor: default; }
      .btn.danger { background: var(--danger-bg); color: var(--danger-text); }
      .btn.ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }
      .seg {
        display: inline-flex; padding: 3px; border-radius: 999px; gap: 2px;
        background: color-mix(in srgb, var(--btn) 80%, transparent); border: 1px solid var(--border);
      }
      .seg button {
        padding: 6px 10px; border-radius: 999px; background: transparent; color: var(--muted);
      }
      .seg button.active { background: var(--accent); color: #fff; }
      .row {
        display: grid; grid-template-columns: 150px 1fr; gap: 10px;
        align-items: center; margin-bottom: 10px;
      }
      @media (max-width: 640px) { .row { grid-template-columns: 1fr; gap: 4px; } }
      label { font-size: 0.85rem; color: var(--muted); }
      input:not([type="checkbox"], [type="file"]), select, textarea {
        width: 100%; font: inherit; padding: 10px 12px; border-radius: 12px;
        border: 1px solid var(--border);
        background-color: #fff !important; color: #111 !important;
        -webkit-text-fill-color: #111 !important; caret-color: #111 !important;
        opacity: 1 !important; color-scheme: light;
      }
      :host([dark]) input:not([type="checkbox"], [type="file"]), :host([dark]) select, :host([dark]) textarea {
        background-color: #1c1e24 !important; color: #f5f5f5 !important;
        -webkit-text-fill-color: #f5f5f5 !important; caret-color: #f5f5f5 !important;
        color-scheme: dark;
      }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
      .card-list { display: grid; gap: 10px; }
      .device {
        display: grid; gap: 8px; padding: 12px; border-radius: 16px;
        background: color-mix(in srgb, var(--input-bg) 70%, transparent);
        border: 1px solid var(--border);
      }
      .device-grid {
        display: grid; grid-template-columns: 1.2fr 1fr 1.4fr auto;
        gap: 8px; align-items: center;
      }
      @media (max-width: 720px) { .device-grid { grid-template-columns: 1fr; } }
      .msg { margin: 10px 0; padding: 10px 12px; border-radius: 12px; font-size: 0.9rem; }
      .msg.err { background: var(--danger-bg); color: var(--danger-text); }
      .msg.ok { background: var(--ok-bg); color: var(--ok-text); }
      .shell.no-preview { grid-template-columns: minmax(0, 1fr); }
      .shell.no-preview .preview { display: none; }
      .link-box { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
      .link-box code {
        flex: 1 1 220px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        padding: 9px 12px; border-radius: 12px; background: var(--input-bg); border: 1px solid var(--border);
        font-size: 0.85rem;
      }
      .link-box a.btn { text-decoration: none; }
      .msg.warn {
        margin: 0 0 12px; padding: 10px 12px; border-radius: 14px; font-size: 0.85rem; line-height: 1.45;
        background: color-mix(in srgb, #f59e0b 16%, transparent); color: var(--text);
      }
      .standby-body { transition: opacity 0.25s ease; margin-top: 8px; }
      .standby-body.is-off { opacity: 0.45; }
      .clock-sample {
        display: flex; align-items: center; justify-content: center; gap: 2px;
        margin: 6px 0 14px; padding: 18px; border-radius: 24px; background: #000; max-width: 360px;
        font: 900 64px/0.9 ui-rounded, "SF Pro Rounded", system-ui, sans-serif; letter-spacing: -0.04em;
        animation: pop-in 0.3s ease;
      }
      .clock-sample i { width: 10px; height: 26px; margin: 0 6px;
        background: radial-gradient(circle, #8a8a8e 4.5px, transparent 5px) 0 0 / 10px 13px repeat-y; }
      .clock-sample.bold .c0 { color: #c777b8; } .clock-sample.bold .c1 { color: #b47fd4; }
      .clock-sample.bold .c2 { color: #a497f2; } .clock-sample.bold .c3 { color: #8e44a8; }
      .clock-sample.minimal { color: #fff; font-weight: 200; font-family: -apple-system, system-ui, sans-serif; }
      .photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; max-width: 720px; }
      .photo-thumb, .photo-add {
        position: relative; margin: 0; aspect-ratio: 1; border-radius: 18px; overflow: hidden;
        background: color-mix(in srgb, var(--text) 8%, transparent) center / cover no-repeat;
        animation: pop-in 0.3s ease;
      }
      .photo-del {
        position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; padding: 0;
        display: grid; place-items: center; font-size: 16px; line-height: 1;
        background: rgba(0,0,0,0.55); color: #fff; opacity: 0; transition: opacity 0.2s ease;
      }
      .photo-thumb:hover .photo-del, .photo-del:focus-visible { opacity: 1; }
      .photo-add {
        display: grid; place-items: center; cursor: pointer; text-align: center; padding: 8px;
        border: 2px dashed color-mix(in srgb, var(--text) 22%, transparent); background: transparent;
        color: var(--muted); font-size: 0.85rem;
      }
      .photo-add:hover { border-color: var(--accent); color: var(--accent); }
      .photo-add input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
      .icon-picker { position: relative; min-width: 0; }
      .row:has(> .icon-picker), .row:has(> .seg.wrap) { align-items: start; }
      .row:has(> .icon-picker) > label, .row:has(> .seg.wrap) > label { padding-top: 10px; }
      .icon-btn {
        display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px 7px 10px;
        border: 1px solid var(--border); background: var(--input-bg); color: var(--input-text);
      }
      .icon-btn.open { border-color: var(--accent); }
      .icon-btn svg { color: var(--accent); }
      .icon-panel {
        margin-top: 8px; padding: 10px; border-radius: 18px;
        background: var(--input-bg); border: 1px solid var(--border);
        animation: pop-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.1);
      }
      .icon-panel .icon-search { padding: 8px 12px; border-radius: 10px; }
      .icon-panel .icon-search::placeholder { -webkit-text-fill-color: var(--muted) !important; color: var(--muted) !important; opacity: 1; }
      .icon-cats { display: flex; gap: 4px; overflow-x: auto; padding: 8px 0 4px; scrollbar-width: none; }
      .icon-cats::-webkit-scrollbar { display: none; }
      .icon-cat {
        flex: 0 0 auto; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border);
        background: transparent; color: var(--muted); font: inherit; font-size: 0.78rem; cursor: pointer; white-space: nowrap;
      }
      .icon-cat.on { background: var(--accent); border-color: transparent; color: #fff; }
      .icon-results { max-height: 260px; overflow: auto; padding-top: 4px; }
      .icon-sub { margin: 6px 2px 4px; font-size: 0.74rem; color: var(--muted); }
      .icon-empty { margin: 10px 2px; }
      .icon-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 6px;
      }
      .icon-opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      .icon-opt {
        aspect-ratio: 1; display: grid; place-items: center; padding: 0; border-radius: 12px;
        background: transparent; color: var(--text);
      }
      .icon-opt:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
      .icon-opt.on { background: var(--accent); color: #fff; }
      @keyframes pop-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }

      /* Pages editor — mimics the iOS Control Center edit grid */
      .cc-wrap { container-type: inline-size; max-width: 400px; margin: 4px auto 14px; padding: 0 14px; box-sizing: content-box; }
      .cc-actions { justify-content: center; }
      .cc-grid {
        --gap: 10px;
        display: grid; gap: var(--gap); grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-auto-rows: calc((100cqw - 3 * var(--gap)) / 4);
        padding: 14px; border-radius: 30px;
        background: color-mix(in srgb, var(--text) 6%, transparent);
        margin: 0 -14px;
      }
      .cc-tile {
        position: relative; overflow: hidden; min-width: 0; cursor: grab; user-select: none;
        display: flex; flex-direction: column; justify-content: space-between; gap: 4px;
        /* same corners as the app's tiles (daisyUI --radius-box: 2rem, squircle) */
        padding: 10px 12px; border-radius: var(--tile-radius, 2rem); color: var(--text);
        background: var(--card); border: 1px solid var(--border);
        touch-action: pan-y; -webkit-touch-callout: none;
        transition: scale 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 0.2s ease, opacity 0.2s ease;
      }
      .cc-tile:hover { scale: 1.02; }
      .cc-tile.cc-divider {
        flex-direction: row; align-items: center; justify-content: flex-start; gap: 10px;
        padding: 0 6px; background: transparent; border: 1px dashed transparent; border-radius: 14px;
      }
      .cc-tile.cc-divider:hover, .cc-tile.cc-divider.sel { border-color: var(--border); scale: 1; }
      .cc-tile .cc-div-input, :host([dark]) .cc-tile .cc-div-input {
        flex: 0 1 auto; width: auto; min-width: 4ch; max-width: 70%; field-sizing: content;
        border: 0; padding: 4px 2px; border-radius: 6px;
        font-family: inherit; font-size: 0.78rem; font-weight: 600; line-height: 1.2;
        letter-spacing: 0.06em; text-transform: uppercase;
        background-color: transparent !important; color: var(--muted) !important;
        -webkit-text-fill-color: var(--muted) !important;
      }
      .cc-tile .cc-div-input::placeholder {
        -webkit-text-fill-color: var(--muted) !important; opacity: 0.55;
        text-transform: none; letter-spacing: 0; font-weight: 400;
      }
      .cc-tile .cc-div-input:focus, :host([dark]) .cc-tile .cc-div-input:focus {
        outline: 2px solid var(--accent); outline-offset: 1px;
        color: var(--text) !important; -webkit-text-fill-color: var(--text) !important;
      }
      .cc-div-line { flex: 1; height: 1px; background: var(--border); }
      .cc-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .cc-tile.sel { box-shadow: 0 0 0 2.5px var(--accent); }
      .cc-tile.h1 { flex-direction: row; align-items: center; justify-content: flex-start; gap: 10px; }
      @supports (corner-shape: squircle) { .cc-tile { corner-shape: squircle; } }
      .cc-tile.s1 { justify-content: center; align-items: center; padding: 0; }
      .cc-tile .cc-ic {
        position: relative; z-index: 1; width: 34px; height: 34px; flex-shrink: 0;
        display: grid; place-items: center; border-radius: 50%;
        background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent);
      }
      .cc-tile .cc-txt { position: relative; z-index: 1; min-width: 0; display: grid; }
      .cc-tile .cc-lbl { font-size: 0.82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cc-tile .cc-meta { font-size: 0.68rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cc-tile .deco { position: absolute; pointer-events: none; }
      .cc-tile .deco-fill-x { inset: 0 45% 0 0; background: color-mix(in srgb, var(--accent) 22%, transparent); }
      .cc-tile .deco-fill-y { inset: 45% 0 0 0; background: color-mix(in srgb, var(--accent) 22%, transparent); }
      .cc-tile .deco-switch {
        right: 12px; top: 50%; width: 34px; height: 20px; margin-top: -10px; border-radius: 999px;
        background: var(--accent);
      }
      .cc-tile .deco-switch::after {
        content: ""; position: absolute; right: 2px; top: 2px; width: 16px; height: 16px;
        border-radius: 50%; background: #fff;
      }
      .cc-tile .deco-dial { left: 50%; bottom: 10px; transform: translateX(-50%); width: 70%; color: var(--accent); }
      .cc-tile .deco-media {
        right: 12px; bottom: 10px; display: flex; gap: 10px; font-size: 0.8rem; color: var(--muted);
      }
      .cc-tile .deco-cover {
        inset: 0; background: color-mix(in srgb, var(--accent) 16%, transparent);
      }
      .cc-tile .cc-resize {
        position: absolute; right: 0; bottom: 0; z-index: 3; width: 26px; height: 26px; cursor: nwse-resize;
        touch-action: none; opacity: 0; transition: opacity 0.2s ease;
      }
      .cc-tile .cc-resize::before {
        content: ""; position: absolute; right: 6px; bottom: 6px; width: 11px; height: 11px;
        border-right: 3px solid var(--accent); border-bottom: 3px solid var(--accent);
        border-bottom-right-radius: 9px;
      }
      .cc-tile.s1 .cc-resize::before { right: 3px; bottom: 3px; }
      .cc-tile:hover .cc-resize, .cc-tile.sel .cc-resize, .cc-tile.resizing .cc-resize { opacity: 1; }
      @media (hover: none) { .cc-tile .cc-resize { opacity: 0.8; } }
      .cc-tile.resizing { box-shadow: 0 0 0 2.5px var(--accent), 0 10px 30px rgba(0,0,0,0.18); }
      .cc-grid.is-resizing, .cc-grid.is-resizing .cc-tile { cursor: nwse-resize; }
      .cc-grid.is-dragging .cc-tile:not(.dragging) { animation: cc-wiggle 0.28s ease-in-out infinite alternate; }
      .cc-grid.is-dragging .cc-tile:nth-child(2n) { animation-delay: -0.14s; }
      .cc-tile.dragging {
        z-index: 5; cursor: grabbing; pointer-events: none;
        transform: translate(var(--tx, 0), var(--ty, 0)) scale(1.06);
        box-shadow: 0 18px 40px rgba(0,0,0,0.25); opacity: 0.94;
      }
      @keyframes cc-wiggle { from { rotate: -1.2deg; } to { rotate: 1.2deg; } }
      /* vinyl style preview: 33⅓ rpm, always on in the editor */
      .vinyl-mini { animation: vinyl-spin 1.8s linear infinite; color: var(--text); }
      @keyframes vinyl-spin { to { transform: rotate(360deg); } }
      .cc-tile .deco-vinyl { right: 12px; top: 12px; width: 44%; height: auto; aspect-ratio: 1; }
      .seg .vinyl-mini { width: 16px; height: 16px; vertical-align: -3px; margin-right: 6px; }
      @media (prefers-reduced-motion: reduce) {
        .cc-grid.is-dragging .cc-tile { animation: none !important; }
        .vinyl-mini { animation: none; }
      }
      /* Music tab */
      .music-list { list-style: none; margin: 4px 0 8px; padding: 0; display: grid; gap: 4px; }
      .music-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); }
      .music-list code { font-size: 0.75rem; color: var(--muted); }
      .muted { color: var(--muted); font-size: 0.8rem; }
      .station-list { list-style: none; margin: 4px 0; padding: 0; display: grid; gap: 6px; }
      .station { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 0; }
      .station .grip { cursor: grab; color: var(--muted); user-select: none; }
      .station input, .station-add input, .copy-row input {
        min-width: 0; padding: 7px 10px; border-radius: 10px; font: inherit; font-size: 0.85rem;
        border: 1px solid var(--border); background: var(--input-bg); color: var(--text);
      }
      .station input[data-st-name] { flex: 0 1 160px; }
      .station input[data-st-url] { flex: 1 1 220px; }
      .st-status { min-width: 64px; font-size: 0.78rem; color: var(--muted); }
      .station-add, .copy-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
      .station-add input { flex: 1 1 160px; }
      .field-error { margin: 4px 0; color: var(--danger-text); font-size: 0.82rem; }
      .ok-line { margin: 6px 0; font-weight: 600; }
      .lib-services { display: grid; gap: 4px; }
      .lib-svc { padding: 8px 0; border-bottom: 1px solid var(--border); }
      .lib-svc-head { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
      .lib-svc input { min-width: 0; flex: 1 1 160px; padding: 7px 10px; border-radius: 10px; font: inherit; font-size: 0.85rem;
        border: 1px solid var(--border); background: var(--input-bg); color: var(--text); }
      .wizard { margin: 6px 0 0; padding-left: 20px; display: grid; gap: 10px; font-size: 0.9rem; }
      .wizard code { padding: 2px 0; font-size: 0.8rem; word-break: break-all; }
      .copy-row input { flex: 1 1 220px; font-family: ui-monospace, monospace; }
      .inspector {
        display: grid; gap: 2px; padding: 14px 16px 6px; border-radius: 22px; max-width: 560px; margin: 0 auto;
        background: color-mix(in srgb, var(--input-bg) 70%, transparent); border: 1px solid var(--border);
        animation: pop-in 0.22s ease;
      }
      .inspector-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .ent-pick { display: grid; gap: 6px; min-width: 0; }
      .ent-list { display: grid; gap: 2px; max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 14px; padding: 6px; }
      .ent-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 5px 6px; border-radius: 10px; cursor: pointer; }
      .ent-item:hover { background: var(--btn); }
      .ent-item code { font-size: 0.72rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ent-count { margin: 0; }
      .add-menu { display: grid; gap: 12px; max-width: 560px; margin: 4px auto 14px; animation: pop-in 0.18s ease; }
      .add-group { display: grid; gap: 6px; }
      .add-group-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
      .add-items { display: flex; flex-wrap: wrap; gap: 6px; }
      .add-item {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px;
        background: var(--btn); border: 1px solid var(--border); color: var(--text); font: inherit; cursor: pointer;
      }
      .add-item:hover, .add-item:focus-visible { border-color: var(--accent); outline: none; }
      .inspector-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .inspector-head .btn { padding: 6px 12px; font-size: 0.82rem; }
      .seg.wrap { flex-wrap: wrap; border-radius: 18px; }
      .pill svg { vertical-align: -3px; margin-right: 4px; }
      .hint { font-size: 0.85rem; color: var(--muted); margin: 0 0 12px; line-height: 1.4; }
      .page-pills { position: relative; display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
      .pill {
        padding: 6px 12px; border-radius: 999px; background: var(--btn);
        border: 1px solid var(--border); color: var(--text); font: inherit; cursor: pointer;
      }
      .pill.active { background: var(--accent); color: #fff; border-color: transparent; }
      .page-pills .pill { touch-action: pan-y; user-select: none; -webkit-user-select: none; }
      .page-pills .pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .page-pills .pill.lifting { transform: scale(1.06); box-shadow: 0 6px 18px rgba(0,0,0,0.16); transition: transform 0.15s ease; }
      .page-pills .pill.dragging {
        position: relative; z-index: 3; pointer-events: none; opacity: 0.92;
        transform: translate(var(--tx, 0px), var(--ty, 0px)) scale(1.06);
        box-shadow: 0 10px 26px rgba(0,0,0,0.2);
      }
      .page-pills.is-dragging { cursor: grabbing; }
      .pill-drop {
        position: absolute; z-index: 4; width: 3px; border-radius: 2px; background: var(--accent);
        pointer-events: none; display: none;
      }
      .page-pills.is-dragging .pill-drop.on { display: block; }
      .pills-hint { font-size: 0.78rem; color: var(--muted); margin: 0 0 12px; }
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
      }
      .danger-zone { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); display: grid; gap: 14px; justify-items: start; }
      .confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .confirm-q { font-weight: 600; }
      .btn.quiet { background: transparent; border: 0; padding: 4px 0; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; font-size: 0.85rem; }
      .btn.quiet:hover { color: var(--danger-text); }
      @media (prefers-reduced-motion: reduce) {
        .page-pills .pill.lifting, .page-pills .pill.dragging { transition: none; }
      }
      h3 { margin: 18px 0 8px; font-size: 1rem; }
      .count { color: var(--muted); font-size: 0.8rem; }
      .preview-head {
        display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px;
        padding: 12px 14px; border-bottom: 1px solid var(--border);
      }
      .preview-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; width: 100%; }
      .preview-controls select {
        min-width: 0; flex: 1 1 180px; padding: 7px 10px; border-radius: 10px; font: inherit; font-size: 0.85rem;
        border: 1px solid var(--border); background: var(--input-bg); color: var(--text);
      }
      .preview-controls .seg button { padding: 6px 10px; font-size: 0.8rem; }
      .preview-custom { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; font-size: 0.8rem; }
      .preview-custom[hidden] { display: none; }
      .preview-custom input { width: 76px; padding: 6px 8px; border-radius: 8px; font: inherit; border: 1px solid var(--border); background: var(--input-bg); color: var(--text); }
      .preview-custom details { width: 100%; }
      .preview-custom summary { cursor: pointer; color: var(--muted); }
      .preview-custom .safe-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      .preview-custom .field-error { width: 100%; margin: 0; color: var(--danger-text); }
      .preview-head strong { font-size: 0.92rem; }
      .rotate-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 14px; border: 1px solid var(--border); font-size: 0.85rem;
      }
      .rotate-btn svg { transition: transform 0.7s cubic-bezier(0.3, 1.2, 0.4, 1); }
      .rotate-btn[data-orient="landscape"] svg { transform: rotate(-90deg); }
      .preview-body {
        flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px 14px 12px;
        background: var(--bg);
      }
      .stage {
        position: relative; flex: 1; min-height: 0; width: 100%;
        animation: stage-in 0.7s cubic-bezier(0.2, 0.9, 0.25, 1) both;
      }
      /* 100 %: real size, the preview column scrolls */
      .stage.actual { overflow: auto; }
      .stage.actual .iphone { position: relative; left: auto; top: auto; margin: 8px auto; transform: rotate(var(--r)); }
      @keyframes stage-in {
        from { opacity: 0; transform: translateY(18px); filter: blur(6px); }
        to { opacity: 1; transform: none; filter: none; }
      }
      /*
       * The device frame (www/devices.js preset or a custom size). The screen is
       * the real CSS px size (--sw × --sh, set from JS); --s scales the whole
       * frame to fit. Rotation: the frame is turned by ±90° (which visually is the
       * other box), then the layout swaps with no transition.
       */
      .iphone {
        --ow: 413px; --oh: 872px; --bezel: 10px; --radius: 55px; --safe-t: 59px;
        --s: 1; --r: 0deg;
        --screen-bg: #f3f0f7; --status-fg: #000;
        position: absolute; left: 50%; top: 50%;
        width: var(--ow); height: var(--oh); padding: var(--bezel);
        border-radius: calc(var(--radius) + var(--bezel));
        transform: translate(-50%, -50%) scale(var(--s)) rotate(var(--r));
        transition: transform 0.75s cubic-bezier(0.32, 0.72, 0, 1);
        background: #2a2a2c;
        box-shadow:
          inset 0 0 0 1.5px rgba(255,255,255,0.22),
          inset 0 0 0 4px #111,
          0 2px 0 rgba(255,255,255,0.06),
          0 40px 80px -24px rgba(0,0,0,0.5),
          0 18px 30px -18px rgba(0,0,0,0.45);
        will-change: transform;
      }
      .iphone.no-anim { transition: none; }
      .iphone[data-frame="wall"], .iphone[data-frame="tablet"], .iphone[data-frame="custom"] {
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 30px 60px -24px rgba(0,0,0,0.45);
      }
      .iphone[data-frame="wall"] { background: #1c1c1e; }
      .iphone[data-mode="dark"] { --screen-bg: #0e1014; --status-fg: #fff; }
      .iphone-screen {
        position: relative; width: 100%; height: 100%; overflow: hidden;
        border-radius: var(--radius); background: var(--screen-bg);
        transition: background 0.4s ease;
      }
      /* Full-screen like a real PWA; the page gets the safe-area insets via postMessage. */
      .iphone iframe {
        position: absolute; inset: 0; width: 100%; height: 100%;
        border: 0; display: block; background: transparent;
      }
      .ios-status {
        position: absolute; top: 0; left: 0; right: 0; height: var(--safe-t); z-index: 2;
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 30px 0 46px; color: var(--status-fg);
        font: 600 17px/1 -apple-system, "SF Pro Text", system-ui, sans-serif;
        letter-spacing: -0.01em; pointer-events: none;
      }
      .ios-status .ios-icons { display: flex; gap: 6px; align-items: center; }
      .ios-status svg { display: block; fill: currentColor; }
      .iphone[data-orient="landscape"] .ios-status,
      .iphone:not([data-frame="island"]):not([data-frame="notch"]):not([data-frame="home"]) .ios-status { display: none; }
      .iphone:not([data-frame="island"]):not([data-frame="notch"]):not([data-frame="punch"]) .island,
      .iphone:not([data-frame="island"]):not([data-frame="notch"]) .home-ind { display: none; }
      .iphone[data-frame="notch"][data-orient="portrait"] .island { top: 0; width: 160px; height: 31px; border-radius: 0 0 20px 20px; }
      .iphone[data-frame="punch"] .island { top: 12px; width: 12px; height: 12px; }
      .iphone[data-frame="punch"][data-orient="landscape"] .island { left: 12px; top: 50%; width: 12px; height: 12px; }
      .island {
        position: absolute; left: 50%; top: 11px; width: 126px; height: 37px;
        transform: translateX(-50%); border-radius: 999px; background: #000; pointer-events: none;
        z-index: 3;
      }
      .iphone[data-orient="landscape"] .island {
        left: 11px; top: 50%; width: 37px; height: 126px; transform: translateY(-50%);
      }
      .home-ind {
        position: absolute; left: 50%; bottom: 8px; width: 134px; height: 5px;
        transform: translateX(-50%); border-radius: 999px;
        background: var(--status-fg); opacity: 0.85; pointer-events: none; z-index: 3;
      }
      .iphone[data-orient="landscape"] .home-ind { width: 210px; bottom: 6px; }
      .screen-empty {
        position: absolute; inset: 0; display: grid; place-items: center; padding: 40px;
        text-align: center; color: var(--muted); font-size: 0.95rem; line-height: 1.45;
      }
      .phone-meta {
        text-align: center; font-size: 0.72rem; color: var(--muted);
        letter-spacing: 0.02em; flex-shrink: 0; padding-top: 10px;
      }
    `;
  }

  /** Builds the static shell once; the preview column is never re-created. */
  _ensureShell() {
    if (this.shadowRoot.getElementById("editorHost")) return;
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="shell">
        <section class="editor" id="editorHost"></section>
        <aside class="preview">
          <div class="preview-head">
            <strong id="previewTitle"></strong>
            <button type="button" class="btn ghost rotate-btn" id="rotatePreview" data-orient="${this._orient}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="3"/><path d="M11 18h2"/></svg>
              <span></span>
            </button>
            <div class="preview-controls">
              <select id="previewDevice" aria-label=""></select>
              <div class="seg" id="previewScale" role="group">
                <button type="button" data-scale="fit"></button>
                <button type="button" data-scale="100"></button>
              </div>
            </div>
            <div class="preview-custom" id="previewCustom" hidden>
              <label><span data-l="customW"></span> <input type="number" id="customW" min="${CUSTOM_MIN}" max="${CUSTOM_MAX}" step="1" inputmode="numeric" /></label>
              <span aria-hidden="true">×</span>
              <label><span data-l="customH"></span> <input type="number" id="customH" min="${CUSTOM_MIN}" max="${CUSTOM_MAX}" step="1" inputmode="numeric" /></label>
              <button type="button" class="btn ghost" id="customSwap" data-l="swapWH"></button>
              <p class="field-error" id="customError" role="alert" hidden></p>
              <details id="customSafeBox">
                <summary data-l="customSafe"></summary>
                <div class="safe-grid">
                  ${["t", "r", "b", "l"].map((k) => `<label><span data-l="safe${k.toUpperCase()}"></span> <input type="number" min="0" max="400" step="1" data-safe="${k}" /></label>`).join("")}
                </div>
              </details>
            </div>
          </div>
          <div class="preview-body">
            <div class="stage" id="previewStage">
              <div class="iphone" id="iphone" data-orient="${this._orient}">
                <div class="iphone-screen">
                  <div class="ios-status">
                    <span class="ios-time"></span>
                    <span class="ios-icons">
                      <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
                      <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M8 2.6c2.3 0 4.4.9 6 2.4l1.2-1.3A10.3 10.3 0 0 0 8 .8C5.2.8 2.7 1.9.8 3.7L2 5c1.6-1.5 3.7-2.4 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4.4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Zm0 3.6c.4 0 .8.1 1 .4L8 11.4 7 10.2c.3-.3.6-.4 1-.4Z"/></svg>
                      <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x="0.5" y="0.5" width="22" height="12" rx="3.8" fill="none" stroke="currentColor" opacity="0.4"/><rect x="2" y="2" width="19" height="9" rx="2.5"/><path d="M24 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" opacity="0.45"/></svg>
                    </span>
                  </div>
                  <iframe title="Guest dashboard live preview" allow="fullscreen; autoplay; encrypted-media" hidden></iframe>
                  <div class="screen-empty" hidden></div>
                  <div class="island"></div>
                  <div class="home-ind"></div>
                </div>
              </div>
            </div>
            <div class="phone-meta" id="phoneMeta"></div>
          </div>
        </aside>
      </div>
    `;
    this.shadowRoot.getElementById("rotatePreview").addEventListener("click", () => this._rotatePreview());
    this._bindPreviewControls();
    const frame = this.shadowRoot.querySelector("#iphone iframe");
    frame.addEventListener("load", () => this._postSafeArea());
    this._onFrameMessage = (e) => {
      if (e.source !== frame.contentWindow) return;
      if (e.data?.type === "guest-ha:ready") {
        this._postSafeArea();
        this._draftSent = "";
        this._pushDraft();
      }
      if (e.data?.type === "guest-ha:auth-request") this._postAuth(e.origin);
    };
    // typing in an input changes the draft without a re-render
    this.shadowRoot.getElementById("editorHost").addEventListener("input", () => this._pushDraft());
    this._attachShellObservers();
    this._tickStatusClock();
  }

  /** Idempotent: also re-attaches after HA detaches and re-attaches the panel. */
  _attachShellObservers() {
    const stage = this.shadowRoot.getElementById("previewStage");
    if (!stage) return;
    window.addEventListener("message", this._onFrameMessage);
    if (!this._resizeObs) {
      this._resizeObs = new ResizeObserver(() => {
        if (!this._rotating) this._fitPreview();
      });
      this._resizeObs.observe(stage);
    }
  }

  /**
   * The preview signs in with this panel's session: a short-lived access token,
   * sent only to the origin of the configured dashboard URL (never the refresh token).
   */
  async _postAuth(origin) {
    const frame = this.shadowRoot?.querySelector("#iphone iframe");
    const auth = this._hass?.auth;
    if (!frame?.contentWindow || !auth?.data) return;
    let expected = "";
    try {
      expected = new URL(this._livePreviewSrc).origin;
    } catch {
      return;
    }
    if (origin !== expected) return;
    try {
      if (auth.expired) await auth.refreshAccessToken();
    } catch {
      return;
    }
    frame.contentWindow.postMessage({
      type: "guest-ha:auth",
      hassUrl: auth.data.hassUrl || window.location.origin,
      access_token: auth.data.access_token,
      expires: auth.data.expires,
    }, expected);
  }

  /**
   * `{ type: "dash-preview", ... }` to the preview iframe, addressed to the
   * dashboard's own origin only (the page checks ours: src/lib/previewBridge.js).
   */
  _postPreview(data) {
    const frame = this.shadowRoot?.querySelector("#iphone iframe");
    if (!frame?.contentWindow || !this._livePreviewSrc) return;
    let origin = "";
    try {
      origin = new URL(this._livePreviewSrc, window.location.href).origin;
    } catch {
      return;
    }
    frame.contentWindow.postMessage({ type: "dash-preview", ...data }, origin);
  }

  /**
   * The preview shows the draft at once (before Uložit): after every render or
   * grid change, at most once per frame, only when the config changed.
   */
  _pushDraft() {
    if (this._draftQueued) return;
    this._draftQueued = true;
    requestAnimationFrame(() => {
      this._draftQueued = false;
      let json = "";
      try {
        json = JSON.stringify(this._config);
      } catch {
        return;
      }
      if (json === this._draftSent) return;
      this._draftSent = json;
      this._postPreview({ config: JSON.parse(json) });
    });
  }

  /** env(safe-area-inset-*) is 0 inside an iframe, so hand the page the simulated insets. */
  _postSafeArea() {
    this._postPreview({ safe: this._deviceSafe(this._orient) });
  }

  /** Current preset (www/devices.js) or the custom size, as one shape. */
  _device() {
    if (this._dev.id === "custom") {
      const { w, h, safe } = this._dev.custom;
      return { id: "custom", label: this._t("devCustom"), group: "custom", w, h, frame: "custom", safe: { portrait: safe, landscape: safe }, custom: true };
    }
    return DEVICE_PRESETS.find((d) => d.id === this._dev.id) || DEVICE_PRESETS.find((d) => d.id === DEFAULT_DEVICE) || DEVICE_PRESETS[0];
  }

  /** Screen size in CSS px for an orientation (custom: exactly as typed in portrait). */
  _screenSize(orient) {
    const d = this._device();
    return orient === "landscape" ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
  }

  _deviceSafe(orient) {
    const d = this._device();
    const s = (orient === "landscape" ? d.safe?.landscape : d.safe?.portrait) || {};
    return { t: s.t || 0, r: s.r || 0, b: s.b || 0, l: s.l || 0 };
  }

  _saveDevice() {
    this._dev.orient = this._orient;
    try {
      localStorage.setItem(DEVICE_KEY, JSON.stringify(this._dev));
    } catch {
      /* storage blocked: the choice lasts for this session */
    }
  }

  /** Frame size, bezel and screen size as CSS variables on the frame. */
  _applyDevice() {
    const phone = this.shadowRoot?.getElementById("iphone");
    if (!phone) return;
    const d = this._device();
    const m = FRAME_METRICS[d.frame] || FRAME_METRICS.custom;
    const { w, h } = this._screenSize(this._orient);
    phone.dataset.frame = d.frame;
    phone.dataset.device = d.id;
    phone.style.setProperty("--ow", `${w + m.bezel * 2}px`);
    phone.style.setProperty("--oh", `${h + m.bezel * 2}px`);
    phone.style.setProperty("--bezel", `${m.bezel}px`);
    phone.style.setProperty("--radius", `${m.radius}px`);
    phone.style.setProperty("--safe-t", `${this._deviceSafe("portrait").t}px`);
    this.shadowRoot.getElementById("previewStage")?.classList.toggle("actual", this._dev.scale === "100");
  }

  /** Device dropdown, scale switch and custom size: built once, kept in sync. */
  _bindPreviewControls() {
    const root = this.shadowRoot;
    const select = root.getElementById("previewDevice");
    const relayout = () => {
      this._saveDevice();
      this._applyDevice();
      this._fitPreview();
      this._postSafeArea();
      this._renderPreview();
    };
    select.addEventListener("change", () => {
      const id = select.value;
      if (id !== "custom" && !DEVICE_PRESETS.some((d) => d.id === id)) return;
      this._dev.id = id;
      // wall displays are shown wide
      const preset = DEVICE_PRESETS.find((d) => d.id === id);
      this._orient = preset?.landscape ? "landscape" : preset ? "portrait" : this._orient;
      root.getElementById("rotatePreview").dataset.orient = this._orient;
      root.getElementById("iphone").dataset.orient = this._orient;
      relayout();
    });
    root.getElementById("previewScale").addEventListener("click", (e) => {
      const s = e.target.closest("[data-scale]")?.dataset.scale;
      if (s !== "fit" && s !== "100") return;
      this._dev.scale = s;
      relayout();
    });
    const wIn = root.getElementById("customW");
    const hIn = root.getElementById("customH");
    const err = root.getElementById("customError");
    const applySize = () => {
      const w = Number(wIn.value);
      const h = Number(hIn.value);
      const ok = [w, h].every((v) => Number.isInteger(v) && v >= CUSTOM_MIN && v <= CUSTOM_MAX);
      err.hidden = ok;
      err.textContent = ok ? "" : this._t("customInvalid");
      if (!ok) return;
      // typed as seen: in landscape the first number is still the width
      const [pw, ph] = this._orient === "landscape" ? [h, w] : [w, h];
      this._dev.custom.w = pw;
      this._dev.custom.h = ph;
      relayout();
    };
    wIn.addEventListener("change", applySize);
    hIn.addEventListener("change", applySize);
    root.getElementById("customSwap").addEventListener("click", () => {
      [wIn.value, hIn.value] = [hIn.value, wIn.value];
      applySize();
    });
    root.querySelectorAll("[data-safe]").forEach((input) => {
      input.addEventListener("change", () => {
        const v = Number(input.value);
        this._dev.custom.safe[input.dataset.safe] = Number.isInteger(v) && v >= 0 && v <= 400 ? v : 0;
        relayout();
      });
    });
  }

  /** Labels, options and values of the preview controls (no listeners). */
  _renderPreviewControls() {
    const root = this.shadowRoot;
    const select = root.getElementById("previewDevice");
    if (!select) return;
    select.setAttribute("aria-label", this._t("previewDevice"));
    const groups = ["phone", "tablet", "wall"].map((g) => `
      <optgroup label="${this._escape(this._t(`devGroup_${g}`))}">
        ${DEVICE_PRESETS.filter((d) => d.group === g).map((d) => `<option value="${d.id}">${this._escape(d.label)}</option>`).join("")}
      </optgroup>`).join("");
    const html = `${groups}<optgroup label="${this._escape(this._t("devGroup_custom"))}"><option value="custom">${this._escape(this._t("devCustom"))}</option></optgroup>`;
    if (select.dataset.lang !== this._uiLang()) {
      select.innerHTML = html;
      select.dataset.lang = this._uiLang();
    }
    select.value = this._dev.id;
    const scale = root.getElementById("previewScale");
    scale.setAttribute("aria-label", this._t("previewScale"));
    scale.querySelectorAll("[data-scale]").forEach((b) => {
      b.textContent = this._t(b.dataset.scale === "fit" ? "scaleFit" : "scale100");
      b.classList.toggle("active", b.dataset.scale === this._dev.scale);
      b.setAttribute("aria-pressed", String(b.dataset.scale === this._dev.scale));
    });
    root.querySelectorAll("#previewCustom [data-l]").forEach((el) => { el.textContent = this._t(el.dataset.l); });
    const custom = root.getElementById("previewCustom");
    custom.hidden = this._dev.id !== "custom";
    const { w, h } = this._screenSize(this._orient);
    const wIn = root.getElementById("customW");
    const hIn = root.getElementById("customH");
    if (root.activeElement !== wIn) wIn.value = String(w);
    if (root.activeElement !== hIn) hIn.value = String(h);
    root.querySelectorAll("[data-safe]").forEach((input) => {
      if (root.activeElement !== input) input.value = String(this._dev.custom.safe[input.dataset.safe] || 0);
    });
  }

  _orientBox(orient) {
    const d = this._device();
    const { bezel } = FRAME_METRICS[d.frame] || FRAME_METRICS.custom;
    const { w, h } = this._screenSize(orient);
    return { w: w + bezel * 2, h: h + bezel * 2 };
  }

  _fitScale(orient) {
    const stage = this.shadowRoot.getElementById("previewStage");
    if (!stage) return 1;
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return 1;
    if (this._dev.scale === "100") return 1;
    const box = this._orientBox(orient);
    return Math.min((width - 8) / box.w, (height - 8) / box.h, 1);
  }

  _fitPreview() {
    const phone = this.shadowRoot.getElementById("iphone");
    phone?.style.setProperty("--s", String(this._fitScale(this._orient)));
  }

  /**
   * Turn the portrait frame by ±90° (its rotated bounding box equals the
   * landscape box), then swap to the real landscape layout without a transition.
   * Only CSS changes — the iframe stays mounted, so the page never reloads.
   */
  _rotatePreview() {
    const phone = this.shadowRoot.getElementById("iphone");
    if (!phone || this._rotating) return;
    const next = this._orient === "portrait" ? "landscape" : "portrait";
    this._rotating = true;
    this.shadowRoot.getElementById("rotatePreview").dataset.orient = next;
    phone.style.setProperty("--s", String(this._fitScale(next)));
    phone.style.setProperty("--r", next === "landscape" ? "-90deg" : "90deg");

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      phone.removeEventListener("transitionend", onEnd);
      phone.classList.add("no-anim");
      this._orient = next;
      this._saveDevice();
      phone.dataset.orient = next;
      this._applyDevice();
      this._postSafeArea();
      phone.style.setProperty("--r", "0deg");
      void phone.offsetWidth;
      phone.classList.remove("no-anim");
      this._rotating = false;
      this._renderPreview();
    };
    const onEnd = (e) => {
      if (e.target === phone && e.propertyName === "transform") finish();
    };
    phone.addEventListener("transitionend", onEnd);
    setTimeout(finish, 1000);
  }

  _tickStatusClock() {
    const el = this.shadowRoot?.querySelector(".ios-time");
    if (!el) return;
    const now = new Date();
    let h = now.getHours();
    if (this._uiLang() === "en") h = h % 12 || 12;
    el.textContent = `${h}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  /**
   * Detaching an iframe from the DOM always reloads it, so it lives in the
   * static shell and only its src changes — solely when the dashboard URL changes.
   */
  _renderPreview() {
    const title = this.shadowRoot.getElementById("previewTitle");
    if (title) title.textContent = this._t("previewTitle");
    const rotate = this.shadowRoot.querySelector("#rotatePreview span");
    if (rotate) rotate.textContent = this._orient === "portrait" ? this._t("rotateLandscape") : this._t("rotatePortrait");
    const meta = this.shadowRoot.getElementById("phoneMeta");
    const d = this._device();
    const { w: sw, h: sh } = this._screenSize(this._orient);
    const notes = [
      d.sizeSource === "typical" ? this._t("previewTypical") : d.sizeSource === "playwright-viewport" ? this._t("previewViewport") : "",
      d.safeApprox ? this._t("previewApprox") : "",
    ].filter(Boolean);
    if (meta) meta.textContent = [this._t("previewMeta", d.label, sw, sh), ...notes].join(" · ");
    this._applyDevice();
    this._renderPreviewControls();

    const phone = this.shadowRoot.getElementById("iphone");
    if (!phone) return;
    phone.dataset.mode = this._liveMode;
    if (!this._rotating) this._fitPreview();
    this._tickStatusClock();

    const frame = phone.querySelector("iframe");
    const empty = phone.querySelector(".screen-empty");
    const src = this._livePreviewSrc;
    empty.hidden = Boolean(src);
    empty.textContent = this._t("previewEmpty");
    frame.hidden = !src;
    if (src && frame.getAttribute("src") !== src) frame.setAttribute("src", src);
  }

  /** Full config page for panel chrome (not a popup). */
  _renderUiSettings() {
    return `
      <button type="button" class="btn ghost" id="backFromSettings" style="margin-bottom:12px">${this._t("uiSettingsBack")}</button>
      <h3 style="margin-top:0">${this._t("uiSettings")}</h3>
      <p class="hint">${this._t("uiSettingsHint")}</p>
      <div class="row"><label>${this._t("uiTheme")}</label>
        <div class="seg">
          <button type="button" data-ui-theme="light" class="${this._uiTheme === "light" ? "active" : ""}">Light</button>
          <button type="button" data-ui-theme="dark" class="${this._uiTheme === "dark" ? "active" : ""}">Dark</button>
          <button type="button" data-ui-theme="auto" class="${this._uiTheme === "auto" ? "active" : ""}">Auto</button>
        </div>
      </div>
      <div class="row"><label>${this._t("uiLanguage")}</label>
        <div class="seg">
          <button type="button" data-ui-lang="auto" class="${this._uiLangPref === "auto" ? "active" : ""}">${this._t("langAuto")}</button>
          <button type="button" data-ui-lang="cs" class="${this._uiLangPref === "cs" ? "active" : ""}">${this._t("langCs")}</button>
          <button type="button" data-ui-lang="en" class="${this._uiLangPref === "en" ? "active" : ""}">${this._t("langEn")}</button>
        </div>
      </div>
      <div class="toggle-list" style="max-width:520px">
        ${this._toggle('id="uiPreview"', this._previewOn, this._t("uiPreview"))}
      </div>
    `;
  }

  _render() {
    this._syncTheme();
    this._ensureShell();
    this._pushDraft();
    this.shadowRoot.querySelector(".shell").classList.toggle("no-preview", !this._previewOn);
    const c = this._config;
    if (!c.appearance) c.appearance = { mode: "light", accent: "#ff6b00" };
    this._ensureDock();
    const page = c.pages[this._pageIdx];
    this._iconPickers.clear();
    const locale = this._uiLang() === "en" ? "en-US" : "cs-CZ";
    const onSettings = this._tab === "ui";
    // Guest passes save every change at once; the dashboard Save does not apply there
    const noFooter = onSettings || this._tab === "guests";

    const scrollEl = this.shadowRoot.querySelector(".editor-scroll");
    const scrollTop = scrollEl?.scrollTop || 0;
    const activeId = this.shadowRoot.activeElement?.id || null;

    const status = this._error
      ? `<div class="msg err" title="${this._escape(this._error)}">${this._escape(this._error)}</div>`
      : this._savedAt
        ? `<div class="msg ok">${this._t("saved")} ${this._savedAt.toLocaleTimeString(locale)}</div>`
        : "";
    const tabs = [
      ["general", "tabGeneral"],
      ["pages", "tabPages"],
      ["dock", "tabDock"],
      ["guest", "tabGuest"],
      ["guests", "tabGuests"],
      ["standby", "tabStandby"],
      ["music", "tabMusic"],
      ["library", "tabLibrary"],
      ["styles", "tabStyles"],
    ];
    const tabChanged = this._lastTab !== this._tab;
    this._lastTab = this._tab;

    this.shadowRoot.getElementById("editorHost").innerHTML = `
          <div class="editor-scroll">
            <header>
              <h1>${this._t("title")}</h1>
              <div class="toolbar">
                <span class="version">v${PANEL_VERSION}</span>
                ${onSettings ? "" : `<button type="button" class="gear-btn" id="openSettings" title="${this._escape(this._t("uiSettings"))}" aria-label="${this._escape(this._t("uiSettings"))}">⚙</button>`}
              </div>
            </header>

            ${onSettings ? this._renderUiSettings() : `
            <div class="tabs">
              ${tabs.map(([id, key]) => `<button class="tab ${this._tab === id ? "active" : ""}" data-tab="${id}">${this._t(key)}</button>`).join("")}
            </div>

            <div class="${tabChanged ? "tab-body" : ""}">
              ${this._tab === "general" ? this._renderGeneral(c) : ""}
              ${this._tab === "guest" ? this._renderGuest(c) : ""}
              ${this._tab === "pages" ? this._renderPages(c, page) : ""}
              ${this._tab === "dock" ? this._renderDock(c) : ""}
              ${this._tab === "styles" ? this._renderStyles(c) : ""}
              ${this._tab === "standby" ? this._renderStandby(c) : ""}
              ${this._tab === "music" ? this._renderMusic(c) : ""}
              ${this._tab === "library" ? this._renderLibrary(c) : ""}
              ${this._tab === "guests" ? this._guests.render() : ""}
            </div>
            `}
          </div>
          ${noFooter ? "" : `
          <div class="editor-footer">
            <div class="footer-status">${status}</div>
            <button class="btn save-xl" id="save" ${this._saving ? "disabled" : ""}>${this._saving ? this._t("saving") : this._t("save")}</button>
          </div>`}
    `;

    this._renderPreview();

    const nextScroll = this.shadowRoot.querySelector(".editor-scroll");
    if (nextScroll) nextScroll.scrollTop = scrollTop;
    if (activeId) {
      const el = this.shadowRoot.getElementById(activeId);
      if (el && typeof el.focus === "function") {
        try { el.focus({ preventScroll: true }); } catch { el.focus(); }
      }
    }

    this._on(".tab", "click", (e) => {
      this._tab = e.currentTarget.dataset.tab;
      this._info = null;
      this._iconOpen = null;
      this._confirm = null;
      this._render();
    });
    this.shadowRoot.getElementById("save")?.addEventListener("click", () => this._save());
    this.shadowRoot.getElementById("openSettings")?.addEventListener("click", () => {
      this._tab = "ui";
      this._info = null;
      this._render();
    });
    this.shadowRoot.getElementById("backFromSettings")?.addEventListener("click", () => {
      this._tab = "general";
      this._render();
    });
    this._on("[data-ui-lang]", "click", (e) => {
      const v = e.currentTarget.dataset.uiLang;
      this._uiLangPref = v === "en" || v === "cs" ? v : "auto";
      localStorage.setItem(UI_LANG_KEY, this._uiLangPref);
      this._render();
    });
    this._on("[data-ui-theme]", "click", (e) => {
      this._uiTheme = e.currentTarget.dataset.uiTheme;
      localStorage.setItem(UI_THEME_KEY, this._uiTheme);
      this._render();
    });

    if (this._tab === "general") this._bindGeneral();
    if (this._tab === "guest") this._bindGuest();
    if (this._tab === "pages") this._bindPages();
    if (this._tab === "dock") this._bindDock();
    if (this._tab === "styles") this._bindStyles();
    if (this._tab === "standby") this._bindStandby();
    if (this._tab === "library") this._bindLibrary();
    if (this._tab === "music") this._bindMusic();
    else if (this._radioTest) this._stopRadioTest();
    if (this._tab === "guests") this._guests.bind(this.shadowRoot);
    this._bindIconPickers();
    this.shadowRoot.getElementById("uiPreview")?.addEventListener("change", (e) => {
      this._previewOn = e.currentTarget.checked;
      localStorage.setItem(PREVIEW_KEY, this._previewOn ? "on" : "off");
      this._render();
      requestAnimationFrame(() => this._fitPreview());
    });
  }

  _toggle(attrs, checked, label) {
    return `
      <label class="toggle">
        <span>${label}</span>
        <input type="checkbox" ${attrs} ${checked ? "checked" : ""} />
        <span class="track"></span>
      </label>
    `;
  }

  _renderGeneral(c) {
    const gen = { ...DEFAULT_GENERAL, ...(c.general || {}) };
    // The header, clock, greeting, weather and Wi-Fi button are tiles (Pages tab)
    return `
      ${this._renderHosting(c)}
      <h3>${this._t("clockSection")}</h3>
      <div class="toggle-list">
        ${this._toggle('data-gen="use24h"', gen.use24h !== false, this._t("genUse24h"))}
      </div>
      <p class="hint" data-header-hint>${this._t("headerTilesHint")}</p>
      <h3>${this._t("layoutSection")}</h3>
      ${Object.entries(GENERAL_ENUMS).map(([key, values]) => `
        <div class="row"><label>${this._t(key)}</label>
          <div class="seg wrap">${values.map((v) => `
            <button type="button" data-gen-enum="${key}" data-value="${v}" class="${(gen[key] || values[0]) === v ? "active" : ""}">${this._t(`${key}_${v}`)}</button>`).join("")}
          </div></div>
        <p class="hint">${this._t(`${key}Hint`)}</p>`).join("")}
      ${this._renderIphone(gen)}
    `;
  }

  /** Installed iPhone app: iOS draws a white status bar over the wallpaper. */
  _renderIphone(gen) {
    return `
      <h3>${this._t("iphoneSection")}</h3>
      <div class="toggle-list">
        ${this._toggle('data-gen="statusBarStrip"', gen.statusBarStrip === true, this._t("statusBarStrip"))}
      </div>
      <p class="hint">${this._t("statusBarStripHint")}</p>
    `;
  }

  _bindGeneral() {
    const general = () => (this._config.general ||= { ...DEFAULT_GENERAL });
    const url = this.shadowRoot.getElementById("dashboardUrl");
    url?.addEventListener("input", () => { this._config.dashboardUrl = url.value; });
    this._on("[data-hosting]", "click", (e) => {
      this._config.hosting = e.currentTarget.dataset.hosting;
      this._render();
    });
    this.shadowRoot.getElementById("copyHosted")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(this._hostedUrl());
        btn.textContent = this._t("copied");
        setTimeout(() => { btn.textContent = this._t("copyLink"); }, 1600);
      } catch { /* clipboard blocked */ }
    });
    this._on("[data-gen]", "change", (e) => {
      general()[e.currentTarget.dataset.gen] = e.currentTarget.checked;
    });
    this._on("[data-gen-enum]", "click", (e) => {
      const { genEnum, value } = e.currentTarget.dataset;
      if (GENERAL_ENUMS[genEnum]?.includes(value)) general()[genEnum] = value;
      this._render();
    });
  }

  // ─── Music tab: HA players, browser radio, Spotify (docs/PLAYER_ENGINES.md) ──

  /** Origin of the dashboard app (hosted or self), where spotify-callback.html lives. */
  _dashOrigin(c = this._config) {
    try {
      return new URL(this._buildPreviewSrc(c) || HOSTED_BASE).origin;
    } catch {
      return HOSTED_BASE;
    }
  }

  _radio() {
    const c = this._config;
    if (!c.radio || typeof c.radio !== "object") c.radio = { stations: [], mediaLibrary: false, directory: false };
    if (!Array.isArray(c.radio.stations)) c.radio.stations = [];
    return c.radio;
  }

  /** Same rules as music.normalize_radio on the server. */
  _stationError(name, url, ignoreIndex = -1) {
    const n = String(name || "").trim();
    if (!n || n.length > 60) return this._t("radioErrName");
    let u;
    try {
      u = new URL(String(url || "").trim());
    } catch {
      return this._t("radioErrUrl");
    }
    if (u.protocol !== "https:" || u.username || u.password) return this._t("radioErrUrl");
    const list = this._radio().stations;
    if (list.some((s, i) => i !== ignoreIndex && s.url === u.toString())) return this._t("radioErrDup");
    if (ignoreIndex < 0 && list.length >= 50) return this._t("radioErrMax");
    return "";
  }

  _renderMusic(c) {
    const radio = this._radio();
    const sp = c.spotify || {};
    const players = Object.keys(this._hass?.states || {}).filter((id) => id.startsWith("media_player.")).sort();
    const test = this._radioTest || {};
    const status = this._spotifyStatus || {};
    const redirect = `${this._dashOrigin(c)}/spotify-callback.html`;
    const httpsDash = redirect.startsWith("https://");
    return `
      <h3>${this._t("musicHaPlayers")}</h3>
      <p class="hint">${this._t("musicHaPlayersHint")}</p>
      ${players.length ? `<ul class="music-list">${players.map((id) => `
        <li><span>${this._escape(this._friendly(id))}</span><code>${this._escape(id)}</code><span class="muted">${this._escape(this._hass?.states?.[id]?.state || "")}</span></li>`).join("")}</ul>`
        : `<p class="hint">${this._t("musicNoPlayers")}</p>`}

      <h3>${this._t("radioSection")}</h3>
      <p class="hint">${this._t("radioHint")}</p>
      ${radio.stations.length ? `<ol class="station-list" id="stationList">${radio.stations.map((s, i) => `
        <li class="station" draggable="true" data-st="${i}">
          <span class="grip" aria-hidden="true">⋮⋮</span>
          <input data-st-name="${i}" value="${this._escape(s.name)}" maxlength="60" aria-label="${this._t("radioName")}" />
          <input data-st-url="${i}" value="${this._escape(s.url)}" inputmode="url" aria-label="${this._t("radioUrl")}" />
          <button type="button" class="btn ghost" data-st-test="${i}">${test.index === i && test.status !== "fail" ? this._t("radioTestStop") : this._t("radioTest")}</button>
          <span class="st-status" data-st-status="${i}" aria-live="polite">${test.index === i ? this._t(test.status === "ok" ? "radioTestOk" : test.status === "fail" ? "radioTestFail" : "radioTesting") : ""}</span>
          <button type="button" class="btn ghost" data-st-move="${i}:-1" ${i === 0 ? "disabled" : ""} aria-label="${this._t("radioUp")}">↑</button>
          <button type="button" class="btn ghost" data-st-move="${i}:1" ${i === radio.stations.length - 1 ? "disabled" : ""} aria-label="${this._t("radioDown")}">↓</button>
          <button type="button" class="btn quiet" data-st-del="${i}">${this._t("radioRemove")}</button>
        </li>`).join("")}</ol>` : `<p class="hint">${this._t("radioEmpty")}</p>`}
      ${this._radioEditError ? `<p class="field-error" role="alert">${this._escape(this._radioEditError)}</p>` : ""}
      <div class="station-add">
        <input id="newStName" placeholder="${this._t("radioName")}" maxlength="60" value="${this._escape(this._newStation?.name || "")}" />
        <input id="newStUrl" placeholder="https://" inputmode="url" value="${this._escape(this._newStation?.url || "")}" />
        <button type="button" class="btn primary" id="addStation">${this._t("radioAdd")}</button>
      </div>
      ${this._radioError ? `<p class="field-error" role="alert" id="radioError">${this._escape(this._radioError)}</p>` : ""}
      <div class="toggle-list">
        ${this._toggle('data-radio="mediaLibrary"', radio.mediaLibrary === true, this._t("radioLibrary"))}
        ${this._toggle('data-radio="directory"', radio.directory === true, this._t("radioDirectory"))}
      </div>
      <p class="hint">${this._t("radioDirectoryHint")}</p>
      ${radio.directory ? `
        <div class="station-add">
          <input id="radioQuery" placeholder="${this._t("radioSearch")}" value="${this._escape(this._radioQuery || "")}" />
          <button type="button" class="btn" id="radioSearchBtn">${this._t("radioSearchBtn")}</button>
        </div>
        ${this._radioResults ? (this._radioResults.length ? `<ul class="music-list">${this._radioResults.map((r, i) => `
          <li><span>${this._escape(r.name)}</span><span class="muted">${this._escape(r.codec || "")} ${r.bitrate ? `${r.bitrate} kb/s` : ""}</span>
          <button type="button" class="btn ghost" data-dir-add="${i}">${this._t("radioAdd")}</button></li>`).join("")}</ul>`
          : `<p class="hint">${this._t("radioSearchNone")}</p>`) : ""}
        ${this._radioSearchFail ? `<p class="hint">${this._t("radioSearchFail")}</p>` : ""}` : ""}

      <h3>${this._t("spotifySection")}</h3>
      <div class="spotify-card" data-spotify-card>
        <div class="toggle-list">
          ${this._toggle('data-spotify="enabled"', sp.enabled === true, this._t("spotifyEnable"))}
        </div>
        <p class="hint">${this._t("spotifyNeeds")}</p>
        ${sp.enabled !== true ? "" : status.connected ? `
          <p class="ok-line">${this._escape(this._t("spotifyConnected", status.display_name))}</p>
          <div class="toggle-list">${this._toggle('data-spotify="webPlayer"', sp.webPlayer === true, this._t("spotifyWebPlayer"))}</div>
          <button type="button" class="btn quiet" id="spotifyDisconnect">${this._t("spotifyDisconnect")}</button>` : `
          <ol class="wizard" data-spotify-wizard>
            <li>${this._t("spotifyStep1")}</li>
            <li>${this._t("spotifyStep2")}
              <div class="copy-row"><code id="spotifyRedirect">${this._escape(redirect)}</code>
              <button type="button" class="btn ghost" id="copyRedirect">${this._t("copy")}</button></div>
              ${httpsDash ? "" : `<p class="field-error">${this._t("spotifyStep2Warn")}</p>`}</li>
            <li>${this._t("spotifyStep3")}</li>
            <li>${this._t("spotifyStep4")}
              <div class="copy-row"><input id="spotifyClientId" value="${this._escape(status.client_id || "")}" placeholder="${this._t("spotifyClientId")}" autocomplete="off" spellcheck="false" />
              <button type="button" class="btn" id="spotifySaveId">${this._t("spotifySaveId")}</button></div></li>
            <li>${this._t("spotifyStep5")}
              <div class="copy-row"><button type="button" class="btn primary" id="spotifyConnect" ${status.configured ? "" : "disabled"}>${this._t("spotifyConnect")}</button></div>
              <p class="hint">${this._t("spotifyPaste")}</p>
              <div class="copy-row"><input id="spotifyCode" autocomplete="off" spellcheck="false" />
              <button type="button" class="btn ghost" id="spotifyPasteBtn">${this._t("spotifyPasteBtn")}</button></div></li>
          </ol>`}
        ${this._spotifyError ? `<p class="field-error" role="alert">${this._escape(this._t("spotifyErr", this._spotifyError))}</p>` : ""}
      </div>
    `;
  }

  async _loadSpotifyStatus() {
    try {
      this._spotifyStatus = await this._hass.connection.sendMessagePromise({ type: "guest_ha_dashboard/spotify/status" });
    } catch {
      this._spotifyStatus = {};
    }
    if (this._tab === "music") this._render();
  }

  async _spotifyCall(msg) {
    this._spotifyError = "";
    try {
      const res = await this._hass.connection.sendMessagePromise(msg);
      if (res && "connected" in res) this._spotifyStatus = { ...this._spotifyStatus, ...res };
      return res;
    } catch (err) {
      this._spotifyError = err?.code || err?.message || "error";
      return null;
    } finally {
      this._render();
    }
  }

  _stopRadioTest() {
    if (this._testAudio) {
      this._testAudio.pause();
      this._testAudio.removeAttribute("src");
      this._testAudio.load();
    }
    clearTimeout(this._testTimer);
    this._radioTest = null;
  }

  _bindMusic() {
    const radio = this._radio();
    if (this._spotifyStatus === undefined) {
      this._spotifyStatus = {};
      this._loadSpotifyStatus();
    }
    this._on("[data-st-name]", "change", (e) => {
      const i = Number(e.currentTarget.dataset.stName);
      const err = this._stationError(e.currentTarget.value, radio.stations[i].url, i);
      this._radioEditError = err;
      if (!err) radio.stations[i].name = e.currentTarget.value.trim();
      this._render();
    });
    this._on("[data-st-url]", "change", (e) => {
      const i = Number(e.currentTarget.dataset.stUrl);
      const err = this._stationError(radio.stations[i].name, e.currentTarget.value, i);
      this._radioEditError = err;
      if (!err) radio.stations[i].url = new URL(e.currentTarget.value.trim()).toString();
      this._render();
    });
    this._on("[data-st-del]", "click", (e) => {
      const i = Number(e.currentTarget.dataset.stDel);
      if (this._radioTest?.index === i) this._stopRadioTest();
      radio.stations.splice(i, 1);
      this._render();
    });
    this._on("[data-st-move]", "click", (e) => {
      const [i, d] = e.currentTarget.dataset.stMove.split(":").map(Number);
      const j = i + d;
      if (j < 0 || j >= radio.stations.length) return;
      [radio.stations[i], radio.stations[j]] = [radio.stations[j], radio.stations[i]];
      this._stopRadioTest();
      this._render();
    });
    // drag to reorder (mouse); the ↑ ↓ buttons do the same from the keyboard
    let dragFrom = -1;
    this._on(".station", "dragstart", (e) => {
      dragFrom = Number(e.currentTarget.dataset.st);
      e.dataTransfer.effectAllowed = "move";
    });
    this._on(".station", "dragover", (e) => e.preventDefault());
    this._on(".station", "drop", (e) => {
      e.preventDefault();
      const to = Number(e.currentTarget.dataset.st);
      if (dragFrom < 0 || dragFrom === to) return;
      const [moved] = radio.stations.splice(dragFrom, 1);
      radio.stations.splice(to, 0, moved);
      dragFrom = -1;
      this._stopRadioTest();
      this._render();
    });
    this._on("[data-st-test]", "click", (e) => {
      const i = Number(e.currentTarget.dataset.stTest);
      if (this._radioTest?.index === i && this._radioTest.status !== "fail") {
        this._stopRadioTest();
        this._render();
        return;
      }
      this._stopRadioTest();
      const audio = (this._testAudio ||= new Audio());
      this._radioTest = { index: i, status: "loading" };
      const done = (status) => {
        if (this._radioTest?.index !== i) return;
        this._radioTest.status = status;
        clearTimeout(this._testTimer);
        if (status === "fail") audio.pause();
        this._render();
      };
      audio.onplaying = () => done("ok");
      audio.onerror = () => done("fail");
      this._testTimer = setTimeout(() => done("fail"), 10000);
      audio.src = radio.stations[i].url;
      audio.play().catch(() => done("fail"));
      this._render();
    });
    const nameIn = this.shadowRoot.getElementById("newStName");
    const urlIn = this.shadowRoot.getElementById("newStUrl");
    const keep = () => { this._newStation = { name: nameIn?.value || "", url: urlIn?.value || "" }; };
    nameIn?.addEventListener("input", keep);
    urlIn?.addEventListener("input", keep);
    this.shadowRoot.getElementById("addStation")?.addEventListener("click", () => {
      const err = this._stationError(nameIn.value, urlIn.value);
      this._radioError = err;
      if (!err) {
        radio.stations.push({ id: `st${Date.now().toString(36)}`, name: nameIn.value.trim(), url: new URL(urlIn.value.trim()).toString() });
        this._newStation = null;
      }
      this._render();
    });
    this._on("[data-radio]", "change", (e) => {
      radio[e.currentTarget.dataset.radio] = e.currentTarget.checked;
      this._render();
    });
    const query = this.shadowRoot.getElementById("radioQuery");
    query?.addEventListener("input", () => { this._radioQuery = query.value; });
    this.shadowRoot.getElementById("radioSearchBtn")?.addEventListener("click", async () => {
      this._radioSearchFail = false;
      try {
        const res = await this._hass.connection.sendMessagePromise({ type: "guest_ha_dashboard/radio/search", name: query.value });
        this._radioResults = res.stations || [];
      } catch {
        this._radioResults = null;
        this._radioSearchFail = true;
      }
      this._render();
    });
    this._on("[data-dir-add]", "click", (e) => {
      const r = this._radioResults?.[Number(e.currentTarget.dataset.dirAdd)];
      if (!r) return;
      const err = this._stationError(r.name, r.url);
      this._radioError = err;
      if (!err) radio.stations.push({ id: `st${Date.now().toString(36)}`, name: r.name.slice(0, 60), url: r.url });
      this._render();
    });

    // Spotify
    const sp = (this._config.spotify ||= { enabled: false, webPlayer: false });
    this._on("[data-spotify]", "change", (e) => {
      sp[e.currentTarget.dataset.spotify] = e.currentTarget.checked;
      this._render();
    });
    this.shadowRoot.getElementById("copyRedirect")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(this.shadowRoot.getElementById("spotifyRedirect").textContent);
        btn.textContent = this._t("copied");
      } catch { /* clipboard blocked: the address stays selectable */ }
    });
    this.shadowRoot.getElementById("spotifySaveId")?.addEventListener("click", () => {
      const id = this.shadowRoot.getElementById("spotifyClientId").value.trim();
      this._spotifyCall({
        type: "guest_ha_dashboard/spotify/configure",
        client_id: id,
        redirect_uri: `${this._dashOrigin()}/spotify-callback.html`,
      });
    });
    const finish = (code, state) => this._spotifyCall({ type: "guest_ha_dashboard/spotify/callback", code, state });
    if (!this._onSpotifyMessage) {
      // the callback page on the dash origin hands back code + state (public/spotify-callback.js)
      this._onSpotifyMessage = (e) => {
        if (e.origin !== this._dashOrigin() || e.data?.type !== "dash-spotify-callback") return;
        if (typeof e.data.code === "string" && typeof e.data.state === "string") finish(e.data.code, e.data.state);
      };
      window.addEventListener("message", this._onSpotifyMessage);
    }
    this.shadowRoot.getElementById("spotifyConnect")?.addEventListener("click", async () => {
      // open the window inside the click (popup blockers), then point it at Spotify
      const popup = window.open("about:blank", "dash-spotify", "width=480,height=720");
      const res = await this._spotifyCall({ type: "guest_ha_dashboard/spotify/connect" });
      if (res?.authorize_url && popup) popup.location.href = res.authorize_url;
      else popup?.close();
    });
    this.shadowRoot.getElementById("spotifyPasteBtn")?.addEventListener("click", () => {
      const raw = this.shadowRoot.getElementById("spotifyCode").value.trim();
      const sep = raw.indexOf(":");
      if (sep > 0) finish(raw.slice(sep + 1), raw.slice(0, sep));
      else this._spotifyError = "bad_request";
    });
    this.shadowRoot.getElementById("spotifyDisconnect")?.addEventListener("click", () =>
      this._spotifyCall({ type: "guest_ha_dashboard/spotify/disconnect" }));
  }

  // ─── Videotéka tab (docs/LIBRARY.md): services, defaults, refresh ─────────

  _libraryConfig() {
    const c = this._config;
    c.library = { enabled: false, movieProfileId: null, movieRootFolder: "", tvProfileId: null, tvRootFolder: "", interval: 3, ...(c.library || {}) };
    return c.library;
  }

  async _libCall(msg) {
    try {
      return { ok: await this._hass.connection.sendMessagePromise(msg) };
    } catch (err) {
      return { error: err?.code || err?.message || "error" };
    }
  }

  async _loadLibraryServices() {
    const res = await this._libCall({ type: "guest_ha_dashboard/library/services" });
    this._libServices = res.ok || {};
    if (this._tab === "library") this._render();
  }

  _renderLibrary(c) {
    const lib = this._libraryConfig();
    const svc = this._libServices || {};
    const tests = this._libTests || {};
    const opts = this._libOptions || {};
    const editing = this._libEditing || "";
    // qBittorrent: API key (5.2+) or username + password; a mode the owner has
    // not saved yet shows empty fields, not "unchanged"
    const qbitSaved = svc.qbittorrent?.configured ? svc.qbittorrent.auth || "password" : "";
    const qbitAuth = this._libQbitAuth || qbitSaved || "api_key";
    const fields = { tmdb: ["api_key"], radarr: ["url", "api_key"], sonarr: ["url", "api_key"], qbittorrent: qbitAuth === "api_key" ? ["url", "api_key"] : ["url", "username", "password"] };
    const label = { url: "libUrl", api_key: "libApiKey", username: "libUser", password: "libPassword" };
    const select = (key, list, value, text) => `
      <select data-lib-default="${key}">
        <option value="">—</option>
        ${(list || []).map((o) => `<option value="${this._escape(o.v)}" ${String(value ?? "") === String(o.v) ? "selected" : ""}>${this._escape(text(o))}</option>`).join("")}
        ${value && !(list || []).some((o) => String(o.v) === String(value)) ? `<option value="${this._escape(value)}" selected>${this._escape(value)}</option>` : ""}
      </select>`;
    const profiles = (s) => (opts[s]?.qualityProfiles || []).map((p) => ({ v: p.id, n: p.name }));
    const roots = (s) => (opts[s]?.rootFolders || []).map((r) => ({ v: r.path, n: r.path }));
    return `
      <p class="hint">${this._t("libIntro")}</p>
      <div class="toggle-list">${this._toggle('data-lib-enable', lib.enabled === true, this._t("libEnable"))}</div>
      <h3>${this._t("libServices")}</h3>
      <div class="lib-services">${Object.keys(fields).map((s) => {
        const st = svc[s] || {};
        const test = tests[s];
        return `
        <div class="lib-svc" data-lib-svc="${s}">
          <div class="lib-svc-head">
            <strong>${this._t(`libSvc_${s}`)}</strong>
            <span class="muted" data-lib-state="${s}">${st.configured ? this._escape(this._t("libConfigured", st.url || "")) + (s === "qbittorrent" ? ` · ${this._t(`libQbitAuth_${qbitSaved}`)}` : "") : this._t("libNotConfigured")}</span>
          </div>
          ${editing === s || !st.configured ? `
            ${s === "qbittorrent" ? `
            <div class="seg" role="group" aria-label="${this._t("libQbitAuth")}">${["api_key", "password"].map((m) => `<button type="button" data-lib-qbit-auth="${m}" class="${qbitAuth === m ? "active" : ""}" aria-pressed="${qbitAuth === m}">${this._t(`libQbitAuth_${m}`)}</button>`).join("")}</div>
            <p class="hint" data-lib-qbit-hint>${this._t(qbitAuth === "api_key" ? "libQbitKeyHint" : "libQbitPasswordHint")}</p>` : ""}
            <div class="station-add">
              ${fields[s].map((f) => `<input data-lib-field="${f}" ${f === "url" ? `inputmode="url" placeholder="http://192.168.1.10:${s === "radarr" ? 7878 : s === "sonarr" ? 8989 : 8080}" value="${this._escape(st.url || "")}"` : `type="${f === "username" ? "text" : "password"}" autocomplete="off" placeholder="${st.configured && (s !== "qbittorrent" || qbitAuth === qbitSaved) ? this._t("libKeepKey") : s === "qbittorrent" && f === "api_key" ? "qbt_…" : this._t(label[f])}"`} aria-label="${this._t(label[f])}" />`).join("")}
              <button type="button" class="btn primary" data-lib-save="${s}">${this._t("libSave")}</button>
            </div>` : `
            <div class="station-add">
              <button type="button" class="btn ghost" data-lib-edit="${s}">${this._t("libChange")}</button>
              <button type="button" class="btn" data-lib-test="${s}">${this._t("libTest")}</button>
              <button type="button" class="btn quiet" data-lib-remove="${s}">${this._t("libRemove")}</button>
            </div>`}
          ${test ? `<p class="${test.ok ? "ok-line" : "field-error"}" role="status" data-lib-test-result="${s}">${this._escape(test.ok ? this._t("libTestOk", test.version || "") : this._t("libTestFail", test.error))}</p>` : ""}
        </div>`;
      }).join("")}</div>
      <h3>${this._t("libDefaults")}</h3>
      <p class="hint">${this._t("libDefaultsHint")}</p>
      <div class="row"><label>${this._t("libMovieProfile")}</label>${select("movieProfileId", profiles("radarr"), lib.movieProfileId, (o) => o.n)}</div>
      <div class="row"><label>${this._t("libMovieRoot")}</label>${select("movieRootFolder", roots("radarr"), lib.movieRootFolder, (o) => o.n)}</div>
      <div class="row"><label>${this._t("libTvProfile")}</label>${select("tvProfileId", profiles("sonarr"), lib.tvProfileId, (o) => o.n)}</div>
      <div class="row"><label>${this._t("libTvRoot")}</label>${select("tvRootFolder", roots("sonarr"), lib.tvRootFolder, (o) => o.n)}</div>
      <div class="row"><label>${this._t("libInterval")}</label>
        <div class="seg">${[2, 3, 5, 10].map((v) => `<button type="button" data-lib-interval="${v}" class="${lib.interval === v ? "active" : ""}">${v} s</button>`).join("")}</div></div>
      <p class="hint">${this._t("libGuestsHint")}</p>
      <h3>${this._t("libTmdbAttribution")}</h3>
      <p class="hint" data-tmdb-attribution>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    `;
  }

  _bindLibrary() {
    const lib = this._libraryConfig();
    if (this._libServices === undefined) {
      this._libServices = {};
      this._loadLibraryServices();
    }
    this.shadowRoot.querySelector("[data-lib-enable]")?.addEventListener("change", (e) => {
      lib.enabled = e.currentTarget.checked;
    });
    this._on("[data-lib-edit]", "click", (e) => {
      this._libEditing = e.currentTarget.dataset.libEdit;
      this._libQbitAuth = "";
      this._render();
    });
    this._on("[data-lib-qbit-auth]", "click", (e) => {
      // keep a typed address when the mode changes
      const url = this.shadowRoot.querySelector('[data-lib-svc="qbittorrent"] [data-lib-field="url"]')?.value;
      this._libQbitAuth = e.currentTarget.dataset.libQbitAuth;
      this._render();
      const input = this.shadowRoot.querySelector('[data-lib-svc="qbittorrent"] [data-lib-field="url"]');
      if (input && url !== undefined) input.value = url;
    });
    this._on("[data-lib-save]", "click", async (e) => {
      const s = e.currentTarget.dataset.libSave;
      const box = this.shadowRoot.querySelector(`[data-lib-svc="${s}"]`);
      const msg = { type: "guest_ha_dashboard/library/set_service", service: s };
      box.querySelectorAll("[data-lib-field]").forEach((input) => {
        if (input.value.trim()) msg[input.dataset.libField] = input.value.trim();
      });
      if (s === "qbittorrent") msg.auth = box.querySelector("[data-lib-qbit-auth].active")?.dataset.libQbitAuth || "api_key";
      const res = await this._libCall(msg);
      this._libTests = { ...(this._libTests || {}), [s]: res.error ? { ok: false, error: res.error } : undefined };
      if (res.ok) {
        this._libServices = res.ok;
        this._libEditing = "";
        if (s === "qbittorrent") this._libQbitAuth = "";
      }
      this._render();
    });
    this._on("[data-lib-remove]", "click", async (e) => {
      const s = e.currentTarget.dataset.libRemove;
      const res = await this._libCall({ type: "guest_ha_dashboard/library/set_service", service: s, remove: true });
      if (res.ok) this._libServices = res.ok;
      this._render();
    });
    this._on("[data-lib-test]", "click", async (e) => {
      const s = e.currentTarget.dataset.libTest;
      const res = await this._libCall({ type: "guest_ha_dashboard/library/test", service: s });
      this._libTests = { ...(this._libTests || {}), [s]: res.ok ? { ok: true, version: res.ok.version } : { ok: false, error: res.error } };
      if (res.ok && (s === "radarr" || s === "sonarr")) {
        const o = await this._libCall({ type: "guest_ha_dashboard/library/options", service: s });
        if (o.ok) this._libOptions = { ...(this._libOptions || {}), [s]: o.ok };
      }
      this._render();
    });
    this._on("[data-lib-default]", "change", (e) => {
      const key = e.currentTarget.dataset.libDefault;
      const v = e.currentTarget.value;
      lib[key] = key.endsWith("ProfileId") ? (v ? Number(v) : null) : v;
    });
    this._on("[data-lib-interval]", "click", (e) => {
      lib.interval = Number(e.currentTarget.dataset.libInterval);
      this._render();
    });
  }

  /** Media tiles: Home Assistant player, or dash's own browser radio / Spotify. */
  _sourceRow(d) {
    if (d.type !== "media_player" && d.type !== "player") return "";
    const active = d.type === "media_player" ? "ha" : d.source === "spotify" ? "spotify" : "browser";
    return `<div class="row"><label>${this._t("tileSource")}</label>
      <div class="seg wrap">${["ha", "browser", "spotify"].map((s) => `
        <button type="button" data-tile-source="${s}" class="${s === active ? "active" : ""}">${this._t(`source_${s}`)}</button>`).join("")}
      </div></div>`;
  }

  _renderHosting(c) {
    const hosted = c.hosting !== "self";
    const link = this._hostedUrl();
    return `
      <div class="row"><label>${this._t("hosting")}</label>
        <div class="seg wrap">
          <button type="button" data-hosting="hosted" class="${hosted ? "active" : ""}">${this._t("hostingHosted")}</button>
          <button type="button" data-hosting="self" class="${hosted ? "" : "active"}">${this._t("hostingSelf")}</button>
        </div></div>
      ${hosted ? `
        <div class="row"><label>${this._t("hostedUrl")}</label>
          <div class="link-box">
            <code>${this._escape(link)}</code>
            <button type="button" class="btn" id="copyHosted">${this._t("copyLink")}</button>
            <a class="btn" href="${this._escape(link)}" target="_blank" rel="noopener">${this._t("openDashboard")}</a>
          </div></div>
        ${this._haReachableFromHosted() ? "" : `<p class="msg warn">${this._t("hostedWarn")} <code>${this._escape(this._haUrl())}</code></p>`}
      ` : `
        <div class="row"><label>${this._t("dashboardUrl")}</label>
          <input id="dashboardUrl" value="${this._escape(c.dashboardUrl || "")}" placeholder="https://dash.example.com" /></div>
      `}`;
  }

  _renderStandby(c) {
    const sb = { ...DEFAULT_STANDBY, ...(c.standby || {}) };
    const chips = (key, values, fmt) => `
      <div class="seg wrap">${values.map((v) => `
        <button type="button" data-sb-set="${key}" data-value="${v}" class="${String(sb[key]) === String(v) ? "active" : ""}">${fmt(v)}</button>`).join("")}
      </div>`;
    if (this._photos === null) this._loadPhotos();
    const photos = this._photos || [];
    return `
      <div class="toggle-list" style="max-width:560px">
        ${this._toggle('data-sb="enabled"', sb.enabled, this._t("standbyEnabled"))}
      </div>
      <div class="standby-body ${sb.enabled ? "" : "is-off"}">
        <div class="row"><label>${this._t("standbyIdle")}</label>
          ${chips("idleMinutes", [1, 2, 5, 10, 15, 30], (n) => this._t("minutes", n))}</div>
        <div class="row"><label>${this._t("standbyMode")}</label>
          ${chips("mode", ["clock", "photos"], (m) => this._t(m === "clock" ? "modeClock" : "modePhotos"))}</div>
        ${sb.mode === "clock" ? `
          <div class="row"><label>${this._t("clockStyle")}</label>
            ${chips("clockStyle", ["bold", "minimal"], (m) => this._t(m === "bold" ? "clockBold" : "clockMinimal"))}</div>
          <div class="clock-sample ${sb.clockStyle}" aria-hidden="true">
            <span class="c0">0</span><span class="c1">9</span><i></i><span class="c2">4</span><span class="c3">1</span>
          </div>
        ` : `
          <div class="row"><label>${this._t("photoSeconds")}</label>
            ${chips("photoSeconds", [5, 8, 15, 30, 60], (n) => this._t("seconds", n))}</div>
          <h3>${this._t("photos")} <span class="count">${photos.length}</span></h3>
          <div class="photo-grid">
            ${photos.map((id) => `
              <figure class="photo-thumb" style="${this._thumbs.get(id) ? `background-image:url('${this._thumbs.get(id)}')` : ""}">
                <button type="button" class="photo-del" data-photo-del="${id}" aria-label="${this._t("delete")}">×</button>
              </figure>`).join("")}
            <label class="photo-add">
              <input type="file" id="photoInput" accept="image/*" multiple />
              <span>${this._uploading ? this._t("uploading", this._uploading) : this._t("addPhotos")}</span>
            </label>
          </div>
          ${photos.length ? "" : `<p class="hint">${this._t("photosEmpty")}</p>`}
        `}
        <div class="actions">
          <button type="button" class="btn" id="standbyShow">${this._t("standbyPreview")}</button>
          <button type="button" class="btn ghost" id="standbyHide">${this._t("standbyHide")}</button>
        </div>
      </div>`;
  }

  _bindStandby() {
    const sb = () => (this._config.standby ||= { ...DEFAULT_STANDBY });
    this._on('[data-sb="enabled"]', "change", (e) => {
      sb().enabled = e.currentTarget.checked;
      this._render();
    });
    this._on("[data-sb-set]", "click", (e) => {
      const { sbSet, value } = e.currentTarget.dataset;
      sb()[sbSet] = /^\d+$/.test(value) ? Number(value) : value;
      this._render();
    });
    const post = (on) => this._postPreview({ standby: on });
    this.shadowRoot.getElementById("standbyShow")?.addEventListener("click", () => post(true));
    this.shadowRoot.getElementById("standbyHide")?.addEventListener("click", () => post(false));
    this.shadowRoot.getElementById("photoInput")?.addEventListener("change", (e) => {
      this._uploadPhotos([...e.currentTarget.files]);
      e.currentTarget.value = "";
    });
    this._on("[data-photo-del]", "click", (e) => this._deletePhoto(e.currentTarget.dataset.photoDel));
  }

  async _loadPhotos() {
    this._photos = [];
    try {
      const res = await this._hass.connection.sendMessagePromise({ type: "guest_ha_dashboard/photo_list" });
      this._photos = res?.photos || [];
    } catch {
      this._photos = [];
    }
    this._render();
    for (const id of this._photos) {
      if (this._thumbs.has(id)) continue;
      try {
        const res = await this._hass.connection.sendMessagePromise({ type: "guest_ha_dashboard/photo_get", photo_id: id, thumb: true });
        this._thumbs.set(id, `data:${res.mime};base64,${res.data}`);
        if (this._tab === "standby") this._render();
      } catch (err) {
        console.warn("[dash] photo thumbnail failed", id, err);
      }
    }
  }

  /** Resized in the browser so only a compact JPEG ever reaches HA. */
  async _encodeImage(file, max, quality) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }

  async _uploadPhotos(files) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    this._uploading += images.length;
    this._render();
    for (const file of images) {
      try {
        // Home Assistant drops websocket messages over 4 MiB (aiohttp default) and
        // the whole connection with them: keep photo + thumbnail well below that.
        const thumb = await this._encodeImage(file, 360, 0.75);
        let data = "";
        for (const [max, quality] of [[1920, 0.85], [1920, 0.72], [1600, 0.7], [1280, 0.7]]) {
          data = await this._encodeImage(file, max, quality);
          if (data.length + thumb.length < PHOTO_UPLOAD_BUDGET) break;
        }
        if (data.length + thumb.length >= PHOTO_UPLOAD_BUDGET) throw new Error(this._t("photoTooLarge"));
        const res = await this._hass.connection.sendMessagePromise({
          type: "guest_ha_dashboard/photo_upload", data, thumb,
        });
        this._photos = [...(this._photos || []), res.id];
        this._thumbs.set(res.id, `data:image/jpeg;base64,${thumb}`);
      } catch (err) {
        this._error = err?.message || String(err);
      }
      this._uploading -= 1;
      this._render();
    }
  }

  async _deletePhoto(id) {
    try {
      await this._hass.connection.sendMessagePromise({ type: "guest_ha_dashboard/photo_delete", photo_id: id });
      this._photos = (this._photos || []).filter((p) => p !== id);
      this._thumbs.delete(id);
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._render();
  }

  _renderGuest(c) {
    const g = c.guestInfo || {};
    return `
      <div class="row"><label>${this._t("wifiSsid")}</label>
        <input id="wifiSsid" value="${this._escape(g.wifiSsid || "")}" /></div>
      <div class="row"><label>${this._t("wifiPassword")}</label>
        <input id="wifiPassword" type="password" value="${this._escape(g.wifiPassword || "")}" /></div>
      <div class="row"><label>${this._t("wifiSecurity")}</label>
        <select id="wifiSecurity">
          ${["WPA", "WPA2", "WEP", "nopass"].map((s) => `<option value="${s}" ${g.wifiSecurity === s ? "selected" : ""}>${s}</option>`).join("")}
        </select></div>
    `;
  }

  _bindGuest() {
    const map = [
      ["wifiSsid", (v) => (this._config.guestInfo.wifiSsid = v)],
      ["wifiPassword", (v) => (this._config.guestInfo.wifiPassword = v)],
      ["wifiSecurity", (v) => (this._config.guestInfo.wifiSecurity = v)],
    ];
    for (const [id, fn] of map) {
      const el = this.shadowRoot.getElementById(id);
      if (!el) continue;
      el.addEventListener("change", () => fn(el.value));
      el.addEventListener("input", () => fn(el.value));
    }
  }

  _renderStyles(c) {
    const a = c.appearance || {};
    return `
      <div class="row"><label>${this._t("dashTheme")}</label>
        <div class="seg">
          <button type="button" data-style-mode="light" class="${a.mode !== "dark" ? "active" : ""}">Light</button>
          <button type="button" data-style-mode="dark" class="${a.mode === "dark" ? "active" : ""}">Dark</button>
        </div>
      </div>
      <div class="row"><label>${this._t("accent")}</label>
        <input id="accent" type="color" value="${this._escape(a.accent || "#ff6b00")}" /></div>
    `;
  }

  _bindStyles() {
    this._on("[data-style-mode]", "click", (e) => {
      if (!this._config.appearance) this._config.appearance = emptyConfig().appearance;
      this._config.appearance.mode = e.currentTarget.dataset.styleMode;
      this._render();
    });
    const accent = this.shadowRoot.getElementById("accent");
    accent?.addEventListener("input", () => {
      if (!this._config.appearance) this._config.appearance = emptyConfig().appearance;
      this._config.appearance.accent = accent.value;
    });
    accent?.addEventListener("change", () => {
      if (!this._config.appearance) this._config.appearance = emptyConfig().appearance;
      this._config.appearance.accent = accent.value;
    });
  }

  _renderDock(c) {
    const dock = this._ensureDock();
    const rooms = c.pages || [];
    return `
      ${dock.length ? `<div class="card-list">${dock.map((item, i) => `
        <div class="device" data-dock-i="${i}">
          <div class="row"><label>${this._t("dockPage")}</label>
            <select data-k="pageId">
              <option value="">—</option>
              ${rooms.map((r) => `<option value="${this._escape(r.id)}" ${item.pageId === r.id ? "selected" : ""}>${this._escape(r.label || r.id)}</option>`).join("")}
            </select>
          </div>
          <div class="row"><label>${this._t("dockLabel")}</label>
            <input data-k="label" value="${this._escape(item.label || "")}" placeholder="${this._escape((rooms.find((r) => r.id === item.pageId) || {}).label || "")}" />
          </div>
          ${this._toggle('data-k="showLabel"', item.showLabel !== false, this._t("dockShowLabel"))}
          <div class="row"><label>${this._t("pageIcon")}</label>
            ${this._iconPicker(`dock-${i}`, item.icon || rooms.find((r) => r.id === item.pageId)?.icon || "Home", (ic) => { item.icon = ic; })}
          </div>
          <div class="actions"><button type="button" class="btn danger" data-remove-dock="${i}">${this._t("delete")}</button></div>
        </div>
      `).join("")}</div>` : ""}
      <div class="actions" ${dock.length ? "" : 'style="margin-top:0"'}>
        <button type="button" class="btn primary" id="addDock" ${dock.length >= DOCK_MAX || !rooms.length ? "disabled" : ""}>${this._t("dockAdd")}</button>
        ${dock.length >= DOCK_MAX ? `<span class="count">${this._t("dockFull")}</span>` : ""}
      </div>
    `;
  }

  _bindDock() {
    this.shadowRoot.getElementById("addDock")?.addEventListener("click", () => {
      const dock = this._ensureDock();
      if (dock.length >= DOCK_MAX) return;
      const used = new Set(dock.map((d) => d.pageId).filter(Boolean));
      const nextRoom = (this._config.pages || []).find((r) => !used.has(r.id));
      dock.push({
        pageId: nextRoom?.id || "",
        label: "",
        showLabel: true,
        icon: nextRoom?.icon || "Home",
      });
      this._render();
    });
    this._on("[data-remove-dock]", "click", (e) => {
      const i = Number(e.currentTarget.dataset.removeDock);
      this._ensureDock().splice(i, 1);
      this._render();
    });
    this.shadowRoot.querySelectorAll(".device[data-dock-i]").forEach((card) => {
      const item = this._ensureDock()[Number(card.dataset.dockI)];
      if (!item) return;
      // drop legacy entity fields if present
      delete item.entityId;
      card.querySelectorAll("[data-k]").forEach((el) => {
        const key = el.dataset.k;
        const apply = () => {
          if (key === "showLabel") {
            item.showLabel = el.checked;
          } else {
            item[key] = el.value;
          }
          if (key === "pageId" && el.value) {
            const room = (this._config.pages || []).find((r) => r.id === el.value);
            if (room?.icon) item.icon = room.icon;
          }
          if (key === "showLabel" || key === "pageId") this._render();
        };
        el.addEventListener("change", apply);
        if (el.tagName === "INPUT" && el.type !== "checkbox") {
          el.addEventListener("input", () => { item[key] = el.value; });
        }
      });
    });
  }

  _renderPages(c, page) {
    return `
      <div class="actions" style="margin-top:0;align-items:center">
        <button class="btn primary" id="addPage">${this._t("addPage")}</button>
      </div>
      <p class="sr-only" aria-live="polite" id="pagesLive"></p>
      ${!c.pages.length ? `<p class="hint" style="margin-top:14px">${this._t("pagesEmpty")}</p>` : `
        <div class="page-pills" id="pagePills" style="margin-top:14px">
          ${c.pages.map((r, i) => `<button type="button" class="pill ${i === this._pageIdx ? "active" : ""}" data-page="${i}" data-page-id="${this._escape(r.id || `#${i}`)}"
              aria-pressed="${i === this._pageIdx}" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight">${iconSvg(r.icon, 16)}${this._escape(r.label || r.id)} <span class="count">(${(r.devices || []).length})</span></button>`).join("")}
          <span class="pill-drop" aria-hidden="true"></span>
        </div>
        ${c.pages.length > 1 ? `<p class="pills-hint">${this._t("pagesReorderHint")}</p>` : ""}
        ${!page ? "" : `
          <div class="row"><label>${this._t("pageName")}</label><input id="pageLabel" value="${this._escape(page.label || "")}" /></div>
          <div class="row"><label>${this._t("pageIcon")}</label>
            ${this._iconPicker("page", page.icon || "Home", (ic) => { page.icon = ic; })}</div>
          <h3>${this._t("devices")} <span class="count">${this._t("devicesCount", page.devices.length)}</span></h3>
          ${this._renderGrid(page)}
          ${this._renderInspector(page)}`}
        <div class="danger-zone">
          ${!page ? "" : this._confirm === "page" ? `
            <div class="confirm" role="group" aria-label="${this._t("deletePage")}">
              <span class="confirm-q">${this._t("confirmDelete")}</span>
              <button type="button" class="btn danger" id="deletePageYes">${this._t("confirmYes")}</button>
              <button type="button" class="btn ghost" data-confirm-cancel>${this._t("confirmNo")}</button>
            </div>` : `
            <button type="button" class="btn danger" id="deletePage">${this._t("deletePage")}</button>`}
          ${this._confirm === "all" ? `
            <div class="confirm" role="group" aria-label="${this._t("clearPages")}">
              <span class="confirm-q">${this._t("confirmClearPages", c.pages.length)}</span>
              <button type="button" class="btn danger" id="clearPagesYes">${this._t("confirmYes")}</button>
              <button type="button" class="btn ghost" data-confirm-cancel>${this._t("confirmNo")}</button>
            </div>` : `
            <button type="button" class="btn quiet" id="clearPages">${this._t("clearPages")}</button>`}
        </div>
      `}
    `;
  }

  /** Stable per-device key across re-renders (FLIP animations, drag identity). */
  _devKey(d) {
    if (!this._devKeys) { this._devKeys = new WeakMap(); this._devSeq = 0; }
    if (!this._devKeys.has(d)) this._devKeys.set(d, `d${++this._devSeq}`);
    return this._devKeys.get(d);
  }

  /** Tile sizes for packTiles() / indexForCell() (www/layout.js = shared/layout.mjs). */
  _layoutSpec(page) {
    return page.devices.map((d) => {
      const { cols, rows } = resolveTile(d);
      return { id: d.id, w: cols, h: rows };
    });
  }

  _gridTiles(page) {
    const layout = packTiles(this._layoutSpec(page));
    return page.devices.map((d, di) => {
      const { style, size, cols, rows } = resolveTile(d);
      const p = layout[di];
      const place = `data-tile-id="${this._escape(p.id)}" data-col="${p.col}" data-row="${p.row}" data-w="${p.w}" data-h="${p.h}"
          style="grid-column: ${p.col} / span ${p.w}; grid-row: ${p.row} / span ${p.h}"`;
      if (d.type === "divider") {
        return `
        <div class="cc-tile cc-divider ${di === this._devIdx ? "sel" : ""}" tabindex="0" data-ti="${di}" data-key="${this._devKey(d)}"
          ${place}>
          <input class="cc-div-input" data-div-label="${di}" value="${this._escape(d.label || "")}" maxlength="${DIVIDER_LABEL_MAX}"
            placeholder="${this._escape(this._t("dividerPlaceholder"))}" aria-label="${this._escape(this._t("type_divider"))}" />
          <span class="cc-div-line" aria-hidden="true"></span>
        </div>`;
      }
      const single = cols === 1 && rows === 1;
      const icon = d.icon || DEFAULT_DEVICE_ICON[d.type] || "Sparkles";
      const label = this._tileName(d);
      const deco = {
        slider: '<span class="deco deco-fill-x"></span>',
        vertical: '<span class="deco deco-fill-y"></span>',
        row: '<span class="deco deco-switch"></span>',
        dial: `<svg class="deco deco-dial" viewBox="0 0 100 52" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"><path d="M6 48a44 44 0 0 1 88 0" opacity="0.2"/><path d="M6 48a44 44 0 0 1 62-40"/></svg>`,
        cover: '<span class="deco deco-cover"></span>',
        mini: '<span class="deco deco-media">▶ ⏭</span>',
        vinyl: vinylSvg("deco deco-vinyl"),
      }[style] || (d.type === "media_player" ? '<span class="deco deco-media">⏮ ▶ ⏭</span>' : "");
      return `
        <div class="cc-tile st-${style} ${rows === 1 ? "h1" : ""} ${single ? "s1" : ""} ${di === this._devIdx ? "sel" : ""}"
          tabindex="0" data-ti="${di}" data-key="${this._devKey(d)}" title="${this._escape(label)}"
          ${place}>
          ${deco}
          <span class="cc-ic">${iconSvg(icon, 18)}</span>
          ${single || (cols === 1 && style !== "vertical") ? "" : `
            <span class="cc-txt">
              <span class="cc-lbl">${this._escape(label)}</span>
              <span class="cc-meta">${this._t(`style_${style}`)} · ${size.replace("x", "×")}</span>
            </span>`}
          ${tileVariants(d.type).length > 1 ? `<span class="cc-resize" data-resize title="${this._t("resizeTile")}" aria-hidden="true"></span>` : ""}
        </div>`;
    }).join("");
  }

  _renderGrid(page) {
    return `
      <div class="cc-wrap">
        ${page.devices.length ? `<div class="cc-grid" id="ccGrid">${this._gridTiles(page)}</div>` : `<p class="hint">${this._t("gridEmpty")}</p>`}
        <div class="actions cc-actions">
          <button type="button" class="btn primary" id="addDevice" aria-expanded="${this._addOpen ? "true" : "false"}" aria-controls="addMenu">${this._t("addDevice")}</button>
          <button type="button" class="btn ghost" id="addDivider">${this._t("addDivider")}</button>
        </div>
        ${this._renderAddMenu()}
      </div>`;
  }

  /**
   * Re-render only the tiles and animate every tile from its old box to the new
   * one (FLIP), so neighbours visibly make room while dragging or resizing.
   */
  _refreshGrid(page, skipKey = null) {
    const grid = this.shadowRoot.getElementById("ccGrid");
    if (!grid) return;
    this._pushDraft();
    const before = new Map([...grid.children].map((el) => [el.dataset.key, el.getBoundingClientRect()]));
    grid.innerHTML = this._gridTiles(page);
    for (const el of grid.children) {
      const old = before.get(el.dataset.key);
      if (!old || el.dataset.key === skipKey) continue;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      const sx = old.width / now.width;
      const sy = old.height / now.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      el.animate(
        [
          { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: "0 0", transform: "none" },
        ],
        { duration: 340, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
      );
    }
  }

  /** Grid geometry: one cell + gap in px, read from the live layout. */
  _gridMetrics(grid) {
    const cs = getComputedStyle(grid);
    const gap = parseFloat(cs.columnGap) || 10;
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const cell = (grid.clientWidth - padX - gap * 3) / 4;
    return { gap, cell };
  }

  /** Closest (style, size) for the requested span; keeps the current style on ties. */
  _closestVariant(device, cols, rows) {
    const current = resolveTile(device).style;
    let best = null;
    let bestScore = Infinity;
    for (const v of tileVariants(device.type)) {
      const score = (v.cols - cols) ** 2 + (v.rows - rows) ** 2 + (v.style === current ? 0 : 0.35);
      if (score < bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  _bindGrid(page) {
    const grid = this.shadowRoot.getElementById("ccGrid");
    if (!grid) return;
    let g = null;
    /** Grid cell (1-based) under the dragged tile's top-left corner. */
    const dropCell = () => {
      const { gap, cell } = this._gridMetrics(grid);
      const r = grid.getBoundingClientRect();
      const cs = getComputedStyle(grid);
      const step = cell + gap;
      const x = g.x - g.grabX + cell / 2 - r.left - parseFloat(cs.paddingLeft);
      const y = g.y - g.grabY + cell / 2 - r.top - parseFloat(cs.paddingTop);
      return {
        col: Math.max(1, Math.min(4, Math.floor(x / step) + 1)),
        row: Math.max(1, Math.floor(y / step) + 1),
      };
    };
    const placeDragged = () => {
      const el = grid.querySelector(`[data-key="${g.key}"]`);
      if (!el) return;
      el.classList.add("dragging");
      const r = el.getBoundingClientRect();
      const tx = g.x - g.grabX - r.left + (parseFloat(el.style.getPropertyValue("--tx")) || 0);
      const ty = g.y - g.grabY - r.top + (parseFloat(el.style.getPropertyValue("--ty")) || 0);
      el.style.setProperty("--tx", `${tx}px`);
      el.style.setProperty("--ty", `${ty}px`);
    };

    grid.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("input")) return; // divider label: edit, don't drag
      const tile = e.target.closest(".cc-tile");
      if (!tile) return;
      const r = tile.getBoundingClientRect();
      const di = Number(tile.dataset.ti);
      g = {
        mode: e.target.closest("[data-resize]") ? "resize" : "press",
        key: tile.dataset.key,
        device: page.devices[di],
        startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
        grabX: e.clientX - r.left, grabY: e.clientY - r.top,
        left: r.left, top: r.top,
        touch: e.pointerType === "touch",
        t: performance.now(),
        lockUntil: 0,
      };
      try { grid.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      if (g.mode === "resize") {
        e.preventDefault();
        grid.classList.add("is-resizing");
        tile.classList.add("resizing");
      }
    });

    grid.addEventListener("pointermove", (e) => {
      if (!g) return;
      g.x = e.clientX;
      g.y = e.clientY;
      if (g.mode === "press") {
        const moved = Math.hypot(g.x - g.startX, g.y - g.startY);
        // touch needs a short hold first so the page can still scroll
        if (moved < 6 || (g.touch && performance.now() - g.t < 280)) {
          if (g.touch && moved > 10) g = null;
          return;
        }
        g.mode = "drag";
        grid.classList.add("is-dragging");
      }
      if (g.mode === "drag") {
        placeDragged();
        if (performance.now() > g.lockUntil) {
          // the drop cell becomes a new array index, packed by the same function
          const from = page.devices.indexOf(g.device);
          const { col, row } = dropCell();
          const to = indexForCell(this._layoutSpec(page), from, col, row);
          if (from !== to) {
            page.devices.splice(from, 1);
            page.devices.splice(to, 0, g.device);
            this._devIdx = to;
            this._refreshGrid(page, g.key);
            placeDragged();
            g.lockUntil = performance.now() + 220;
          }
        }
        return;
      }
      if (g.mode === "resize") {
        const { gap, cell } = this._gridMetrics(grid);
        const step = cell + gap;
        // handle sits bottom-right: the tile grows to the right and downwards
        const cols = Math.max(1, Math.min(4, Math.round((g.x - g.left + gap) / step)));
        const rows = Math.max(1, Math.min(4, Math.round((g.y - g.top + gap) / step)));
        const v = this._closestVariant(g.device, cols, rows);
        const cur = resolveTile(g.device);
        if (v && (v.style !== cur.style || v.size !== cur.size)) {
          g.device.style = v.style;
          g.device.size = v.size;
          this._refreshGrid(page);
          grid.querySelector(`[data-key="${g.key}"]`)?.classList.add("resizing");
        }
      }
    });

    const end = (e) => {
      if (!g) return;
      const state = g;
      g = null;
      grid.classList.remove("is-dragging", "is-resizing");
      if (state.mode === "press") {
        const di = page.devices.indexOf(state.device);
        this._devIdx = this._devIdx === di ? -1 : di;
        this._iconOpen = null;
        this._render();
        return;
      }
      if (state.mode === "drag") {
        // settle on the cell under the tile now (the last move may have hit the lock)
        g = state;
        const from = page.devices.indexOf(state.device);
        const { col, row } = dropCell();
        g = null;
        const to = indexForCell(this._layoutSpec(page), from, col, row);
        if (from !== to) {
          page.devices.splice(from, 1);
          page.devices.splice(to, 0, state.device);
          this._devIdx = to;
          this._refreshGrid(page, state.key);
        }
        const el = grid.querySelector(`[data-key="${state.key}"]`);
        if (el) {
          const tx = parseFloat(el.style.getPropertyValue("--tx")) || 0;
          const ty = parseFloat(el.style.getPropertyValue("--ty")) || 0;
          el.animate(
            [{ transform: `translate(${tx}px, ${ty}px) scale(1.06)` }, { transform: "none" }],
            { duration: 320, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
          ).onfinish = () => this._render();
          el.classList.remove("dragging");
          el.style.removeProperty("--tx");
          el.style.removeProperty("--ty");
          return;
        }
      }
      if (e.type !== "pointercancel" || state.mode === "resize") this._render();
    };
    grid.addEventListener("pointerup", end);
    grid.addEventListener("pointercancel", end);
    grid.addEventListener("touchmove", (e) => { if (g && g.mode !== "press") e.preventDefault(); }, { passive: false });
    grid.querySelectorAll("[data-div-label]").forEach((input) => {
      const d = page.devices[Number(input.dataset.divLabel)];
      input.addEventListener("input", () => { if (d) d.label = input.value.slice(0, DIVIDER_LABEL_MAX); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); input.blur(); }
      });
    });
    grid.addEventListener("keydown", (e) => {
      if (e.target.closest("input")) return;
      const tile = e.target.closest(".cc-tile");
      if (!tile || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      const di = Number(tile.dataset.ti);
      this._devIdx = this._devIdx === di ? -1 : di;
      this._render();
    });
  }

  _renderInspector(page) {
    const d = page.devices[this._devIdx];
    if (!d) return "";
    const di = this._devIdx;
    const { style, size } = resolveTile(d);
    const styles = TILE_STYLES[d.type] || TILE_STYLES.switch;
    const seg = (attr, options, active, label) => `
      <div class="seg wrap">${options.map((o) => `
        <button type="button" data-${attr}="${o}" class="${o === active ? "active" : ""}">${label(o)}</button>`).join("")}
      </div>`;
    if (d.type === "divider") {
      return `
      <div class="inspector" data-di="${di}">
        <div class="inspector-head">
          <strong>${this._escape(this._tileName(d))}</strong>
          <button type="button" class="btn" data-move="-1" ${di === 0 ? "disabled" : ""}>${this._t("moveLeft")}</button>
          <button type="button" class="btn" data-move="1" ${di === page.devices.length - 1 ? "disabled" : ""}>${this._t("moveRight")}</button>
          <button type="button" class="btn danger" id="removeDevice">${this._t("delete")}</button>
        </div>
        <p class="hint">${this._t("dividerHint")}</p>
      </div>`;
    }
    if (!TILE_TYPES[d.type]?.needsEntity) {
      // Header family (and other tiles without an entity of their own): style, size, options
      return `
      <div class="inspector" data-di="${di}" data-inspector-type="${d.type}">
        <div class="inspector-head">
          <strong>${this._escape(this._tileName(d))}</strong>
          <button type="button" class="btn" data-move="-1" ${di === 0 ? "disabled" : ""}>${this._t("moveLeft")}</button>
          <button type="button" class="btn" data-move="1" ${di === page.devices.length - 1 ? "disabled" : ""}>${this._t("moveRight")}</button>
          <button type="button" class="btn danger" id="removeDevice">${this._t("delete")}</button>
        </div>
        ${this._sourceRow(d)}
        ${Object.keys(styles).length > 1 ? `<div class="row"><label>${this._t("devStyle")}</label>
          ${seg("tile-style", Object.keys(styles), style, (s) => this._t(`style_${s}`))}</div>` : ""}
        ${styles[style].length > 1 ? `<div class="row"><label>${this._t("devSize")}</label>
          ${seg("tile-size", styles[style], size, (s) => s.replace("x", "×"))}</div>` : ""}
        ${d.type === "light_group" ? `
        <div class="row"><label>${this._t("devLabel")}</label>
          <input data-k="label" value="${this._escape(d.label || "")}" /></div>
        <div class="row"><label>${this._t("pageIcon")}</label>
          ${this._iconPicker(`dev-${di}`, d.icon || DEFAULT_DEVICE_ICON[d.type], (ic) => { d.icon = ic; })}</div>
        <p class="hint">${this._t("longPressHint")}</p>` : ""}
        ${this._fieldControls(d, style)}
      </div>`;
    }
    const pool = this._entitiesForType(d.type);
    return `
      <div class="inspector" data-di="${di}">
        <div class="inspector-head">
          <strong>${this._escape(this._tileName(d))}</strong>
          <button type="button" class="btn" data-move="-1" ${di === 0 ? "disabled" : ""}>${this._t("moveLeft")}</button>
          <button type="button" class="btn" data-move="1" ${di === page.devices.length - 1 ? "disabled" : ""}>${this._t("moveRight")}</button>
          <button type="button" class="btn danger" id="removeDevice">${this._t("delete")}</button>
        </div>
        ${this._sourceRow(d)}
        <div class="row"><label>${this._t("devType")}</label>
          <select data-k="type">${ENTITY_TYPES.map((t) => `<option value="${t}" ${d.type === t ? "selected" : ""}>${this._t(`type_${t}`)}</option>`).join("")}</select></div>
        <div class="row"><label>${this._t("devEntity")}</label>
          <select data-k="id"><option value="">—</option>${pool.map((e) => `<option value="${e}" ${d.id === e ? "selected" : ""}>${this._escape(this._friendly(e))}</option>`).join("")}</select></div>
        <div class="row"><label>${this._t("devLabel")}</label>
          <input data-k="label" value="${this._escape(d.label || "")}" /></div>
        <div class="row"><label>${this._t("pageIcon")}</label>
          ${this._iconPicker(`dev-${di}`, d.icon || DEFAULT_DEVICE_ICON[d.type], (ic) => { d.icon = ic; })}</div>
        <div class="row"><label>${this._t("devStyle")}</label>
          ${seg("tile-style", Object.keys(styles), style, (s) => `${s === "vinyl" ? vinylSvg() : ""}${this._t(`style_${s}`)}`)}</div>
        <div class="row"><label>${this._t("devSize")}</label>
          ${seg("tile-size", styles[style], size, (s) => s.replace("x", "×"))}</div>
        ${d.type === "entity" ? `<p class="hint">${this._t("entityGenericHint")}</p>` : ""}
        ${d.type === "light" ? `<p class="hint">${this._t("longPressHint")}</p>` : ""}
        ${d.type === "media_player" ? `<p class="hint">${this._t("mediaHint")}
          <a href="https://github.com/Lokkisanek/Dash/blob/main/docs/SPEAKERS.md" target="_blank" rel="noopener">${this._t("speakerGuide")}</a></p>` : ""}
        ${this._fieldControls(d, style)}
      </div>`;
  }

  /**
   * Inline editors for a tile's options (registry `fields`): toggles for bool,
   * segments for enum, a select for one entity. Fields limited to some styles
   * are shown only for those styles.
   */
  _fieldControls(d, style) {
    const fields = Object.entries(TILE_TYPES[d.type]?.fields || {})
      .filter(([name, f]) => !(d.type === "divider" && name === "label") && (!f.styles || f.styles.includes(style)));
    if (!fields.length) return "";
    const toggles = [];
    const rows = [];
    for (const [name, f] of fields) {
      const label = this._t(`opt_${name}`);
      if (f.type === "bool") {
        toggles.push(this._toggle(`data-field="${name}"`, typeof d[name] === "boolean" ? d[name] : f.default, label));
      } else if (f.type === "enum") {
        const current = f.values.includes(d[name]) ? d[name] : f.default;
        rows.push(`<div class="row"><label>${label}</label><div class="seg wrap">${f.values.map((v) => `
          <button type="button" data-field-enum="${name}" data-value="${v}" class="${v === current ? "active" : ""}">${this._t(`opt_${name}_${v}`)}</button>`).join("")}</div></div>`);
      } else if (f.type === "entity") {
        const pool = f.domains.flatMap((dom) => this._entities(dom));
        rows.push(`<div class="row"><label>${label}</label>
          <select data-field-entity="${name}"><option value="">${this._t("weatherAuto")}</option>
            ${pool.map((e) => `<option value="${e}" ${d[name] === e ? "selected" : ""}>${this._escape(this._friendly(e))}</option>`).join("")}
          </select></div>`);
      } else if (f.type === "entities") {
        rows.push(this._entitiesPicker(d, name, f));
      } else if (f.type === "string" && d.type === "entity" && name === "attribute") {
        // one attribute of the chosen entity, read only
        const keys = Object.keys(this._hass?.states?.[d.id]?.attributes || {})
          .filter((k) => !["friendly_name", "icon", "entity_picture", "entity_picture_local", "supported_features"].includes(k))
          .sort();
        rows.push(`<div class="row"><label>${label}</label>
          <select data-field-string="${name}"><option value="">${this._t("attributeNone")}</option>
            ${keys.map((k) => `<option value="${this._escape(k)}" ${d[name] === k ? "selected" : ""}>${this._escape(k)}</option>`).join("")}
          </select></div>`);
      }
    }
    return `
      ${toggles.length ? `<div class="toggle-list" style="margin-top:6px">${toggles.join("")}</div>` : ""}
      ${rows.join("")}`;
  }

  /** Checklist with search for a list of entities (light groups), inline. */
  _entitiesPicker(d, name, f) {
    const chosen = Array.isArray(d[name]) ? d[name] : [];
    const q = (this._entSearch || "").trim().toLowerCase();
    const pool = [...new Set(f.domains.flatMap((dom) => this._entities(dom)))];
    const visible = pool.filter((e) => chosen.includes(e) || !q || `${e} ${this._friendly(e)}`.toLowerCase().includes(q));
    const full = chosen.length >= f.max;
    return `
      <div class="row ent-row"><label>${this._t(`opt_${name}`)}</label>
        <div class="ent-pick">
          <input type="search" data-entities-search="${name}" value="${this._escape(this._entSearch || "")}" placeholder="${this._escape(this._t("entitiesSearch"))}" aria-label="${this._escape(this._t("entitiesSearch"))}" />
          <p class="hint ent-count" aria-live="polite">${name === "outputs" ? this._t("outputsHint") : `${this._t("entitiesCount", chosen.length, f.min, f.max)}${chosen.length < f.min ? ` · ${this._t("entitiesTooFew", f.min)}` : ""}`}</p>
          <div class="ent-list" role="group" aria-label="${this._escape(this._t(`opt_${name}`))}">
            ${visible.map((e) => {
              const on = chosen.includes(e);
              return `<label class="ent-item"><input type="checkbox" data-entities-field="${name}" value="${this._escape(e)}" ${on ? "checked" : ""} ${!on && full ? "disabled" : ""} />
                <span>${this._escape(this._friendly(e))}</span><code>${this._escape(e)}</code></label>`;
            }).join("")}
          </div>
        </div>
      </div>`;
  }

  _moveDevice(page, from, to) {
    if (from === to || from < 0 || to < 0 || from >= page.devices.length || to >= page.devices.length) return;
    const [d] = page.devices.splice(from, 1);
    page.devices.splice(to, 0, d);
    this._devIdx = to;
    this._render();
  }

  _bindPages() {
    this.shadowRoot.getElementById("addPage")?.addEventListener("click", () => this._addEmptyPage());
    // Deleting is a two-step inline confirmation (no browser dialogs)
    const ask = (what) => {
      this._confirm = what;
      this._render();
      this.shadowRoot.querySelector(what === "page" ? "#deletePageYes" : "#clearPagesYes")?.focus();
    };
    this.shadowRoot.getElementById("deletePage")?.addEventListener("click", () => ask("page"));
    this.shadowRoot.getElementById("clearPages")?.addEventListener("click", () => ask("all"));
    this._on("[data-confirm-cancel]", "click", () => {
      const back = this._confirm === "page" ? "#deletePage" : "#clearPages";
      this._confirm = null;
      this._render();
      this.shadowRoot.querySelector(back)?.focus();
    });
    this.shadowRoot.getElementById("deletePageYes")?.addEventListener("click", () => {
      this._confirm = null;
      this._devIdx = -1;
      this._removePage(this._pageIdx);
    });
    this.shadowRoot.getElementById("clearPagesYes")?.addEventListener("click", () => {
      this._confirm = null;
      this._config.pages = [];
      this._config.dock = [];
      this._pageIdx = 0;
      this._devIdx = -1;
      this._render();
    });
    this._on(".pill[data-page]", "click", (e) => {
      if (this._pillDragged) {
        this._pillDragged = false;
        return;
      }
      this._pageIdx = Number(e.currentTarget.dataset.page);
      this._devIdx = -1;
      this._iconOpen = null;
      this._confirm = null;
      this._render();
    });
    this._bindPagePills();

    const page = this._config.pages[this._pageIdx];
    if (!page) return;
    const pageLabel = this.shadowRoot.getElementById("pageLabel");
    pageLabel?.addEventListener("input", () => { page.label = pageLabel.value; });
    pageLabel?.addEventListener("change", () => this._render());
    this.shadowRoot.getElementById("addDevice")?.addEventListener("click", () => {
      this._addOpen = !this._addOpen;
      this._render();
      this.shadowRoot.querySelector("#addMenu .add-item")?.focus();
    });
    this._on("[data-add-type]", "click", (e) => this._addDevice(page, e.currentTarget.dataset.addType));
    this.shadowRoot.getElementById("addMenu")?.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      this._addOpen = false;
      this._render();
      this.shadowRoot.getElementById("addDevice")?.focus();
    });
    this.shadowRoot.getElementById("addDivider")?.addEventListener("click", () => this._addDivider(page));

    this._bindGrid(page);

    const device = page.devices[this._devIdx];
    if (!device) return;
    this._on("[data-move]", "click", (e) => {
      this._moveDevice(page, this._devIdx, this._devIdx + Number(e.currentTarget.dataset.move));
    });
    this.shadowRoot.getElementById("removeDevice")?.addEventListener("click", () => {
      page.devices.splice(this._devIdx, 1);
      this._devIdx = -1;
      this._iconOpen = null;
      this._render();
    });
    this._on("[data-tile-source]", "click", (e) => {
      const src = e.currentTarget.dataset.tileSource;
      const keep = (type) => (TILE_STYLES[type]?.[device.style] ? device.style : Object.keys(TILE_STYLES[type])[0]);
      if (src === "ha" && device.type !== "media_player") {
        const style = keep("media_player");
        Object.assign(device, { type: "media_player", style, size: TILE_STYLES.media_player[style][0], id: "" });
        delete device.source;
      } else if (src !== "ha") {
        const style = keep("player");
        if (device.type !== "player") {
          Object.assign(device, { type: "player", style, size: TILE_STYLES.player[style][0] });
          delete device.id;
          delete device.outputs;
        }
        device.source = src;
      }
      this._render();
    });
    this._on("[data-tile-style]", "click", (e) => {
      const styles = TILE_STYLES[device.type] || TILE_STYLES.switch;
      device.style = e.currentTarget.dataset.tileStyle;
      device.size = styles[device.style]?.[0];
      this._render();
    });
    this._on("[data-tile-size]", "click", (e) => {
      device.size = e.currentTarget.dataset.tileSize;
      this._render();
    });
    // Tile options (registry fields): stored on the tile, the preview shows them after Uložit
    this._on(".inspector [data-field]", "change", (e) => {
      device[e.currentTarget.dataset.field] = e.currentTarget.checked;
    });
    this._on(".inspector [data-field-enum]", "click", (e) => {
      device[e.currentTarget.dataset.fieldEnum] = e.currentTarget.dataset.value;
      this._render();
    });
    this._on(".inspector [data-field-entity]", "change", (e) => {
      device[e.currentTarget.dataset.fieldEntity] = e.currentTarget.value;
    });
    this._on(".inspector [data-field-string]", "change", (e) => {
      device[e.currentTarget.dataset.fieldString] = e.currentTarget.value;
    });
    this._on(".inspector [data-entities-field]", "change", (e) => {
      const key = e.currentTarget.dataset.entitiesField;
      const list = Array.isArray(device[key]) ? device[key].slice() : [];
      const id = e.currentTarget.value;
      device[key] = e.currentTarget.checked ? [...new Set([...list, id])] : list.filter((x) => x !== id);
      this._render();
      this.shadowRoot.querySelector(`.inspector [data-entities-field][value="${CSS.escape(id)}"]`)?.focus();
    });
    this._on(".inspector [data-entities-search]", "input", (e) => {
      this._entSearch = e.currentTarget.value;
      const pos = e.currentTarget.selectionStart;
      this._render();
      const input = this.shadowRoot.querySelector(".inspector [data-entities-search]");
      input?.focus();
      input?.setSelectionRange(pos, pos);
    });
    this.shadowRoot.querySelectorAll(".inspector [data-k]").forEach((el) => {
      const key = el.dataset.k;
      if (el.tagName === "INPUT") {
        el.addEventListener("input", () => { device[key] = el.value; });
        el.addEventListener("change", () => this._render());
        return;
      }
      el.addEventListener("change", () => {
        if (key === "type") {
          const prev = device.type;
          const wasDefaultIcon = !device.icon || device.icon === DEFAULT_DEVICE_ICON[prev];
          const wasDefaultLabel = !device.label || device.label === this._t(`type_${prev}`) || device.label === this._friendly(device.id);
          device.type = el.value;
          device.id = "";
          device.supportsBrightness = el.value === "light";
          const first = Object.keys(TILE_STYLES[el.value])[0];
          device.style = first;
          device.size = TILE_STYLES[el.value][first][0];
          if (wasDefaultIcon) device.icon = DEFAULT_DEVICE_ICON[el.value];
          if (wasDefaultLabel) device.label = this._t(`type_${el.value}`);
        } else if (key === "id") {
          device.id = el.value;
          if (el.value) device.label = this._friendly(el.value);
        }
        this._render();
      });
    });
  }
}

customElements.define("guest-ha-dashboard-panel", GuestHaDashboardPanel);
