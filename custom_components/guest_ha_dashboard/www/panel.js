/**
 * Guest HA Dashboard — Home Assistant sidebar config panel.
 * Uses native HA areas/devices and follows light/dark theme.
 */
const ICON_OPTIONS = [
  "Sofa",
  "BedDouble",
  "Bath",
  "DoorOpen",
  "Home",
  "Lamp",
  "Tv",
  "Fan",
  "Flame",
  "Coffee",
  "Power",
  "Sunset",
  "Sunrise",
  "Clapperboard",
];

const DEVICE_TYPES = ["light", "switch", "cover", "climate"];

const AREA_ICON_MAP = {
  "mdi:sofa": "Sofa",
  "mdi:couch": "Sofa",
  "mdi:bed": "BedDouble",
  "mdi:bed-double": "BedDouble",
  "mdi:shower": "Bath",
  "mdi:bathtub": "Bath",
  "mdi:toilet": "Bath",
  "mdi:door": "DoorOpen",
  "mdi:door-open": "DoorOpen",
  "mdi:home": "Home",
  "mdi:lamp": "Lamp",
  "mdi:floor-lamp": "Lamp",
};

const emptyConfig = () => ({
  guestInfo: {
    welcomeTitle: "Vítejte u nás",
    welcomeSubtitle: "Ovládejte dům jako doma",
    wifiSsid: "",
    wifiPassword: "",
    wifiSecurity: "WPA",
  },
  scenes: [],
  rooms: [],
  dashboardUrl: "",
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
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._syncTheme();
    if (first) this._load();
    else this._render();
  }

  get hass() {
    return this._hass;
  }

  set narrow(val) {
    this._narrow = val;
    this._render();
  }

  connectedCallback() {
    this._syncTheme();
    this._render();
  }

  _isDark() {
    return Boolean(this._hass?.themes?.darkMode);
  }

  _syncTheme() {
    this.toggleAttribute("dark", this._isDark());
  }

  async _load() {
    if (!this._hass) return;
    try {
      const cfg = await this._hass.connection.sendMessagePromise({
        type: "guest_ha_dashboard/get_config",
      });
      this._config = { ...emptyConfig(), ...cfg };
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._render();
  }

  async _save() {
    if (!this._hass || this._saving) return;
    this._saving = true;
    this._error = null;
    this._render();
    try {
      const saved = await this._hass.connection.sendMessagePromise({
        type: "guest_ha_dashboard/set_config",
        config: this._config,
      });
      this._config = { ...emptyConfig(), ...saved };
      this._savedAt = new Date();
      this._info = "Uloženo — obnov hostovský tablet";
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._saving = false;
    this._render();
  }

  _escape(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  _friendly(entityId) {
    return this._hass?.states?.[entityId]?.attributes?.friendly_name || entityId;
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
      Object.values(devices)
        .filter((d) => d.area_id === areaId)
        .map((d) => d.id),
    );
    return Object.values(entities)
      .filter(
        (e) =>
          e.area_id === areaId || (e.device_id && deviceIds.has(e.device_id)),
      )
      .map((e) => e.entity_id)
      .sort();
  }

  _mapAreaIcon(mdi) {
    return AREA_ICON_MAP[mdi] || "Home";
  }

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
          id,
          type: domain,
          label: state?.attributes?.friendly_name || id.split(".")[1] || id,
          supportsBrightness: domain === "light",
          icon: "Power",
        });
      }
      if (domain === "sensor") {
        const dc = state?.attributes?.device_class;
        if (dc === "temperature" && !temperatureEntity) temperatureEntity = id;
        if (dc === "humidity" && !humidityEntity) humidityEntity = id;
      }
    }

    return {
      id: area.area_id,
      label: area.name,
      icon: this._mapAreaIcon(area.icon),
      temperatureEntity,
      humidityEntity,
      haAreaId: area.area_id,
      devices,
    };
  }

  _importAllAreas() {
    const rooms = this._areas().map((a) => this._roomFromArea(a));
    this._config.rooms = rooms;
    this._roomIdx = 0;
    this._tab = "rooms";
    this._info = `Naimportováno ${rooms.length} místností z Home Assistant Areas`;
    this._render();
  }

  _addRoomFromArea(areaId) {
    const area = this._hass.areas?.[areaId];
    if (!area) return;
    if (this._config.rooms.some((r) => r.haAreaId === areaId || r.id === areaId)) {
      this._info = "Tahle místnost už v configu je";
      this._render();
      return;
    }
    this._config.rooms.push(this._roomFromArea(area));
    this._roomIdx = this._config.rooms.length - 1;
    this._tab = "rooms";
    this._info = `Přidáno: ${area.name}`;
    this._render();
  }

  _addEmptyRoom() {
    this._config.rooms.push({
      id: `room_${Date.now()}`,
      label: "Nová místnost",
      icon: "Home",
      temperatureEntity: "",
      humidityEntity: "",
      devices: [],
    });
    this._roomIdx = this._config.rooms.length - 1;
    this._render();
  }

  _removeRoom(i) {
    this._config.rooms.splice(i, 1);
    this._roomIdx = Math.max(0, Math.min(this._roomIdx, this._config.rooms.length - 1));
    this._render();
  }

  _addDevice(room) {
    room.devices.push({
      id: "",
      type: "light",
      label: "Zařízení",
      supportsBrightness: true,
      icon: "Power",
    });
    this._render();
  }

  _addScene() {
    this._config.scenes.push({
      id: `scene_${Date.now()}`,
      label: "Nová scéna",
      icon: "Sunset",
      accent: "#f59e0b",
      entityId: "",
    });
    this._tab = "scenes";
    this._render();
  }

  _entities(domain, areaId = null) {
    let ids = Object.keys(this._hass?.states || {})
      .filter((id) => id.startsWith(`${domain}.`))
      .sort();
    if (areaId) {
      const inArea = new Set(this._entitiesInArea(areaId));
      ids = ids.filter((id) => inArea.has(id));
    }
    return ids;
  }

  _on(sel, event, fn) {
    this.shadowRoot.querySelectorAll(sel).forEach((el) => {
      el.addEventListener(event, fn);
    });
  }

  _styles() {
    return `
      :host {
        --bg: #f4f0f7;
        --card: rgba(255,255,255,0.82);
        --text: #1a1220;
        --muted: rgba(26,18,32,0.58);
        --border: rgba(0,0,0,0.08);
        --input-bg: #ffffff;
        --input-text: #111111;
        --accent: #ff6b00;
        --danger-bg: #fee2e2;
        --danger-text: #991b1b;
        --ok-bg: #dcfce7;
        --ok-text: #166534;
        --btn: #ffffff;
        --btn-text: #1a1220;
        --btn-primary: #1a1220;
        --btn-primary-text: #ffffff;
        display: block;
        height: 100%;
        overflow: auto;
        background: var(--bg);
        color: var(--text);
        font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, sans-serif);
        color-scheme: light;
        box-sizing: border-box;
      }
      :host([dark]) {
        --bg: #111318;
        --card: rgba(28,30,36,0.92);
        --text: #f3f4f6;
        --muted: rgba(243,244,246,0.62);
        --border: rgba(255,255,255,0.12);
        --input-bg: #1c1e24;
        --input-text: #f5f5f5;
        --danger-bg: #3f1d1d;
        --danger-text: #fecaca;
        --ok-bg: #14532d;
        --ok-text: #bbf7d0;
        --btn: #2a2d36;
        --btn-text: #f3f4f6;
        --btn-primary: #ff6b00;
        --btn-primary-text: #ffffff;
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 20px 16px 48px; }
      header {
        display: flex; flex-wrap: wrap; gap: 12px;
        align-items: flex-end; justify-content: space-between; margin-bottom: 16px;
      }
      h1 { margin: 0; font-size: 1.5rem; letter-spacing: -0.02em; color: var(--text); }
      .sub { color: var(--muted); font-size: 0.9rem; margin-top: 4px; }
      .glass {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 16px;
      }
      .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
      .tab, button, .btn {
        font: inherit; cursor: pointer; border: 0; border-radius: 999px;
        padding: 8px 14px; background: var(--btn); color: var(--btn-text);
      }
      .tab.active, .btn.primary { background: var(--btn-primary); color: var(--btn-primary-text); }
      .btn.danger { background: var(--danger-bg); color: var(--danger-text); }
      .btn.ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }
      .row {
        display: grid; grid-template-columns: 160px 1fr; gap: 10px;
        align-items: center; margin-bottom: 10px;
      }
      @media (max-width: 640px) { .row { grid-template-columns: 1fr; gap: 4px; } }
      label { font-size: 0.85rem; color: var(--muted); }
      input, select, textarea {
        width: 100%;
        font: inherit;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--input-bg) !important;
        color: var(--input-text) !important;
        -webkit-text-fill-color: var(--input-text) !important;
        caret-color: var(--input-text);
        opacity: 1 !important;
        color-scheme: inherit;
      }
      input::placeholder, textarea::placeholder {
        color: var(--muted);
        -webkit-text-fill-color: var(--muted);
        opacity: 0.8;
      }
      option { color: var(--input-text); background: var(--input-bg); }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
      .card-list { display: grid; gap: 10px; }
      .device {
        display: grid; gap: 8px; padding: 12px; border-radius: 16px;
        background: color-mix(in srgb, var(--input-bg) 80%, transparent);
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
        border: 1px dashed var(--border); background: color-mix(in srgb, var(--card) 70%, transparent);
      }
      h3 { margin: 18px 0 8px; font-size: 1rem; color: var(--text); }
      .count { color: var(--muted); font-size: 0.8rem; }
    `;
  }

  _render() {
    this._syncTheme();
    const c = this._config;
    const room = c.rooms[this._roomIdx];
    const areaFilter = room?.haAreaId || null;
    const sensors = this._entities("sensor", areaFilter);
    const lights = this._entities("light", areaFilter);
    const switches = this._entities("switch", areaFilter);
    const covers = this._entities("cover", areaFilter);
    const climates = this._entities("climate", areaFilter);
    // If area filter yields nothing useful, fall back to all
    const allSensors = sensors.length ? sensors : this._entities("sensor");
    const allLights = lights.length ? lights : this._entities("light");
    const allSwitches = switches.length ? switches : this._entities("switch");
    const allCovers = covers.length ? covers : this._entities("cover");
    const allClimates = climates.length ? climates : this._entities("climate");
    const scenes = this._entities("scene");
    const areas = this._areas();

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="wrap">
        <header>
          <div>
            <h1>Guest Dashboard</h1>
            <div class="sub">Nastavení hostovského tabletu z Home Assistant místností</div>
          </div>
          <div class="actions" style="margin:0">
            <button class="btn primary" id="save" ${this._saving ? "disabled" : ""}>
              ${this._saving ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </header>

        ${this._error ? `<div class="msg err">${this._escape(this._error)}</div>` : ""}
        ${this._info ? `<div class="msg ok">${this._escape(this._info)}</div>` : ""}
        ${
          this._savedAt
            ? `<div class="msg ok">Uloženo ${this._savedAt.toLocaleTimeString()}</div>`
            : ""
        }

        <div class="tabs">
          <button class="tab ${this._tab === "rooms" ? "active" : ""}" data-tab="rooms">Místnosti</button>
          <button class="tab ${this._tab === "scenes" ? "active" : ""}" data-tab="scenes">Scény</button>
          <button class="tab ${this._tab === "guest" ? "active" : ""}" data-tab="guest">Host & Wi‑Fi</button>
        </div>

        <div class="glass">
          ${this._tab === "guest" ? this._renderGuest(c) : ""}
          ${this._tab === "rooms" ? this._renderRooms(c, room, areas, allSensors, allLights, allSwitches, allCovers, allClimates) : ""}
          ${this._tab === "scenes" ? this._renderScenes(c, scenes) : ""}
        </div>
      </div>
    `;

    this._on(".tab", "click", (e) => {
      this._tab = e.currentTarget.dataset.tab;
      this._info = null;
      this._render();
    });
    this.shadowRoot.getElementById("save")?.addEventListener("click", () => this._save());

    if (this._tab === "guest") this._bindGuest();
    if (this._tab === "rooms") this._bindRooms();
    if (this._tab === "scenes") this._bindScenes();
  }

  _renderGuest(c) {
    const g = c.guestInfo || {};
    return `
      <p class="hint">Texty na hostovském tabletu a údaje pro Wi‑Fi QR.</p>
      <div class="row"><label>URL hostovského PWA</label>
        <input id="dashboardUrl" value="${this._escape(c.dashboardUrl || "")}" placeholder="https://guest.example.com" /></div>
      <div class="row"><label>Uvítací titulek</label>
        <input id="welcomeTitle" value="${this._escape(g.welcomeTitle || "")}" /></div>
      <div class="row"><label>Podtitulek</label>
        <input id="welcomeSubtitle" value="${this._escape(g.welcomeSubtitle || "")}" /></div>
      <div class="row"><label>Wi‑Fi SSID</label>
        <input id="wifiSsid" value="${this._escape(g.wifiSsid || "")}" /></div>
      <div class="row"><label>Wi‑Fi heslo</label>
        <input id="wifiPassword" type="password" value="${this._escape(g.wifiPassword || "")}" /></div>
      <div class="row"><label>Zabezpečení</label>
        <select id="wifiSecurity">
          ${["WPA", "WPA2", "WEP", "nopass"]
            .map((s) => `<option value="${s}" ${g.wifiSecurity === s ? "selected" : ""}>${s}</option>`)
            .join("")}
        </select></div>
    `;
  }

  _bindGuest() {
    const map = [
      ["dashboardUrl", (v) => (this._config.dashboardUrl = v)],
      ["welcomeTitle", (v) => (this._config.guestInfo.welcomeTitle = v)],
      ["welcomeSubtitle", (v) => (this._config.guestInfo.welcomeSubtitle = v)],
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

  _renderRooms(c, room, areas, sensors, lights, switches, covers, climates) {
    return `
      <div class="import-box">
        <p class="hint" style="margin:0 0 10px">
          Domov už máš v HA rozdělený do <b>Areas (místností)</b>.
          Jedním klikem je načti sem i se zařízeními light / switch / cover / climate.
        </p>
        <div class="actions" style="margin:0">
          <button class="btn primary" id="importAreas">Importovat všechny místnosti z HA</button>
        </div>
        ${
          areas.length
            ? `<p class="hint" style="margin:12px 0 6px">Nebo přidej jednu Area:</p>
               <div class="area-pills">
                 ${areas
                   .map(
                     (a) =>
                       `<button class="pill" data-add-area="${this._escape(a.area_id)}">${this._escape(a.name)}</button>`,
                   )
                   .join("")}
               </div>`
            : `<p class="hint">V HA zatím nemáš žádné Areas — vytvoř je v Settings → Areas.</p>`
        }
      </div>

      <div class="actions" style="margin-top:0">
        <button class="btn ghost" id="addRoom">+ Prázdná místnost</button>
      </div>

      <div class="room-pills">
        ${c.rooms
          .map(
            (r, i) =>
              `<button class="pill ${i === this._roomIdx ? "active" : ""}" data-room="${i}">
                ${this._escape(r.label || r.id)}
                <span class="count">(${(r.devices || []).length})</span>
              </button>`,
          )
          .join("")}
      </div>

      ${
        !room
          ? `<p class="hint">Zatím žádná místnost — importuj Areas z HA výše.</p>`
          : `
        <div class="row"><label>Název</label><input id="roomLabel" value="${this._escape(room.label || "")}" /></div>
        <div class="row"><label>ID</label><input id="roomId" value="${this._escape(room.id || "")}" /></div>
        <div class="row"><label>Ikona</label>
          <select id="roomIcon">${ICON_OPTIONS.map((i) => `<option ${room.icon === i ? "selected" : ""}>${i}</option>`).join("")}</select></div>
        <div class="row"><label>Teplota</label>
          <select id="roomTemp"><option value="">—</option>${sensors.map((s) => `<option value="${s}" ${room.temperatureEntity === s ? "selected" : ""}>${this._escape(this._friendly(s))}</option>`).join("")}</select></div>
        <div class="row"><label>Vlhkost</label>
          <select id="roomHum"><option value="">—</option>${sensors.map((s) => `<option value="${s}" ${room.humidityEntity === s ? "selected" : ""}>${this._escape(this._friendly(s))}</option>`).join("")}</select></div>

        <h3>Zařízení</h3>
        <div class="card-list">
          ${(room.devices || [])
            .map((d, di) => {
              const pool =
                d.type === "light"
                  ? lights
                  : d.type === "switch"
                    ? switches
                    : d.type === "cover"
                      ? covers
                      : climates;
              return `
              <div class="device" data-di="${di}">
                <div class="device-grid">
                  <input data-k="label" value="${this._escape(d.label || "")}" placeholder="Popisek" />
                  <select data-k="type">${DEVICE_TYPES.map((t) => `<option value="${t}" ${d.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
                  <select data-k="id"><option value="">— entity —</option>${pool.map((e) => `<option value="${e}" ${d.id === e ? "selected" : ""}>${this._escape(this._friendly(e))}</option>`).join("")}</select>
                  <button class="btn danger" data-remove-device="${di}">Smazat</button>
                </div>
              </div>`;
            })
            .join("")}
        </div>
        <div class="actions">
          <button class="btn" id="addDevice">+ Zařízení</button>
          <button class="btn danger" id="removeRoom">Smazat místnost</button>
        </div>
      `
      }
    `;
  }

  _bindRooms() {
    this._on(".pill[data-room]", "click", (e) => {
      this._roomIdx = Number(e.currentTarget.dataset.room);
      this._render();
    });
    this.shadowRoot.getElementById("importAreas")?.addEventListener("click", () => {
      if (!confirm("Nahradit aktuální místnosti importem ze všech HA Areas?")) return;
      this._importAllAreas();
    });
    this._on("[data-add-area]", "click", (e) => {
      this._addRoomFromArea(e.currentTarget.dataset.addArea);
    });
    this.shadowRoot.getElementById("addRoom")?.addEventListener("click", () => this._addEmptyRoom());
    this.shadowRoot.getElementById("removeRoom")?.addEventListener("click", () => this._removeRoom(this._roomIdx));
    this.shadowRoot.getElementById("addDevice")?.addEventListener("click", () => {
      const room = this._config.rooms[this._roomIdx];
      if (room) this._addDevice(room);
    });

    const room = this._config.rooms[this._roomIdx];
    if (!room) return;

    const bind = (id, fn) => {
      const el = this.shadowRoot.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        fn(el.value);
        this._render();
      });
    };
    bind("roomLabel", (v) => (room.label = v));
    bind("roomId", (v) => (room.id = v));
    bind("roomIcon", (v) => (room.icon = v));
    bind("roomTemp", (v) => (room.temperatureEntity = v));
    bind("roomHum", (v) => (room.humidityEntity = v));

    this.shadowRoot.querySelectorAll(".device").forEach((card) => {
      const di = Number(card.dataset.di);
      const device = room.devices[di];
      card.querySelectorAll("[data-k]").forEach((el) => {
        el.addEventListener("change", () => {
          const key = el.dataset.k;
          device[key] = el.value;
          if (key === "type") {
            device.id = "";
            device.supportsBrightness = el.value === "light";
          }
          if (key === "id" && el.value) {
            device.label = this._friendly(el.value);
          }
          this._render();
        });
        if (el.tagName === "INPUT") {
          el.addEventListener("input", () => {
            device[el.dataset.k] = el.value;
          });
        }
      });
    });
    this._on("[data-remove-device]", "click", (e) => {
      room.devices.splice(Number(e.currentTarget.dataset.removeDevice), 1);
      this._render();
    });
  }

  _renderScenes(c, sceneEntities) {
    return `
      <p class="hint">Rychlé scény v horní liště hostovského tabletu.</p>
      <div class="actions" style="margin-top:0">
        <button class="btn primary" id="addScene">+ Scéna</button>
      </div>
      <div class="card-list">
        ${(c.scenes || [])
          .map(
            (s, i) => `
          <div class="device" data-si="${i}">
            <div class="device-grid">
              <input data-k="label" value="${this._escape(s.label || "")}" placeholder="Popisek" />
              <select data-k="icon">${ICON_OPTIONS.map((ic) => `<option ${s.icon === ic ? "selected" : ""}>${ic}</option>`).join("")}</select>
              <select data-k="entityId"><option value="">— scene.* —</option>${sceneEntities.map((e) => `<option value="${e}" ${s.entityId === e ? "selected" : ""}>${this._escape(this._friendly(e))}</option>`).join("")}</select>
              <button class="btn danger" data-remove-scene="${i}">Smazat</button>
            </div>
          </div>`,
          )
          .join("")}
      </div>
    `;
  }

  _bindScenes() {
    this.shadowRoot.getElementById("addScene")?.addEventListener("click", () => this._addScene());
    this.shadowRoot.querySelectorAll(".device[data-si]").forEach((card) => {
      const si = Number(card.dataset.si);
      const scene = this._config.scenes[si];
      card.querySelectorAll("[data-k]").forEach((el) => {
        el.addEventListener("change", () => {
          scene[el.dataset.k] = el.value;
          if (el.dataset.k === "entityId" && el.value) {
            scene.label = this._friendly(el.value);
            this._render();
          }
        });
        if (el.tagName === "INPUT") {
          el.addEventListener("input", () => {
            scene[el.dataset.k] = el.value;
          });
        }
      });
    });
    this._on("[data-remove-scene]", "click", (e) => {
      this._config.scenes.splice(Number(e.currentTarget.dataset.removeScene), 1);
      this._render();
    });
  }
}

customElements.define("guest-ha-dashboard-panel", GuestHaDashboardPanel);
