/**
 * Guest HA Dashboard config panel
 * Full-screen layout + live dashboard preview (iPhone 15 Pro frame).
 *
 * The preview iframe is created once and never re-mounted; the guest page
 * picks up saved config through its own HA subscription.
 */
import { ICONS } from "./icons.js?v=1.5.0";

const PANEL_VERSION = "1.5.0";
const UI_THEME_KEY = "guest_ha_panel_ui_theme";
const UI_LANG_KEY = "guest_ha_panel_ui_lang"; // auto | cs | en — default auto = HA language
const ORIENT_KEY = "guest_ha_panel_preview_orient";
const DOCK_MAX = 6;
const PAGES_MAX = 6;

/**
 * Control-Center-like grid (4 square columns). First entry = default.
 * Keep in sync with src/lib/tileStyles.js in the guest PWA.
 */
const TILE_STYLES = {
  light: { tile: ["2x2", "4x2"], slider: ["4x1", "2x1"], vertical: ["1x2", "2x2"], button: ["1x1", "2x1"] },
  switch: { tile: ["2x2"], row: ["4x1"], button: ["1x1", "2x1"] },
  climate: { tile: ["2x2"], dial: ["4x3"] },
  cover: { tile: ["2x2"], slider: ["4x1", "2x1"], vertical: ["1x2", "2x2"] },
  media_player: { tile: ["4x2", "2x2"] },
};
const DEVICE_TYPES = Object.keys(TILE_STYLES);
const DEFAULT_DEVICE_ICON = {
  light: "Lightbulb", switch: "Power", climate: "Thermometer", cover: "Blinds", media_player: "Music",
};

function resolveTile(device) {
  const styles = TILE_STYLES[device?.type] || TILE_STYLES.switch;
  const style = styles[device?.style] ? device.style : Object.keys(styles)[0];
  const sizes = styles[style];
  const size = sizes.includes(device?.size) ? device.size : sizes[0];
  const [cols, rows] = size.split("x").map(Number);
  return { style, size, cols, rows };
}

