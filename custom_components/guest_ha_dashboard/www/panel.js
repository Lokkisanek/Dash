/**
 * Guest HA Dashboard config panel
 * Full-screen layout + live mobile preview + light/dark for config UI and guest PWA.
 *
 * Preview is intentionally independent of HA `hass` pushes — those used to rebuild
 * the whole panel (~every 2s), remount the iframe, and interrupt config editing.
 * Draft config never reaches the guest dashboard / preview until Save.
 */
const PANEL_VERSION = "1.2.4";
const UI_THEME_KEY = "guest_ha_panel_ui_theme";
const UI_LANG_KEY = "guest_ha_panel_ui_lang";

/** iPhone 12 Pro physical pixels (Apple: 2532 × 1170 @3x → 390 × 844 CSS pt). */
const IPHONE_12_PRO = {
  pxW: 1170,
  pxH: 2532,
  cssW: 390,
  cssH: 844,
};

const PANEL_I18N = {
  cs: {
    title: "Guest Dashboard",
    subtitle: "Config + live preview hostovského tabletu",
    save: "Uložit",
    saving: "Ukládám…",
    saved: "Uloženo",
    tabRooms: "Místnosti",
    tabScenes: "Scény",
    tabGuest: "Host & Wi-Fi",
    tabStyles: "Styly",
    previewTitle: "Preview (iPhone 12 Pro)",
    previewEmpty: "Nastav <b>URL hostovské PWA</b> v záložce Host &amp; Wi-Fi. Pak tu půjde interaktivně klikat jako na tabletu.",
    guestHint: "Texty na tabletu, Wi-Fi QR a URL pro live preview. Změny se propsí až po Uložit.",
    dashboardUrl: "URL hostovské PWA",
    welcomeTitle: "Uvítací titulek",
    welcomeSubtitle: "Podtitulek",
    wifiSsid: "Wi-Fi SSID",
    wifiPassword: "Wi-Fi heslo",
    wifiSecurity: "Zabezpečení",
    stylesHint: "Vzhled hostovského dashboardu (PWA). Nic se nepropsí, dokud neuložíš.",
    dashTheme: "Dashboard theme",
    dashLanguage: "Jazyk dashboardu",
    accent: "Accent",
    stylesAfterSave: "Po Uložit se theme, jazyk i ostatní config propsí do PWA / preview.",
    roomsHint: "<b>Jednoduchý setup:</b> zapni místnosti z HA Areas. Zařízení se načtou sama. Pak Uložit.",
    importAreas: "Zapnout všechny Areas",
    clearRooms: "Vypnout vše",
    noAreas: "V HA zatím nemáš Areas (Settings → Areas).",
    advanced: "Pokročilé — upravit místnost / entity ručně",
    roomName: "Název",
    roomIcon: "Ikona",
    roomTemp: "Teplota",
    roomHumidity: "Vlhkost",
    devices: "Zařízení",
    addDevice: "+ Zařízení",
    resyncRoom: "Znovu načíst z Area",
    delete: "Smazat",
    scenesHint: "Rychlé scény v horní liště tabletu. Propsí se až po Uložit.",
    addScene: "Scéna",
    importedRooms: (n) => `Naimportováno ${n} místností`,
    roomExists: "Místnost už je v configu",
    roomAdded: (name) => `Přidáno: ${name}`,
    roomResynced: "Místnost znovu načtena z Area",
    devicesCount: (n) => `${n} zařízení`,
    langCs: "Čeština",
    langEn: "English",
    panelLang: "Jazyk panelu",
  },
  en: {
    title: "Guest Dashboard",
    subtitle: "Config + live preview of the guest tablet",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    tabRooms: "Rooms",
    tabScenes: "Scenes",
    tabGuest: "Guest & Wi-Fi",
    tabStyles: "Styles",
    previewTitle: "Preview (iPhone 12 Pro)",
    previewEmpty: "Set the <b>guest PWA URL</b> in the Guest &amp; Wi-Fi tab. Then you can click here like on a tablet.",
    guestHint: "Tablet texts, Wi-Fi QR and live preview URL. Changes apply only after Save.",
    dashboardUrl: "Guest PWA URL",
    welcomeTitle: "Welcome title",
    welcomeSubtitle: "Subtitle",
    wifiSsid: "Wi-Fi SSID",
    wifiPassword: "Wi-Fi password",
    wifiSecurity: "Security",
    stylesHint: "Guest dashboard (PWA) look. Nothing is published until you Save.",
    dashTheme: "Dashboard theme",
    dashLanguage: "Dashboard language",
    accent: "Accent",
    stylesAfterSave: "After Save, theme, language and the rest of the config push to the PWA / preview.",
    roomsHint: "<b>Simple setup:</b> enable rooms from HA Areas. Devices load automatically. Then Save.",
    importAreas: "Enable all Areas",
    clearRooms: "Disable all",
    noAreas: "No Areas in HA yet (Settings → Areas).",
    advanced: "Advanced — edit room / entities manually",
    roomName: "Name",
    roomIcon: "Icon",
    roomTemp: "Temperature",
    roomHumidity: "Humidity",
    devices: "Devices",
    addDevice: "+ Device",
    resyncRoom: "Reload from Area",
    delete: "Delete",
    scenesHint: "Quick scenes in the tablet top bar. Applied only after Save.",
    addScene: "Scene",
    importedRooms: (n) => `Imported ${n} rooms`,
    roomExists: "Room is already in the config",
    roomAdded: (name) => `Added: ${name}`,
    roomResynced: "Room reloaded from Area",
    devicesCount: (n) => `${n} devices`,
    langCs: "Čeština",
    langEn: "English",
    panelLang: "Panel language",
  },
};

