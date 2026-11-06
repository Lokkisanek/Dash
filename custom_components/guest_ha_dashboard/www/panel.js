/**
 * Guest HA Dashboard — Home Assistant sidebar config panel.
 * Custom element receives `hass`, `narrow`, `panel` from HA.
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
    this._tab = "guest";
    this._roomIdx = 0;
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
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
    this._render();
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
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._saving = false;
    this._render();
  }

  _entities(domain) {
    if (!this._hass?.states) return [];
    return Object.keys(this._hass.states)
      .filter((id) => id.startsWith(`${domain}.`))
      .sort();
  }

  _setGuest(key, value) {
    this._config.guestInfo = { ...this._config.guestInfo, [key]: value };
    this._render();
  }

  _addRoom() {
    this._config.rooms.push({
      id: `room_${Date.now()}`,
      label: "Nová místnost",
      icon: "Home",
      temperatureEntity: "",
      humidityEntity: "",
      devices: [],
    });
    this._roomIdx = this._config.rooms.length - 1;
    this._tab = "rooms";
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

  _on(sel, event, fn) {
    this.shadowRoot.querySelectorAll(sel).forEach((el) => {
      el.addEventListener(event, fn);
    });
  }

  _render() {
    const c = this._config;
    const room = c.rooms[this._roomIdx];
    const sensors = this._entities("sensor");
    const lights = this._entities("light");
    const switches = this._entities("switch");
    const covers = this._entities("cover");
    const climates = this._entities("climate");
    const scenes = this._entities("scene");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          background: linear-gradient(160deg, #f3eef8 0%, #ffe8f0 45%, #fff0e6 100%);
          color: #1a1220;
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          box-sizing: border-box;
        }
        * { box-sizing: border-box; }
        .wrap {
          max-width: 980px;
          margin: 0 auto;
          padding: 20px 16px 48px;
        }
        header {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: flex-end;
          justify-content: space-between;
          margin-bottom: 18px;
        }
        h1 {
          margin: 0;
          font-size: 1.55rem;
          letter-spacing: -0.02em;
        }
        .sub { opacity: 0.55; font-size: 0.9rem; margin-top: 4px; }
        .glass {
          background: rgba(255,255,255,0.55);
          backdrop-filter: blur(18px) saturate(1.4);
          -webkit-backdrop-filter: blur(18px) saturate(1.4);
          border: 1px solid rgba(255,255,255,0.7);
          border-radius: 20px;
          padding: 16px;
          box-shadow: 0 10px 30px rgba(40,20,60,0.06);
        }
        .tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .tab, button, .btn {
          font: inherit;
          cursor: pointer;
          border: 0;
          border-radius: 999px;
          padding: 8px 14px;
          background: rgba(255,255,255,0.7);
          color: #1a1220;
        }
        .tab.active, .btn.primary {
          background: #1a1220;
          color: #fff;
        }
        .btn.danger { background: #fee2e2; color: #991b1b; }
        .btn.ghost { background: transparent; border: 1px solid rgba(0,0,0,0.08); }
        .row {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 10px;
          align-items: center;
          margin-bottom: 10px;
        }
        @media (max-width: 640px) {
          .row { grid-template-columns: 1fr; gap: 4px; }
        }
        label { font-size: 0.85rem; opacity: 0.7; }
        input, select, textarea {
          width: 100%;
          font: inherit;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(0,0,0,0.08);
          background: rgba(255,255,255,0.85);
        }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
        .card-list { display: grid; gap: 10px; }
        .device {
          display: grid;
          gap: 8px;
          padding: 12px;
          border-radius: 16px;
          background: rgba(255,255,255,0.65);
          border: 1px solid rgba(255,255,255,0.8);
        }
        .device-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr 1fr auto;
          gap: 8px;
          align-items: center;
        }
        @media (max-width: 720px) {
          .device-grid { grid-template-columns: 1fr; }
        }
        .msg { margin: 10px 0; padding: 10px 12px; border-radius: 12px; font-size: 0.9rem; }
        .msg.err { background: #fee2e2; color: #991b1b; }
        .msg.ok { background: #dcfce7; color: #166534; }
        .hint { font-size: 0.82rem; opacity: 0.55; margin: 0 0 12px; }
        .room-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
        .pill {
          padding: 6px 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.7);
          border: 0;
          font: inherit;
          cursor: pointer;
        }
        .pill.active { background: #ff6b00; color: #fff; }
      </style>
      <div class="wrap">
        <header>
          <div>
            <h1>Guest Dashboard</h1>
            <div class="sub">Nastavení hostovského PWA — změny se projeví po uložení</div>
          </div>
          <div class="actions">
            <button class="btn primary" id="save" ${this._saving ? "disabled" : ""}>
              ${this._saving ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </header>

        ${this._error ? `<div class="msg err">${this._escape(this._error)}</div>` : ""}
        ${
          this._savedAt
            ? `<div class="msg ok">Uloženo ${this._savedAt.toLocaleTimeString()}</div>`
            : ""
        }

        <div class="tabs">
          <button class="tab ${this._tab === "guest" ? "active" : ""}" data-tab="guest">Host & Wi‑Fi</button>
          <button class="tab ${this._tab === "rooms" ? "active" : ""}" data-tab="rooms">Místnosti</button>
          <button class="tab ${this._tab === "scenes" ? "active" : ""}" data-tab="scenes">Scény</button>
        </div>

        <div class="glass">
          ${this._tab === "guest" ? this._renderGuest(c) : ""}
          ${this._tab === "rooms" ? this._renderRooms(c, room, sensors, lights, switches, covers, climates) : ""}
          ${this._tab === "scenes" ? this._renderScenes(c, scenes) : ""}
        </div>
      </div>
    `;

    this._on(".tab", "click", (e) => {
      this._tab = e.currentTarget.dataset.tab;
      this._render();
    });
    this.shadowRoot.getElementById("save")?.addEventListener("click", () => this._save());

    if (this._tab === "guest") this._bindGuest();
    if (this._tab === "rooms") this._bindRooms(lights, switches, covers, climates);
    if (this._tab === "scenes") this._bindScenes();
  }

  _escape(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
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
            .map(
              (s) =>
                `<option value="${s}" ${g.wifiSecurity === s ? "selected" : ""}>${s}</option>`,
            )
            .join("")}
        </select></div>
    `;
  }

  _bindGuest() {
    const map = [
      ["dashboardUrl", (v) => (this._config.dashboardUrl = v)],
      ["welcomeTitle", (v) => this._setGuest("welcomeTitle", v)],
      ["welcomeSubtitle", (v) => this._setGuest("welcomeSubtitle", v)],
      ["wifiSsid", (v) => this._setGuest("wifiSsid", v)],
      ["wifiPassword", (v) => this._setGuest("wifiPassword", v)],
      ["wifiSecurity", (v) => this._setGuest("wifiSecurity", v)],
    ];
    for (const [id, fn] of map) {
      const el = this.shadowRoot.getElementById(id);
      if (!el) continue;
      el.addEventListener("change", () => fn(el.value));
      el.addEventListener("input", () => fn(el.value));
    }
  }

  _renderRooms(c, room, sensors, lights, switches, covers, climates) {
    return `
      <div class="actions" style="margin-top:0">
        <button class="btn primary" id="addRoom">+ Místnost</button>
      </div>
      <div class="room-pills">
        ${c.rooms
          .map(
            (r, i) =>
              `<button class="pill ${i === this._roomIdx ? "active" : ""}" data-room="${i}">${this._escape(r.label || r.id)}</button>`,
          )
          .join("")}
      </div>
      ${
        !room
          ? `<p class="hint">Zatím žádná místnost — přidej první.</p>`
          : `
        <div class="row"><label>Název</label><input id="roomLabel" value="${this._escape(room.label || "")}" /></div>
        <div class="row"><label>ID</label><input id="roomId" value="${this._escape(room.id || "")}" /></div>
        <div class="row"><label>Ikona</label>
          <select id="roomIcon">${ICON_OPTIONS.map((i) => `<option ${room.icon === i ? "selected" : ""}>${i}</option>`).join("")}</select></div>
        <div class="row"><label>Teplota</label>
          <select id="roomTemp"><option value="">—</option>${sensors.map((s) => `<option value="${s}" ${room.temperatureEntity === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="row"><label>Vlhkost</label>
          <select id="roomHum"><option value="">—</option>${sensors.map((s) => `<option value="${s}" ${room.humidityEntity === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>

        <h3 style="margin:18px 0 8px;font-size:1rem">Zařízení</h3>
        <div class="card-list" id="devices">
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
                  <select data-k="id"><option value="">— entity —</option>${pool.map((e) => `<option value="${e}" ${d.id === e ? "selected" : ""}>${e}</option>`).join("")}</select>
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
    this.shadowRoot.getElementById("addRoom")?.addEventListener("click", () => this._addRoom());
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
          if (key === "type") device.id = "";
          this._render();
        });
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
              <select data-k="entityId"><option value="">— scene.* —</option>${sceneEntities.map((e) => `<option value="${e}" ${s.entityId === e ? "selected" : ""}>${e}</option>`).join("")}</select>
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
        });
      });
    });
    this._on("[data-remove-scene]", "click", (e) => {
      this._config.scenes.splice(Number(e.currentTarget.dataset.removeScene), 1);
      this._render();
    });
  }
}

customElements.define("guest-ha-dashboard-panel", GuestHaDashboardPanel);