/** Inline lucide SVG (same set the PWA renders). */
function iconSvg(name, size = 20) {
  const inner = ICONS[name] || ICONS.Sparkles || "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/**
 * iPhone 15 Pro — 6.1", 2556 × 1179 px @ 460 ppi (@3x → 393 × 852 pt).
 * Display corner radius ≈ 55 pt, Dynamic Island 126 × 37 pt, 11 pt from the edge,
 * status bar safe area 59 pt.
 */
const IPHONE_15_PRO = {
  pxW: 1179,
  pxH: 2556,
  ppi: 460,
  inches: 6.1,
  w: 393,
  h: 852,
  radius: 55,
  bezel: 10,
  safeTop: 59,
  safeSide: 59,
  safeBottom: 34,
  safeBottomLandscape: 21,
};

const DEFAULT_GENERAL = {
  showTopBar: true,
  showWelcome: true,
  weatherEntity: "",
  showTime: true,
  use24h: true,
  showDate: true,
  showWifi: true,
  showTemperature: true,
  showHumidity: true,
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
    tabGuest: "Wi-Fi",
    tabStyles: "Styly",
    previewTitle: "Live preview",
    previewMeta: `iPhone 15 Pro · 6,1″ · ${IPHONE_15_PRO.pxH} × ${IPHONE_15_PRO.pxW} · ${IPHONE_15_PRO.ppi} ppi`,
    previewEmpty: "Nastav URL hostovské PWA v záložce Obecné a ulož.",
    rotateLandscape: "Na šířku",
    rotatePortrait: "Na výšku",
    dashboardUrl: "URL tvého web dashboardu",
    headerSection: "Horní lišta",
    genShowTopBar: "Zobrazit horní lištu",
    welcomeSection: "Uvítání a počasí",
    genShowWelcome: "Uvítací zpráva (jméno uživatele HA)",
    weatherSource: "Počasí",
    weatherAuto: "Auto — poloha domova v HA",
    genShowTime: "Čas",
    genUse24h: "24hodinový formát",
    genShowDate: "Datum",
    genShowWifi: "Tlačítko Wi-Fi",
    genShowTemperature: "Teplota",
    genShowHumidity: "Vlhkost",
    wifiSsid: "Wi-Fi SSID",
    wifiPassword: "Wi-Fi heslo",
    wifiSecurity: "Zabezpečení",
    dashTheme: "Dashboard theme",
    accent: "Accent",
    pagesFull: (max) => `Maximum je ${max} pages.`,
    addPage: "+ Page",
    clearPages: "Smazat všechny Pages",
    pagesEmpty: "Zatím žádné Pages — přidej první tlačítkem + Page.",
    pageName: "Název page",
    pageIcon: "Ikona",
    devices: "Zařízení",
    addDevice: "+ Zařízení",
    delete: "Smazat",
    deletePage: "Smazat page",
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
    tabGuest: "Wi-Fi",
    tabStyles: "Styles",
    previewTitle: "Live preview",
    previewMeta: `iPhone 15 Pro · 6.1″ · ${IPHONE_15_PRO.pxH} × ${IPHONE_15_PRO.pxW} · ${IPHONE_15_PRO.ppi} ppi`,
    previewEmpty: "Set the guest PWA URL in General and save.",
    rotateLandscape: "Landscape",
    rotatePortrait: "Portrait",
    dashboardUrl: "Your web dashboard URL",
    headerSection: "Top bar",
    genShowTopBar: "Show top bar",
    welcomeSection: "Welcome & weather",
    genShowWelcome: "Welcome message (HA user name)",
    weatherSource: "Weather",
    weatherAuto: "Auto — HA home location",
    genShowTime: "Time",
    genUse24h: "24-hour clock",
    genShowDate: "Date",
    genShowWifi: "Wi-Fi button",
    genShowTemperature: "Temperature",
    genShowHumidity: "Humidity",
    wifiSsid: "Wi-Fi SSID",
    wifiPassword: "Wi-Fi password",
    wifiSecurity: "Security",
    dashTheme: "Dashboard theme",
    accent: "Accent",
    pagesFull: (max) => `Maximum is ${max} pages.`,
    addPage: "+ Page",
    clearPages: "Clear all Pages",
    pagesEmpty: "No Pages yet — add one with + Page.",
    pageName: "Page name",
    pageIcon: "Icon",
    devices: "Devices",
    addDevice: "+ Device",
    delete: "Delete",
    deletePage: "Delete page",
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
  guestInfo: {
    wifiSsid: "",
    wifiPassword: "",
    wifiSecurity: "WPA",
  },
  general: { ...DEFAULT_GENERAL },
  pages: [],
  dock: [],
  dashboardUrl: "",
  appearance: { mode: "light", accent: "#ff6b00" },
});