const ICON_OPTIONS = [
  "Sofa", "BedDouble", "Bath", "DoorOpen", "Home", "Lamp", "Tv",
  "Fan", "Flame", "Coffee", "Power", "Sunset", "Sunrise", "Clapperboard",
];
const DEVICE_TYPES = ["light", "switch", "cover", "climate"];
const AREA_ICON_MAP = {
  "mdi:sofa": "Sofa", "mdi:couch": "Sofa", "mdi:bed": "BedDouble",
  "mdi:bed-double": "BedDouble", "mdi:shower": "Bath", "mdi:bathtub": "Bath",
  "mdi:toilet": "Bath", "mdi:door": "DoorOpen", "mdi:door-open": "DoorOpen",
  "mdi:home": "Home", "mdi:lamp": "Lamp", "mdi:floor-lamp": "Lamp",
};

const emptyConfig = () => ({
  guestInfo: {
    welcomeTitle: "Vitejte u nas",
    welcomeSubtitle: "Ovladajte dum jako doma",
    wifiSsid: "",
    wifiPassword: "",
    wifiSecurity: "WPA",
  },
  scenes: [],
  rooms: [],
  dashboardUrl: "",
  appearance: { mode: "light", accent: "#ff6b00", language: "cs" },
});

class GuestHaDashboardPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = emptyConfig();
    this._saving = false;
    this._savedAt = null;
    this._error = null;
    this._info = null;
    this._tab = "rooms";
    this._roomIdx = 0;
    this._uiTheme = localStorage.getItem(UI_THEME_KEY) || "auto";
    this._uiLang = localStorage.getItem(UI_LANG_KEY) === "en" ? "en" : "cs";
    this._previewKey = 0;
    this.attachShadow({ mode: "open" });
  }

  _t(key, ...args) {
    const pack = PANEL_I18N[this._uiLang] || PANEL_I18N.cs;
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
    // HA pushes a new `hass` object very often (entity updates). Never full-render
    // here — that remounts the preview iframe and wipes in-progress config edits.
    const wasDark = this.hasAttribute("dark");
    this._syncTheme();
    if (this._uiTheme === "auto" && this.hasAttribute("dark") !== wasDark) {
      this._render({ keepPreview: true });
    }
  }
  get hass() { return this._hass; }
  set narrow(v) {
    const next = Boolean(v);
    if (this._narrow === next) return;
    this._narrow = next;
    this._render({ keepPreview: true });
  }
  connectedCallback() { this._syncTheme(); this._render(); }

  _isDark() {
    if (this._uiTheme === "dark") return true;
    if (this._uiTheme === "light") return false;
    return Boolean(this._hass?.themes?.darkMode);
  }
  _syncTheme() { this.toggleAttribute("dark", this._isDark()); }

  _dashMode() {
    return this._config.appearance?.mode === "dark" ? "dark" : "light";
  }

  _previewSrc() {
    // Preview always loads the *saved* PWA — never push draft theme/lang via query params.
    const base = (this._config.dashboardUrl || "").trim().replace(/\/$/, "");
    if (!base) return "";
    const u = new URL(base.includes("://") ? base : `https://${base}`);
    u.searchParams.set("preview", "1");
    u.searchParams.set("v", PANEL_VERSION);
    return u.toString();
  }

  async _load() {
    if (!this._hass) return;
    try {
      const cfg = await this._hass.connection.sendMessagePromise({
        type: "guest_ha_dashboard/get_config",
      });
      this._config = { ...emptyConfig(), ...cfg, appearance: { ...emptyConfig().appearance, ...(cfg.appearance || {}) } };
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._render();
  }

  async _save() {
    if (!this._hass || this._saving) return;
    this._saving = true; this._error = null; this._render({ keepPreview: true });
    try {
      const saved = await this._hass.connection.sendMessagePromise({
        type: "guest_ha_dashboard/set_config",
        config: this._config,
      });
      this._config = { ...emptyConfig(), ...saved, appearance: { ...emptyConfig().appearance, ...(saved.appearance || {}) } };
      this._savedAt = new Date();
      this._info = this._t("saved");
      // Only now remount preview so saved config / language / theme apply
      this._previewKey += 1;
      this._saving = false;
      this._render({ keepPreview: false });
      return;
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._saving = false;
    this._render({ keepPreview: true });
  }

  _escape(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  _friendly(id) {
    return this._hass?.states?.[id]?.attributes?.friendly_name || id;
  }
  _areas() {
    return Object.values(this._hass?.areas || {}).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "cs"),
    );
  }
  _entitiesInArea(areaId) {
    const devices = this._hass?.devices || {};
    const entities = this._hass?.entities || {};
    const deviceIds = new Set(
      Object.values(devices).filter((d) => d.area_id === areaId).map((d) => d.id),
    );
    return Object.values(entities)
      .filter((e) => e.area_id === areaId || (e.device_id && deviceIds.has(e.device_id)))
      .map((e) => e.entity_id).sort();
  }
  _mapAreaIcon(mdi) { return AREA_ICON_MAP[mdi] || "Home"; }

  _roomFromArea(area) {
    const ids = this._entitiesInArea(area.area_id);
    const devices = [];
    let temperatureEntity = "";
    let humidityEntity = "";
    for (const id of ids) {
      const domain = id.split(".")[0];
      const state = this._hass.states?.[id];
      if (DEVICE_TYPES.includes(domain)) {
        devices.push({
          id, type: domain,
          label: state?.attributes?.friendly_name || id.split(".")[1] || id,
          supportsBrightness: domain === "light", icon: "Power",
        });
      }
      if (domain === "sensor") {
        const dc = state?.attributes?.device_class;
        if (dc === "temperature" && !temperatureEntity) temperatureEntity = id;
        if (dc === "humidity" && !humidityEntity) humidityEntity = id;
      }
    }
    return {
      id: area.area_id, label: area.name, icon: this._mapAreaIcon(area.icon),
      temperatureEntity, humidityEntity, haAreaId: area.area_id, devices,
    };
  }

  _importAllAreas() {
    this._config.rooms = this._areas().map((a) => this._roomFromArea(a));
    this._roomIdx = 0; this._tab = "rooms";
    this._info = this._t("importedRooms", this._config.rooms.length);
    this._render({ keepPreview: true });
  }
  _addRoomFromArea(areaId) {
    const area = this._hass.areas?.[areaId];
    if (!area) return;
    if (this._config.rooms.some((r) => r.haAreaId === areaId || r.id === areaId)) {
      this._info = this._t("roomExists"); this._render({ keepPreview: true }); return;
    }
    this._config.rooms.push(this._roomFromArea(area));
    this._roomIdx = this._config.rooms.length - 1;
    this._info = this._t("roomAdded", area.name); this._render({ keepPreview: true });
  }
  _addEmptyRoom() {
    this._config.rooms.push({
      id: `room_${Date.now()}`, label: "Nova mistnost", icon: "Home",
      temperatureEntity: "", humidityEntity: "", devices: [],
    });
    this._roomIdx = this._config.rooms.length - 1; this._render();
  }
  _removeRoom(i) {
    this._config.rooms.splice(i, 1);
    this._roomIdx = Math.max(0, Math.min(this._roomIdx, this._config.rooms.length - 1));
    this._render();
  }
  _addDevice(room) {
    room.devices.push({ id: "", type: "light", label: "Zarizeni", supportsBrightness: true, icon: "Power" });
    this._render();
  }
  _addScene() {
    this._config.scenes.push({
      id: `scene_${Date.now()}`, label: "Nova scena", icon: "Sunset", accent: "#f59e0b", entityId: "",
    });
    this._tab = "scenes"; this._render();
  }
  _entities(domain, areaId = null) {
    let ids = Object.keys(this._hass?.states || {}).filter((id) => id.startsWith(`${domain}.`)).sort();
    if (areaId) {
      const inArea = new Set(this._entitiesInArea(areaId));
      const filtered = ids.filter((id) => inArea.has(id));
      if (filtered.length) ids = filtered;
    }
    return ids;
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
      .shell {
        /* Right column sized for iPhone 12 Pro preview (+ a little padding) */
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(420px, 0.72fr);
        gap: 16px; height: 100%; min-height: 100vh; padding: 16px;
      }
      @media (max-width: 1100px) {
        .shell { grid-template-columns: minmax(0, 1fr) 420px; }
      }
      @media (max-width: 980px) {
        .shell { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) minmax(560px, 70vh); }
      }
      .editor, .preview {
        min-height: 0; height: calc(100vh - 32px);
        background: var(--card); border: 1px solid var(--border); border-radius: 22px;
        overflow: hidden; display: flex; flex-direction: column;
      }
      .editor-scroll { overflow: auto; padding: 16px 16px 28px; flex: 1; }
      header {
        display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start;
        justify-content: space-between; margin-bottom: 14px;
      }
      h1 { margin: 0; font-size: 1.4rem; letter-spacing: -0.02em; }
      .sub { color: var(--muted); font-size: 0.88rem; margin-top: 4px; }
      .version {
        display: inline-flex; margin-top: 8px; padding: 4px 10px; border-radius: 999px;
        font-size: 0.75rem; font-weight: 700;
        background: color-mix(in srgb, var(--accent) 20%, transparent);
        border: 1px solid var(--border);
      }
      .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
      .tab, button, .btn {
        font: inherit; cursor: pointer; border: 0; border-radius: 999px;
        padding: 8px 14px; background: var(--btn); color: var(--btn-text);
      }
      .tab.active, .btn.primary { background: var(--btn-primary); color: var(--btn-primary-text); }
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
      input, select, textarea {
        width: 100%; font: inherit; padding: 10px 12px; border-radius: 12px;
        border: 1px solid var(--border);
        background-color: #fff !important; color: #111 !important;
        -webkit-text-fill-color: #111 !important; caret-color: #111 !important;
        opacity: 1 !important; color-scheme: light;
      }
      :host([dark]) input, :host([dark]) select, :host([dark]) textarea {
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
      .hint { font-size: 0.85rem; color: var(--muted); margin: 0 0 12px; line-height: 1.4; }
      .room-pills, .area-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
      .pill {
        padding: 6px 12px; border-radius: 999px; background: var(--btn);
        border: 1px solid var(--border); color: var(--text); font: inherit; cursor: pointer;
      }
      .pill.active { background: var(--accent); color: #fff; border-color: transparent; }
      .import-box {
        margin-bottom: 16px; padding: 14px; border-radius: 16px;
        border: 1px dashed var(--border);
      }
      h3 { margin: 18px 0 8px; font-size: 1rem; }
      .count { color: var(--muted); font-size: 0.8rem; }
      .preview-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 14px; border-bottom: 1px solid var(--border);
      }
      .preview-head strong { font-size: 0.92rem; }
      .preview-body {
        flex: 1; min-height: 0; display: grid; place-items: center; padding: 14px;
        background:
          radial-gradient(ellipse at 30% 20%, rgba(255,107,0,0.12), transparent 45%),
          radial-gradient(ellipse at 80% 80%, rgba(140,100,255,0.12), transparent 40%),
          var(--bg);
      }
      .phone-wrap {
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        width: 100%; max-width: 420px; min-height: 0; height: 100%;
        justify-content: center;
      }
      /* iPhone 12 Pro display: 1170×2532 px — CSS pt @3x = 390×844, slight flex to fit viewport */
      .phone {
        --iphone-w: ${IPHONE_12_PRO.cssW}px;
        --iphone-h: ${IPHONE_12_PRO.cssH}px;
        width: min(var(--iphone-w), 100%);
        height: auto;
        max-height: min(var(--iphone-h), calc(100vh - 130px));
        aspect-ratio: ${IPHONE_12_PRO.pxW} / ${IPHONE_12_PRO.pxH};
        border-radius: 36px; overflow: hidden; flex: 0 1 auto;
        border: 3px solid var(--phone-frame); background: #000;
        box-shadow: 0 20px 50px rgba(0,0,0,0.35);
      }
      .phone-meta {
        text-align: center; font-size: 0.72rem; color: var(--muted);
        letter-spacing: 0.02em; flex-shrink: 0;
      }
      .area-check {
        display: flex; align-items: center; gap: 10px; width: 100%;
        text-align: left; padding: 10px 12px; border-radius: 14px;
        border: 1px solid var(--border); background: var(--btn); color: var(--text);
        font: inherit; cursor: pointer;
      }
      .area-check.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent); }
      .area-check input { width: 16px; height: 16px; accent-color: var(--accent); }
      .area-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
      details.advanced {
        margin-top: 14px; border: 1px solid var(--border); border-radius: 16px; padding: 10px 12px;
      }
      details.advanced summary {
        cursor: pointer; font-weight: 650; color: var(--text); list-style: none;
      }
      .phone iframe { width: 100%; height: 100%; border: 0; background: #111; }
      .preview-empty {
        max-width: 260px; text-align: center; color: var(--muted); font-size: 0.9rem; line-height: 1.45;
      }
    `;
  }

  _desiredPreviewSrc() {
    const preview = this._previewSrc();
    if (!preview) return "";
    return `${preview}&_r=${this._previewKey}`;
  }

  _render(opts = {}) {
    const keepPreview = opts.keepPreview !== false;
    this._syncTheme();
    const c = this._config;
    if (!c.appearance) c.appearance = { mode: "light", accent: "#ff6b00" };
    const room = c.rooms[this._roomIdx];
    const areaFilter = room?.haAreaId || null;
    const sensors = this._entities("sensor", areaFilter);
    const lights = this._entities("light", areaFilter);
    const switches = this._entities("switch", areaFilter);
    const covers = this._entities("cover", areaFilter);
    const climates = this._entities("climate", areaFilter);
    const scenes = this._entities("scene");
    const areas = this._areas();
    const preview = this._previewSrc();
    const desiredSrc = this._desiredPreviewSrc();

    // Detach live iframe so innerHTML rebuild does not unload / reconnect the dashboard
    const prevFrame = this.shadowRoot.getElementById("previewFrame");
    const prevSrc = prevFrame?.getAttribute("src") || "";
    const canReuseFrame = Boolean(
      keepPreview && prevFrame && desiredSrc && prevSrc === desiredSrc,
    );
    if (canReuseFrame) prevFrame.remove();

    const scrollEl = this.shadowRoot.querySelector(".editor-scroll");
    const scrollTop = scrollEl?.scrollTop || 0;
    const activeId = this.shadowRoot.activeElement?.id || null;

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="shell">
        <section class="editor">
          <div class="editor-scroll">
            <header>
              <div>
                <h1>${this._t("title")}</h1>
                <div class="sub">${this._t("subtitle")}</div>
                <div class="version">v${PANEL_VERSION}</div>
              </div>
              <div class="toolbar">
                <div class="seg" title="${this._escape(this._t("panelLang"))}">
                  <button data-ui-lang="cs" class="${this._uiLang === "cs" ? "active" : ""}">CS</button>
                  <button data-ui-lang="en" class="${this._uiLang === "en" ? "active" : ""}">EN</button>
                </div>
                <div class="seg" title="Theme">
                  <button data-ui-theme="light" class="${this._uiTheme === "light" ? "active" : ""}">Light</button>
                  <button data-ui-theme="dark" class="${this._uiTheme === "dark" ? "active" : ""}">Dark</button>
                  <button data-ui-theme="auto" class="${this._uiTheme === "auto" ? "active" : ""}">Auto</button>
                </div>
                <button class="btn primary" id="save">${this._saving ? this._t("saving") : this._t("save")}</button>
              </div>
            </header>

            ${this._error ? `<div class="msg err">${this._escape(this._error)}</div>` : ""}
            ${this._info ? `<div class="msg ok">${this._escape(this._info)}</div>` : ""}
            ${this._savedAt ? `<div class="msg ok">${this._t("saved")} ${this._savedAt.toLocaleTimeString(this._uiLang === "en" ? "en-US" : "cs-CZ")}</div>` : ""}

            <div class="tabs">
              <button class="tab ${this._tab === "rooms" ? "active" : ""}" data-tab="rooms">${this._t("tabRooms")}</button>
              <button class="tab ${this._tab === "scenes" ? "active" : ""}" data-tab="scenes">${this._t("tabScenes")}</button>
              <button class="tab ${this._tab === "guest" ? "active" : ""}" data-tab="guest">${this._t("tabGuest")}</button>
              <button class="tab ${this._tab === "styles" ? "active" : ""}" data-tab="styles">${this._t("tabStyles")}</button>
            </div>

            ${this._tab === "guest" ? this._renderGuest(c) : ""}
            ${this._tab === "rooms" ? this._renderRooms(c, room, areas, sensors, lights, switches, covers, climates) : ""}
            ${this._tab === "scenes" ? this._renderScenes(c, scenes) : ""}
            ${this._tab === "styles" ? this._renderStyles(c) : ""}
          </div>
        </section>

        <aside class="preview">
          <div class="preview-head">
            <strong>${this._t("previewTitle")}</strong>
            <div class="seg">
              <button data-dash-mode="light" class="${this._dashMode() === "light" ? "active" : ""}">Light</button>
              <button data-dash-mode="dark" class="${this._dashMode() === "dark" ? "active" : ""}">Dark</button>
            </div>
          </div>
          <div class="preview-body">
            ${
              preview
                ? `<div class="phone-wrap">
                    <div class="phone"><iframe id="previewFrame" title="Guest dashboard preview" src="${this._escape(desiredSrc)}" allow="fullscreen"></iframe></div>
                    <div class="phone-meta">iPhone 12 Pro · ${IPHONE_12_PRO.pxW}×${IPHONE_12_PRO.pxH}px</div>
                   </div>`
                : `<div class="preview-empty">${this._t("previewEmpty")}</div>`
            }
          </div>
        </aside>
      </div>
    `;

    if (canReuseFrame) {
      const placeholder = this.shadowRoot.getElementById("previewFrame");
      placeholder?.replaceWith(prevFrame);
    }

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
      this._render({ keepPreview: true });
    });
    this.shadowRoot.getElementById("save")?.addEventListener("click", () => this._save());
    this._on("[data-ui-lang]", "click", (e) => {
      this._uiLang = e.currentTarget.dataset.uiLang === "en" ? "en" : "cs";
      localStorage.setItem(UI_LANG_KEY, this._uiLang);
      this._render({ keepPreview: true });
    });
    this._on("[data-ui-theme]", "click", (e) => {
      this._uiTheme = e.currentTarget.dataset.uiTheme;
      localStorage.setItem(UI_THEME_KEY, this._uiTheme);
      this._render({ keepPreview: true });
    });
    // Draft only — preview stays on last saved config until Save
    this._on("[data-dash-mode]", "click", (e) => {
      if (!this._config.appearance) this._config.appearance = emptyConfig().appearance;
      this._config.appearance.mode = e.currentTarget.dataset.dashMode;
      this._render({ keepPreview: true });
    });

    if (this._tab === "guest") this._bindGuest();
    if (this._tab === "rooms") this._bindRooms();
    if (this._tab === "scenes") this._bindScenes();
    if (this._tab === "styles") this._bindStyles();
  }

  _renderGuest(c) {
    const g = c.guestInfo || {};
    return `
      <p class="hint">${this._t("guestHint")}</p>
      <div class="row"><label>${this._t("dashboardUrl")}</label>
        <input id="dashboardUrl" value="${this._escape(c.dashboardUrl || "")}" placeholder="https://guest.example.com" /></div>
      <div class="row"><label>${this._t("welcomeTitle")}</label>
        <input id="welcomeTitle" value="${this._escape(g.welcomeTitle || "")}" /></div>
      <div class="row"><label>${this._t("welcomeSubtitle")}</label>
        <input id="welcomeSubtitle" value="${this._escape(g.welcomeSubtitle || "")}" /></div>
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
      ["dashboardUrl", (v) => { this._config.dashboardUrl = v; }],
      ["welcomeTitle", (v) => (this._config.guestInfo.welcomeTitle = v)],
      ["welcomeSubtitle", (v) => (this._config.guestInfo.welcomeSubtitle = v)],
      ["wifiSsid", (v) => (this._config.guestInfo.wifiSsid = v)],
      ["wifiPassword", (v) => (this._config.guestInfo.wifiPassword = v)],
      ["wifiSecurity", (v) => (this._config.guestInfo.wifiSecurity = v)],
    ];
    for (const [id, fn] of map) {
      const el = this.shadowRoot.getElementById(id);
      if (!el) continue;
      // Draft only — preview remounts after Save
      el.addEventListener("change", () => fn(el.value));
      el.addEventListener("input", () => fn(el.value));
    }
  }

  _renderStyles(c) {
    const a = c.appearance || {};
    const lang = a.language === "en" ? "en" : "cs";
    return `
      <p class="hint">${this._t("stylesHint")}</p>
      <div class="row"><label>${this._t("dashTheme")}</label>
        <div class="seg">
          <button type="button" data-style-mode="light" class="${a.mode !== "dark" ? "active" : ""}">Light</button>
          <button type="button" data-style-mode="dark" class="${a.mode === "dark" ? "active" : ""}">Dark</button>
        </div>
      </div>
      <div class="row"><label>${this._t("dashLanguage")}</label>
        <div class="seg">
          <button type="button" data-dash-lang="cs" class="${lang === "cs" ? "active" : ""}">${this._t("langCs")}</button>
          <button type="button" data-dash-lang="en" class="${lang === "en" ? "active" : ""}">${this._t("langEn")}</button>
        </div>
      </div>
      <div class="row"><label>${this._t("accent")}</label>
        <input id="accent" type="color" value="${this._escape(a.accent || "#ff6b00")}" /></div>
      <p class="hint">${this._t("stylesAfterSave")}</p>
    `;
  }

  _bindStyles() {
    this._on("[data-style-mode]", "click", (e) => {
      if (!this._config.appearance) this._config.appearance = emptyConfig().appearance;
      this._config.appearance.mode = e.currentTarget.dataset.styleMode;
      this._render({ keepPreview: true });
    });
    this._on("[data-dash-lang]", "click", (e) => {
      if (!this._config.appearance) this._config.appearance = emptyConfig().appearance;
      this._config.appearance.language = e.currentTarget.dataset.dashLang === "en" ? "en" : "cs";
      this._render({ keepPreview: true });
    });
    const accent = this.shadowRoot.getElementById("accent");
    accent?.addEventListener("input", () => {
      if (!this._config.appearance) this._config.appearance = emptyConfig().appearance;
      this._config.appearance.accent = accent.value;
    });
    accent?.addEventListener("change", () => {
      if (!this._config.appearance) this._config.appearance = emptyConfig().appearance;
      this._config.appearance.accent = accent.value;
      this._render({ keepPreview: true });
    });
  }

  _isAreaSelected(areaId) {
    return this._config.rooms.some((r) => r.haAreaId === areaId || r.id === areaId);
  }

  _toggleArea(areaId, on) {
    if (on) this._addRoomFromArea(areaId);
    else {
      const idx = this._config.rooms.findIndex((r) => r.haAreaId === areaId || r.id === areaId);
      if (idx >= 0) this._removeRoom(idx);
    }
  }

  _renderRooms(c, room, areas, sensors, lights, switches, covers, climates) {
    return `
      <p class="hint">${this._t("roomsHint")}</p>
      <div class="actions" style="margin-top:0">
        <button class="btn primary" id="importAreas">${this._t("importAreas")}</button>
        <button class="btn ghost" id="clearRooms">${this._t("clearRooms")}</button>
      </div>
      <div class="area-grid" style="margin-top:12px">
        ${areas.length ? areas.map((a) => {
          const on = this._isAreaSelected(a.area_id);
          const count = this._roomFromArea(a).devices.length;
          return `<button type="button" class="area-check ${on ? "on" : ""}" data-toggle-area="${this._escape(a.area_id)}" data-on="${on ? "1" : "0"}">
            <input type="checkbox" ${on ? "checked" : ""} tabindex="-1" />
            <span><b>${this._escape(a.name)}</b><br/><span class="count">${this._t("devicesCount", count)}</span></span>
          </button>`;
        }).join("") : `<p class="hint">${this._t("noAreas")}</p>`}
      </div>

      ${c.rooms.length ? `
        <details class="advanced">
          <summary>${this._t("advanced")}</summary>
          <div class="room-pills" style="margin-top:10px">
            ${c.rooms.map((r, i) => `<button class="pill ${i === this._roomIdx ? "active" : ""}" data-room="${i}">${this._escape(r.label || r.id)} <span class="count">(${(r.devices || []).length})</span></button>`).join("")}
          </div>
          ${!room ? "" : `
            <div class="row"><label>${this._t("roomName")}</label><input id="roomLabel" value="${this._escape(room.label || "")}" /></div>
            <div class="row"><label>${this._t("roomIcon")}</label>
              <select id="roomIcon">${ICON_OPTIONS.map((i) => `<option ${room.icon === i ? "selected" : ""}>${i}</option>`).join("")}</select></div>
            <div class="row"><label>${this._t("roomTemp")}</label>
              <select id="roomTemp"><option value="">-</option>${sensors.map((s) => `<option value="${s}" ${room.temperatureEntity === s ? "selected" : ""}>${this._escape(this._friendly(s))}</option>`).join("")}</select></div>
            <div class="row"><label>${this._t("roomHumidity")}</label>
              <select id="roomHum"><option value="">-</option>${sensors.map((s) => `<option value="${s}" ${room.humidityEntity === s ? "selected" : ""}>${this._escape(this._friendly(s))}</option>`).join("")}</select></div>
            <h3>${this._t("devices")}</h3>
            <div class="card-list">
              ${(room.devices || []).map((d, di) => {
                const pool = d.type === "light" ? lights : d.type === "switch" ? switches : d.type === "cover" ? covers : climates;
                return `<div class="device" data-di="${di}"><div class="device-grid">
                  <input data-k="label" value="${this._escape(d.label || "")}" placeholder="Label" />
                  <select data-k="type">${DEVICE_TYPES.map((t) => `<option value="${t}" ${d.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
                  <select data-k="id"><option value="">- entity -</option>${pool.map((e) => `<option value="${e}" ${d.id === e ? "selected" : ""}>${this._escape(this._friendly(e))}</option>`).join("")}</select>
                  <button class="btn danger" data-remove-device="${di}">${this._t("delete")}</button>
                </div></div>`;
              }).join("")}
            </div>
            <div class="actions">
              <button class="btn" id="addDevice">${this._t("addDevice")}</button>
              <button class="btn ghost" id="resyncRoom">${this._t("resyncRoom")}</button>
            </div>`}
        </details>` : ""}
    `;
  }

  _bindRooms() {
    this._on("[data-toggle-area]", "click", (e) => {
      const id = e.currentTarget.dataset.toggleArea;
      const on = e.currentTarget.dataset.on === "1";
      this._toggleArea(id, !on);
    });
    this.shadowRoot.getElementById("importAreas")?.addEventListener("click", () => this._importAllAreas());
    this.shadowRoot.getElementById("clearRooms")?.addEventListener("click", () => {
      this._config.rooms = [];
      this._roomIdx = 0;
      this._render();
    });
    this._on(".pill[data-room]", "click", (e) => { this._roomIdx = Number(e.currentTarget.dataset.room); this._render(); });
    this.shadowRoot.getElementById("addDevice")?.addEventListener("click", () => {
      const room = this._config.rooms[this._roomIdx];
      if (room) this._addDevice(room);
    });
    this.shadowRoot.getElementById("resyncRoom")?.addEventListener("click", () => {
      const room = this._config.rooms[this._roomIdx];
      const areaId = room?.haAreaId || room?.id;
      const area = this._hass.areas?.[areaId];
      if (!area || !room) return;
      const fresh = this._roomFromArea(area);
      this._config.rooms[this._roomIdx] = { ...fresh, label: room.label || fresh.label };
      this._info = this._t("roomResynced");
      this._render({ keepPreview: true });
    });

    const room = this._config.rooms[this._roomIdx];
    if (!room) return;
    const bind = (id, fn) => {
      const el = this.shadowRoot.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => { fn(el.value); this._render(); });
    };
    bind("roomLabel", (v) => (room.label = v));
    bind("roomIcon", (v) => (room.icon = v));
    bind("roomTemp", (v) => (room.temperatureEntity = v));
    bind("roomHum", (v) => (room.humidityEntity = v));
    this.shadowRoot.querySelectorAll(".device").forEach((card) => {
      const device = room.devices[Number(card.dataset.di)];
      card.querySelectorAll("[data-k]").forEach((el) => {
        el.addEventListener("change", () => {
          const key = el.dataset.k;
          device[key] = el.value;
          if (key === "type") { device.id = ""; device.supportsBrightness = el.value === "light"; }
          if (key === "id" && el.value) device.label = this._friendly(el.value);
          this._render();
        });
        if (el.tagName === "INPUT") el.addEventListener("input", () => { device[el.dataset.k] = el.value; });
      });
    });
    this._on("[data-remove-device]", "click", (e) => {
      room.devices.splice(Number(e.currentTarget.dataset.removeDevice), 1);
      this._render();
    });
  }

  _renderScenes(c, sceneEntities) {
    return `
      <p class="hint">${this._t("scenesHint")}</p>
      <div class="actions" style="margin-top:0"><button class="btn primary" id="addScene">+ ${this._t("addScene")}</button></div>
      <div class="card-list">
        ${(c.scenes || []).map((s, i) => `
          <div class="device" data-si="${i}"><div class="device-grid">
            <input data-k="label" value="${this._escape(s.label || "")}" placeholder="Label" />
            <select data-k="icon">${ICON_OPTIONS.map((ic) => `<option ${s.icon === ic ? "selected" : ""}>${ic}</option>`).join("")}</select>
            <select data-k="entityId"><option value="">- scene.* -</option>${sceneEntities.map((e) => `<option value="${e}" ${s.entityId === e ? "selected" : ""}>${this._escape(this._friendly(e))}</option>`).join("")}</select>
            <button class="btn danger" data-remove-scene="${i}">${this._t("delete")}</button>
          </div></div>`).join("")}
      </div>
    `;
  }

  _bindScenes() {
    this.shadowRoot.getElementById("addScene")?.addEventListener("click", () => this._addScene());
    this.shadowRoot.querySelectorAll(".device[data-si]").forEach((card) => {
      const scene = this._config.scenes[Number(card.dataset.si)];
      card.querySelectorAll("[data-k]").forEach((el) => {
        el.addEventListener("change", () => {
          scene[el.dataset.k] = el.value;
          if (el.dataset.k === "entityId" && el.value) { scene.label = this._friendly(el.value); this._render(); }
        });
        if (el.tagName === "INPUT") el.addEventListener("input", () => { scene[el.dataset.k] = el.value; });
      });
    });
    this._on("[data-remove-scene]", "click", (e) => {
      this._config.scenes.splice(Number(e.currentTarget.dataset.removeScene), 1);
      this._render();
    });
  }
}

customElements.define("guest-ha-dashboard-panel", GuestHaDashboardPanel);