function normalizeConfig(cfg = {}) {
  const base = emptyConfig();
  let pages = [];
  if (Array.isArray(cfg.pages) && cfg.pages.length) pages = cfg.pages;
  else if (Array.isArray(cfg.rooms) && cfg.rooms.length) pages = cfg.rooms;
  else if (Array.isArray(cfg.pages)) pages = cfg.pages;
  // Pages are free-form cards — drop legacy area linkage
  pages = pages.slice(0, PAGES_MAX).map((pg) => {
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
    this._orient = localStorage.getItem(ORIENT_KEY) === "landscape" ? "landscape" : "portrait";
    this._rotating = false;
    /** Theme of the saved config — the phone screen chrome follows the live page, not the draft */
    this._liveMode = "light";
    this._uiTheme = localStorage.getItem(UI_THEME_KEY) || "auto";
    const storedLang = localStorage.getItem(UI_LANG_KEY);
    this._uiLangPref = storedLang === "en" || storedLang === "cs" ? storedLang : "auto";
    /** Live iframe src — updates only on load + Save, never while drafting */
    this._livePreviewSrc = "";
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

  /** Exact guest PWA URL — nothing special, just the live page. */
  _buildPreviewSrc(config) {
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
  _addEmptyPage() {
    if (this._config.pages.length >= PAGES_MAX) return;
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
  _addDevice(page) {
    page.devices.push({
      id: "", type: "light", label: this._t("type_light"), supportsBrightness: true,
      icon: DEFAULT_DEVICE_ICON.light, style: "tile", size: "2x2",
    });
    this._devIdx = page.devices.length - 1;
    this._render();
  }

  /**
   * Icon button + popover grid with real SVG previews.
   * `key` must be unique per render; `onPick(name)` is called on selection.
   */
  _iconPicker(key, current, onPick) {
    this._iconPickers.set(key, onPick);
    const open = this._iconOpen === key;
    const name = ICONS[current] ? current : "Sparkles";
    return `
      <div class="icon-picker">
        <button type="button" class="icon-btn ${open ? "open" : ""}" data-icon-open="${key}" title="${this._t("pickIcon")}">
          ${iconSvg(name, 20)}<span>${this._escape(name)}</span>
        </button>
        ${open ? `<div class="icon-grid" role="listbox">${Object.keys(ICONS).map((ic) => `
          <button type="button" class="icon-opt ${ic === name ? "on" : ""}" data-icon-pick="${key}" data-icon="${ic}" title="${ic}" aria-label="${ic}">
            ${iconSvg(ic, 20)}
          </button>`).join("")}</div>` : ""}
      </div>`;
  }
  _bindIconPickers() {
    this._on("[data-icon-open]", "click", (e) => {
      const key = e.currentTarget.dataset.iconOpen;
      this._iconOpen = this._iconOpen === key ? null : key;
      this._render();
    });
    this._on("[data-icon-pick]", "click", (e) => {
      const { iconPick, icon } = e.currentTarget.dataset;
      this._iconPickers.get(iconPick)?.(icon);
      this._iconOpen = null;
      this._render();
    });
  }
  _entities(domain) {
    return Object.keys(this._hass?.states || {})
      .filter((id) => id.startsWith(`${domain}.`))
      .sort();
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
      input:not([type="checkbox"]), select, textarea {
        width: 100%; font: inherit; padding: 10px 12px; border-radius: 12px;
        border: 1px solid var(--border);
        background-color: #fff !important; color: #111 !important;
        -webkit-text-fill-color: #111 !important; caret-color: #111 !important;
        opacity: 1 !important; color-scheme: light;
      }
      :host([dark]) input:not([type="checkbox"]), :host([dark]) select, :host([dark]) textarea {
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
      .icon-picker { position: relative; min-width: 0; }
      .row:has(> .icon-picker), .row:has(> .seg.wrap) { align-items: start; }
      .row:has(> .icon-picker) > label, .row:has(> .seg.wrap) > label { padding-top: 10px; }
      .icon-btn {
        display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px 7px 10px;
        border: 1px solid var(--border); background: var(--input-bg); color: var(--input-text);
      }
      .icon-btn.open { border-color: var(--accent); }
      .icon-btn svg { color: var(--accent); }
      .icon-grid {
        margin-top: 8px; display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
        gap: 6px; padding: 10px; border-radius: 18px; max-height: 236px; overflow: auto;
        background: var(--input-bg); border: 1px solid var(--border);
        animation: pop-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.1);
      }
      .icon-opt {
        aspect-ratio: 1; display: grid; place-items: center; padding: 0; border-radius: 12px;
        background: transparent; color: var(--text);
      }
      .icon-opt:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
      .icon-opt.on { background: var(--accent); color: #fff; }
      @keyframes pop-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }

      /* Pages editor — mimics the iOS Control Center edit grid */
      .cc-wrap { container-type: inline-size; max-width: 400px; margin: 4px 0 14px; }
      .cc-grid {
        --gap: 10px;
        display: grid; gap: var(--gap); grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-auto-rows: calc((100cqw - 3 * var(--gap)) / 4); grid-auto-flow: row dense;
        padding: 14px; border-radius: 30px;
        background: color-mix(in srgb, var(--text) 6%, transparent);
        margin: 0 -14px;
      }
      .cc-tile {
        position: relative; overflow: hidden; min-width: 0; cursor: grab; user-select: none;
        display: flex; flex-direction: column; justify-content: space-between; gap: 4px;
        padding: 10px 12px; border-radius: 22px; color: var(--text);
        background: var(--card); border: 1px solid var(--border);
        transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 0.2s ease, opacity 0.2s ease;
      }
      .cc-tile:hover { transform: scale(1.02); }
      .cc-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .cc-tile.sel { box-shadow: 0 0 0 2.5px var(--accent); }
      .cc-tile.h1 { flex-direction: row; align-items: center; justify-content: flex-start; gap: 10px; }
      .cc-tile.s1 { justify-content: center; align-items: center; padding: 0; border-radius: 50%; }
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
      .cc-grid.is-dragging .cc-tile:not(.dragging) { animation: cc-wiggle 0.28s ease-in-out infinite alternate; }
      .cc-grid.is-dragging .cc-tile:nth-child(2n) { animation-delay: -0.14s; }
      .cc-tile.dragging { opacity: 0.35; }
      .cc-tile.drop-target { box-shadow: 0 0 0 2.5px var(--accent); transform: scale(0.96); }
      @keyframes cc-wiggle { from { rotate: -1.2deg; } to { rotate: 1.2deg; } }
      @media (prefers-reduced-motion: reduce) {
        .cc-grid.is-dragging .cc-tile { animation: none !important; }
      }
      .inspector {
        display: grid; gap: 2px; padding: 14px 16px 6px; border-radius: 22px; max-width: 560px;
        background: color-mix(in srgb, var(--input-bg) 70%, transparent); border: 1px solid var(--border);
        animation: pop-in 0.22s ease;
      }
      .inspector-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .inspector-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .inspector-head .btn { padding: 6px 12px; font-size: 0.82rem; }
      .seg.wrap { flex-wrap: wrap; border-radius: 18px; }
      .pill svg { vertical-align: -3px; margin-right: 4px; }
      .hint { font-size: 0.85rem; color: var(--muted); margin: 0 0 12px; line-height: 1.4; }
      .page-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
      .pill {
        padding: 6px 12px; border-radius: 999px; background: var(--btn);
        border: 1px solid var(--border); color: var(--text); font: inherit; cursor: pointer;
      }
      .pill.active { background: var(--accent); color: #fff; border-color: transparent; }
      h3 { margin: 18px 0 8px; font-size: 1rem; }
      .count { color: var(--muted); font-size: 0.8rem; }
      .preview-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 14px; border-bottom: 1px solid var(--border);
      }
      .preview-head strong { font-size: 0.92rem; }
      .rotate-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 14px; border: 1px solid var(--border); font-size: 0.85rem;
      }
      .rotate-btn svg { transition: transform 0.7s cubic-bezier(0.3, 1.2, 0.4, 1); }
      .rotate-btn[data-orient="landscape"] svg { transform: rotate(-90deg); }
      .preview-body {
        flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px 14px 12px;
        background:
          radial-gradient(ellipse at 30% 20%, rgba(255,107,0,0.12), transparent 45%),
          radial-gradient(ellipse at 80% 80%, rgba(140,100,255,0.12), transparent 40%),
          var(--bg);
      }
      .stage {
        position: relative; flex: 1; min-height: 0; width: 100%;
        animation: stage-in 0.7s cubic-bezier(0.2, 0.9, 0.25, 1) both;
      }
      @keyframes stage-in {
        from { opacity: 0; transform: translateY(18px); filter: blur(6px); }
        to { opacity: 1; transform: none; filter: none; }
      }
      /*
       * iPhone 15 Pro. Size is the real point size; --s scales it to fit.
       * Rotation: the portrait frame is turned by ±90° (which visually is the
       * landscape box), then the layout swaps to landscape with no transition.
       */
      .iphone {
        --ow: ${IPHONE_15_PRO.w + IPHONE_15_PRO.bezel * 2}px;
        --oh: ${IPHONE_15_PRO.h + IPHONE_15_PRO.bezel * 2}px;
        --s: 1; --r: 0deg;
        --screen-bg: #f3f0f7; --status-fg: #000;
        position: absolute; left: 50%; top: 50%;
        width: var(--ow); height: var(--oh); padding: ${IPHONE_15_PRO.bezel}px;
        border-radius: ${IPHONE_15_PRO.radius + IPHONE_15_PRO.bezel}px;
        transform: translate(-50%, -50%) scale(var(--s)) rotate(var(--r));
        transition: transform 0.75s cubic-bezier(0.32, 0.72, 0, 1);
        background: linear-gradient(135deg, #8e8b86 0%, #3a3936 22%, #1c1c1e 50%, #3a3936 78%, #8e8b86 100%);
        box-shadow:
          inset 0 0 0 1.5px rgba(255,255,255,0.22),
          inset 0 0 0 4px #111,
          0 2px 0 rgba(255,255,255,0.06),
          0 40px 80px -24px rgba(0,0,0,0.5),
          0 18px 30px -18px rgba(0,0,0,0.45);
        will-change: transform;
      }
      .iphone.no-anim { transition: none; }
      .iphone[data-orient="landscape"] {
        --ow: ${IPHONE_15_PRO.h + IPHONE_15_PRO.bezel * 2}px;
        --oh: ${IPHONE_15_PRO.w + IPHONE_15_PRO.bezel * 2}px;
      }
      .iphone[data-mode="dark"] { --screen-bg: #0e1014; --status-fg: #fff; }
      .iphone-screen {
        position: relative; width: 100%; height: 100%; overflow: hidden;
        border-radius: ${IPHONE_15_PRO.radius}px; background: var(--screen-bg);
        transition: background 0.4s ease;
      }
      /* Full-screen like a real PWA; the page gets the safe-area insets via postMessage. */
      .iphone iframe {
        position: absolute; inset: 0; width: 100%; height: 100%;
        border: 0; display: block; background: transparent;
      }
      .ios-status {
        position: absolute; top: 0; left: 0; right: 0; height: ${IPHONE_15_PRO.safeTop}px; z-index: 2;
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 30px 0 46px; color: var(--status-fg);
        font: 600 17px/1 -apple-system, "SF Pro Text", system-ui, sans-serif;
        letter-spacing: -0.01em; pointer-events: none;
      }
      .ios-status .ios-icons { display: flex; gap: 6px; align-items: center; }
      .ios-status svg { display: block; fill: currentColor; }
      .iphone[data-orient="landscape"] .ios-status { display: none; }
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
                  <iframe title="Guest dashboard live preview" allow="fullscreen" hidden></iframe>
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
    const frame = this.shadowRoot.querySelector("#iphone iframe");
    frame.addEventListener("load", () => this._postSafeArea());
    this._onFrameMessage = (e) => {
      if (e.source === frame.contentWindow && e.data?.type === "guest-ha:ready") this._postSafeArea();
    };
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

  /** env(safe-area-inset-*) is 0 inside an iframe, so hand the page the simulated insets. */
  _postSafeArea() {
    const frame = this.shadowRoot?.querySelector("#iphone iframe");
    if (!frame?.contentWindow) return;
    const p = IPHONE_15_PRO;
    const insets = this._orient === "landscape"
      ? { top: 0, right: p.safeSide, bottom: p.safeBottomLandscape, left: p.safeSide }
      : { top: p.safeTop, right: 0, bottom: p.safeBottom, left: 0 };
    frame.contentWindow.postMessage({ type: "guest-ha:safe-area", insets }, "*");
  }

  _orientBox(orient) {
    const { w, h, bezel } = IPHONE_15_PRO;
    const pw = w + bezel * 2;
    const ph = h + bezel * 2;
    return orient === "landscape" ? { w: ph, h: pw } : { w: pw, h: ph };
  }

  _fitScale(orient) {
    const stage = this.shadowRoot.getElementById("previewStage");
    if (!stage) return 1;
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return 1;
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
      localStorage.setItem(ORIENT_KEY, next);
      phone.dataset.orient = next;
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
    if (meta) meta.textContent = this._t("previewMeta");

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
    `;
  }

  _render() {
    this._syncTheme();
    this._ensureShell();
    const c = this._config;
    if (!c.appearance) c.appearance = { mode: "light", accent: "#ff6b00" };
    this._ensureDock();
    const page = c.pages[this._pageIdx];
    this._iconPickers.clear();
    const locale = this._uiLang() === "en" ? "en-US" : "cs-CZ";
    const onSettings = this._tab === "ui";

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
            </div>
            `}
          </div>
          ${onSettings ? "" : `
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
    this._bindIconPickers();
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
    const items = [
      ["showTime", "genShowTime"],
      ["use24h", "genUse24h"],
      ["showDate", "genShowDate"],
      ["showWifi", "genShowWifi"],
      ["showTemperature", "genShowTemperature"],
      ["showHumidity", "genShowHumidity"],
    ];
    const weathers = this._entities("weather");
    return `
      <div class="row"><label>${this._t("dashboardUrl")}</label>
        <input id="dashboardUrl" value="${this._escape(c.dashboardUrl || "")}" placeholder="https://guest.example.com" /></div>
      <h3>${this._t("headerSection")}</h3>
      <div class="toggle-list">
        ${this._toggle('data-gen="showTopBar"', gen.showTopBar, this._t("genShowTopBar"))}
        ${gen.showTopBar ? items.map(([key, label]) => this._toggle(`data-gen="${key}"`, gen[key], this._t(label))).join("") : ""}
      </div>
      <h3>${this._t("welcomeSection")}</h3>
      <div class="toggle-list">
        ${this._toggle('data-gen="showWelcome"', gen.showWelcome, this._t("genShowWelcome"))}
      </div>
      <div class="row" style="margin-top:12px"><label>${this._t("weatherSource")}</label>
        <select id="weatherEntity">
          <option value="">${this._t("weatherAuto")}</option>
          ${weathers.map((w) => `<option value="${w}" ${gen.weatherEntity === w ? "selected" : ""}>${this._escape(this._friendly(w))}</option>`).join("")}
        </select></div>
    `;
  }

  _bindGeneral() {
    const general = () => (this._config.general ||= { ...DEFAULT_GENERAL });
    const url = this.shadowRoot.getElementById("dashboardUrl");
    url?.addEventListener("input", () => { this._config.dashboardUrl = url.value; });
    this._on("[data-gen]", "change", (e) => {
      const key = e.currentTarget.dataset.gen;
      general()[key] = e.currentTarget.checked;
      if (key === "showTopBar") this._render();
    });
    const weather = this.shadowRoot.getElementById("weatherEntity");
    weather?.addEventListener("change", () => { general().weatherEntity = weather.value; });
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
    const pagesFull = c.pages.length >= PAGES_MAX;
    return `
      <div class="actions" style="margin-top:0;align-items:center">
        <button class="btn primary" id="addPage" ${pagesFull ? "disabled" : ""}>${this._t("addPage")}</button>
        <button class="btn ghost" id="clearPages" ${c.pages.length ? "" : "disabled"}>${this._t("clearPages")}</button>
        <span class="count">${c.pages.length} / ${PAGES_MAX}${pagesFull ? ` · ${this._t("pagesFull", PAGES_MAX)}` : ""}</span>
      </div>
      ${!c.pages.length ? `<p class="hint" style="margin-top:14px">${this._t("pagesEmpty")}</p>` : `
        <div class="page-pills" style="margin-top:14px">
          ${c.pages.map((r, i) => `<button class="pill ${i === this._pageIdx ? "active" : ""}" data-page="${i}">${iconSvg(r.icon, 16)}${this._escape(r.label || r.id)} <span class="count">(${(r.devices || []).length})</span></button>`).join("")}
        </div>
        ${!page ? "" : `
          <div class="row"><label>${this._t("pageName")}</label><input id="pageLabel" value="${this._escape(page.label || "")}" /></div>
          <div class="row"><label>${this._t("pageIcon")}</label>
            ${this._iconPicker("page", page.icon || "Home", (ic) => { page.icon = ic; })}</div>
          <h3>${this._t("devices")} <span class="count">${this._t("devicesCount", page.devices.length)}</span></h3>
          ${this._renderGrid(page)}
          ${this._renderInspector(page)}
          <div class="actions">
            <button class="btn danger" id="deletePage">${this._t("deletePage")}</button>
          </div>`}
      `}
    `;
  }

  _renderGrid(page) {
    const tiles = page.devices.map((d, di) => {
      const { style, size, cols, rows } = resolveTile(d);
      const single = cols === 1 && rows === 1;
      const icon = d.icon || DEFAULT_DEVICE_ICON[d.type] || "Sparkles";
      const label = d.label || (d.id ? this._friendly(d.id) : this._t(`type_${d.type}`));
      const deco = {
        slider: '<span class="deco deco-fill-x"></span>',
        vertical: '<span class="deco deco-fill-y"></span>',
        row: '<span class="deco deco-switch"></span>',
        dial: `<svg class="deco deco-dial" viewBox="0 0 100 52" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"><path d="M6 48a44 44 0 0 1 88 0" opacity="0.2"/><path d="M6 48a44 44 0 0 1 62-40"/></svg>`,
      }[style] || (d.type === "media_player" ? '<span class="deco deco-media">⏮ ▶ ⏭</span>' : "");
      return `
        <div class="cc-tile ${rows === 1 ? "h1" : ""} ${single ? "s1" : ""} ${di === this._devIdx ? "sel" : ""}"
          draggable="true" tabindex="0" data-ti="${di}" title="${this._escape(label)}"
          style="grid-column: span ${cols}; grid-row: span ${rows}">
          ${deco}
          <span class="cc-ic">${iconSvg(icon, 18)}</span>
          ${single || (cols === 1 && style !== "vertical") ? "" : `
            <span class="cc-txt">
              <span class="cc-lbl">${this._escape(label)}</span>
              <span class="cc-meta">${this._t(`style_${style}`)} · ${size.replace("x", "×")}</span>
            </span>`}
        </div>`;
    }).join("");
    return `
      <div class="cc-wrap">
        ${page.devices.length ? `<div class="cc-grid" id="ccGrid">${tiles}</div>` : `<p class="hint">${this._t("gridEmpty")}</p>`}
        <div class="actions"><button type="button" class="btn primary" id="addDevice">${this._t("addDevice")}</button></div>
      </div>`;
  }

  _renderInspector(page) {
    const d = page.devices[this._devIdx];
    if (!d) return "";
    const di = this._devIdx;
    const { style, size } = resolveTile(d);
    const styles = TILE_STYLES[d.type] || TILE_STYLES.switch;
    const pool = this._entities(d.type);
    const seg = (attr, options, active, label) => `
      <div class="seg wrap">${options.map((o) => `
        <button type="button" data-${attr}="${o}" class="${o === active ? "active" : ""}">${label(o)}</button>`).join("")}
      </div>`;
    return `
      <div class="inspector" data-di="${di}">
        <div class="inspector-head">
          <strong>${this._escape(d.label || this._t(`type_${d.type}`))}</strong>
          <button type="button" class="btn" data-move="-1" ${di === 0 ? "disabled" : ""}>${this._t("moveLeft")}</button>
          <button type="button" class="btn" data-move="1" ${di === page.devices.length - 1 ? "disabled" : ""}>${this._t("moveRight")}</button>
          <button type="button" class="btn danger" id="removeDevice">${this._t("delete")}</button>
        </div>
        <div class="row"><label>${this._t("devType")}</label>
          <select data-k="type">${DEVICE_TYPES.map((t) => `<option value="${t}" ${d.type === t ? "selected" : ""}>${this._t(`type_${t}`)}</option>`).join("")}</select></div>
        <div class="row"><label>${this._t("devEntity")}</label>
          <select data-k="id"><option value="">—</option>${pool.map((e) => `<option value="${e}" ${d.id === e ? "selected" : ""}>${this._escape(this._friendly(e))}</option>`).join("")}</select></div>
        <div class="row"><label>${this._t("devLabel")}</label>
          <input data-k="label" value="${this._escape(d.label || "")}" /></div>
        <div class="row"><label>${this._t("pageIcon")}</label>
          ${this._iconPicker(`dev-${di}`, d.icon || DEFAULT_DEVICE_ICON[d.type], (ic) => { d.icon = ic; })}</div>
        <div class="row"><label>${this._t("devStyle")}</label>
          ${seg("tile-style", Object.keys(styles), style, (s) => this._t(`style_${s}`))}</div>
        <div class="row"><label>${this._t("devSize")}</label>
          ${seg("tile-size", styles[style], size, (s) => s.replace("x", "×"))}</div>
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
    this.shadowRoot.getElementById("clearPages")?.addEventListener("click", () => {
      this._config.pages = [];
      this._config.dock = [];
      this._pageIdx = 0;
      this._devIdx = -1;
      this._render();
    });
    this._on(".pill[data-page]", "click", (e) => {
      this._pageIdx = Number(e.currentTarget.dataset.page);
      this._devIdx = -1;
      this._iconOpen = null;
      this._render();
    });
    this.shadowRoot.getElementById("deletePage")?.addEventListener("click", () => {
      this._devIdx = -1;
      this._removePage(this._pageIdx);
    });

    const page = this._config.pages[this._pageIdx];
    if (!page) return;
    const pageLabel = this.shadowRoot.getElementById("pageLabel");
    pageLabel?.addEventListener("input", () => { page.label = pageLabel.value; });
    pageLabel?.addEventListener("change", () => this._render());
    this.shadowRoot.getElementById("addDevice")?.addEventListener("click", () => this._addDevice(page));

    const grid = this.shadowRoot.getElementById("ccGrid");
    const clearDrop = () => grid?.querySelectorAll(".drop-target").forEach((t) => t.classList.remove("drop-target"));
    grid?.querySelectorAll(".cc-tile").forEach((tile) => {
      const di = Number(tile.dataset.ti);
      const select = () => {
        this._devIdx = this._devIdx === di ? -1 : di;
        this._iconOpen = null;
        this._render();
      };
      tile.addEventListener("click", select);
      tile.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
      });
      tile.addEventListener("dragstart", (e) => {
        this._dragIdx = di;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(di));
        tile.classList.add("dragging");
        requestAnimationFrame(() => grid.classList.add("is-dragging"));
      });
      tile.addEventListener("dragend", () => {
        this._dragIdx = -1;
        tile.classList.remove("dragging");
        grid.classList.remove("is-dragging");
        clearDrop();
      });
      tile.addEventListener("dragover", (e) => {
        if (this._dragIdx < 0) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (this._dragIdx !== di && !tile.classList.contains("drop-target")) {
          clearDrop();
          tile.classList.add("drop-target");
        }
      });
      tile.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = this._dragIdx;
        this._dragIdx = -1;
        this._moveDevice(page, from, di);
      });
    });
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
