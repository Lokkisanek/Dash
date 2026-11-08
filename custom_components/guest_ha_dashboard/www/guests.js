/**
 * "Hosté / Guests" tab of the dash panel: profiles, passes, pairing QR, print
 * card and audit log. Plain JS, no build step. Talks only to the admin
 * websocket commands guest_ha_dashboard/* (docs/GUEST_PASSES.md).
 */
import qrcode from "./vendor/qrcode-generator/qrcode.js?v=2.0.0";
import { stringToBytes as utf8Bytes } from "./vendor/qrcode-generator/qrcode_UTF8.js?v=2.0.0";

qrcode.stringToBytes = utf8Bytes;

const WS = "guest_ha_dashboard";

/** Same defaults as GUEST_CAPABILITY_DEFAULTS in const.py (checked by tests/pure). */
const CAPABILITY_DEFAULTS = { allow_color: false, allow_color_temp: true, allow_effects: false, max_transition: 5, media_browse: false, media_group: false, max_volume: 0.7, allow_local_player: false, spotify_control: false, spotify_search: false, library_browse: false, library_request: false, library_pick_release: false, library_activity: false, library_max_per_day: 3, library_allow_tv: true };
const CAPABILITY_TOGGLES = ["allow_color", "allow_color_temp", "allow_effects", "media_browse", "media_group", "allow_local_player", "spotify_control", "spotify_search", "library_browse", "library_request", "library_allow_tv", "library_activity", "library_pick_release"];
/** Toggles that get a visible warning under them when switched on. */
const CAPABILITY_WARN = { library_pick_release: "warn_library_pick_release" };
const LIBRARY_DAY_STEPS = [1, 3, 5, 10];
const MAX_VOLUME_STEPS = [0.3, 0.5, 0.7, 0.85, 1];

const I18N = {
  cs: {
    loading: "Načítám…",
    ownerWarn:
      "Přihlášení vlastníka (účtem Home Assistantu) má plný přístup ke všemu. Hostům dejte přístup níže: integrace jim povolí jen zařízení ze šablony a jen na určenou dobu.",
    passes: "Přístupy",
    createPass: "Vytvořit přístup",
    needProfile: "Nejdřív vytvořte šablonu pokoje.",
    profile: "Šablona",
    label: "Označení",
    labelPh: "Pokoj 3 – Novák",
    kind: "Zařízení",
    kindPhone: "Telefon hosta",
    kindTablet: "Tablet na zdi",
    validFrom: "Od",
    validUntil: "Do",
    noEnd: "Bez konce",
    create: "Vytvořit",
    cancel: "Zrušit",
    save: "Uložit",
    done: "Hotovo",
    codeValid: (t) => `Kód platí ještě ${t} a jen jednou.`,
    codeExpired: "Kód vypršel, vytvořte nový.",
    print: "Tisk A6",
    printA4: "Tisk A4",
    copyLink: "Kopírovat odkaz",
    copied: "Zkopírováno",
    haUrlHint: (u) => `Zařízení hosta se připojí k ${u}. Musí být dostupné přes HTTPS.`,
    colLabel: "Označení",
    colProfile: "Šablona",
    colKind: "Typ",
    colStatus: "Stav",
    colUntil: "Platí do",
    colSeen: "Naposledy",
    st_active: "Aktivní",
    st_pending: "Čeká na začátek",
    st_expired: "Vypršel",
    st_revoked: "Zrušen",
    notPaired: "nespárováno",
    never: "–",
    noEndShort: "bez konce",
    newCode: "QR / nový kód",
    extend: "Prodloužit",
    revoke: "Ukončit",
    del: "Smazat",
    confirmRevoke: "Ukončit přístup? Zařízení hosta se okamžitě odpojí.",
    confirmDelete: "Smazat přístup?",
    noPasses: "Zatím žádné přístupy.",
    profiles: "Šablony pokojů",
    fromArea: "Z místnosti",
    pickArea: "Vyberte místnost…",
    emptyProfile: "Prázdná šablona",
    devices: (n) => `${n} zařízení`,
    editDevices: "Zařízení",
    wifi: "Wi-Fi hostům",
    capsTitle: "Co smí host navíc",
    cap_allow_color: "Barva světel",
    cap_allow_color_temp: "Teplota bílé",
    cap_allow_effects: "Efekty světel",
    cap_media_browse: "Procházet a pouštět hudbu",
    cap_media_group: "Seskupovat reproduktory",
    cap_allow_local_player: "Rádio v telefonu hosta (stanice jen ke čtení)",
    cap_spotify_control: "Ovládat Spotify (přes Home Assistant, bez přístupu k účtu)",
    cap_spotify_search: "Hledat ve Spotify a pouštět nalezené",
    cap_library_browse: "Videotéka: procházet a hledat filmy a seriály",
    cap_library_request: "Videotéka: požádat o film nebo seriál (schvaluješ ty)",
    cap_library_allow_tv: "Videotéka: i seriály",
    cap_library_activity: "Videotéka: vidět, co se stahuje",
    cap_library_pick_release: "Videotéka: host si sám vybere release",
    warn_library_pick_release: "Host si může sám vybrat, co se stáhne. Nedoporučeno.",
    library_per_day: "Žádostí za den",
    maxVolume: "Nejvyšší hlasitost",
    mediaCapsHint: "Procházení ukáže hostovi knihovnu přehrávače z jeho šablony a dovolí pustit jen to, co v ní našel. Odkazy na proudy a soubory se nepustí nikdy.",
    capsHint: "Platí pro všechna světla v profilu a jen tam, kde to světlo umí. Jas omezíš u každého světla zvlášť.",
    confirmDeleteProfile: "Smazat šablonu?",
    noProfiles: "Zatím žádné šablony.",
    name: "Název",
    search: "Hledat…",
    allAreas: "Všechny místnosti",
    noArea: "Bez místnosti",
    readOnly: "jen zobrazení",
    limits: "Rozsah",
    limitDefault: (a, b) => `výchozí ${a}–${b}`,
    reason_domain_denied: "nepovoleno pro hosty (zámky, alarmy, kamery, skripty…)",
    reason_domain_unsupported: "tento typ zařízení zatím nelze",
    reason_device_class_denied: "garážová vrata, brány a dveře nelze",
    reason_bad_request: "neplatná entita",
    skipped: (n) => `${n} zařízení v místnosti nelze hostům povolit.`,
    audit: "Záznam",
    allEvents: "Všechny události",
    noAudit: "Žádné záznamy.",
    ev_pair_code_created: "Nový kód",
    ev_pair_ok: "Spárováno",
    ev_pair_failed: "Neplatný kód",
    ev_pass_created: "Přístup vytvořen",
    ev_pass_revoked: "Přístup ukončen",
    ev_pass_extended: "Přístup prodloužen",
    ev_pass_deleted: "Přístup smazán",
    ev_pass_expired: "Přístup vypršel",
    ev_auth_failed: "Neplatné přihlášení",
    ev_call_denied: "Akce odmítnuta",
    ev_profile_saved: "Šablona uložena",
    ev_profile_deleted: "Šablona smazána",
    printTitle: "Ovládání pokoje",
    printSteps:
      "1. Naskenujte QR kód telefonem.\n2. Na iPhonu: Sdílet → Přidat na plochu, pak aplikaci otevřete z plochy a zadejte kód níže.\n3. Kód platí 15 minut a jen jednou. Pokud vypršel, požádejte o nový.",
    printStepsEn:
      "Scan the QR code with your phone. On iPhone: Share → Add to Home Screen, open the app and enter the code below. The code works once, for 15 minutes; ask for a new one if it expired.",
    printWifi: "Wi-Fi",
    printPassword: "Heslo",
    printUntil: (d) => `Přístup platí do ${d}.`,
  },
  en: {
    loading: "Loading…",
    ownerWarn:
      "Owner sign-in (a Home Assistant account) has full access to everything. Give guests a pass below: the integration only allows the devices of the profile, and only for the given time.",
    passes: "Passes",
    createPass: "Create pass",
    needProfile: "Create a room profile first.",
    profile: "Profile",
    label: "Label",
    labelPh: "Room 3 – Smith",
    kind: "Device",
    kindPhone: "Guest phone",
    kindTablet: "Wall tablet",
    validFrom: "From",
    validUntil: "Until",
    noEnd: "No end",
    create: "Create",
    cancel: "Cancel",
    save: "Save",
    done: "Done",
    codeValid: (t) => `The code works for ${t} more, once.`,
    codeExpired: "The code expired, create a new one.",
    print: "Print A6",
    printA4: "Print A4",
    copyLink: "Copy link",
    copied: "Copied",
    haUrlHint: (u) => `The guest device connects to ${u}. It must be reachable over HTTPS.`,
    colLabel: "Label",
    colProfile: "Profile",
    colKind: "Type",
    colStatus: "Status",
    colUntil: "Valid until",
    colSeen: "Last seen",
    st_active: "Active",
    st_pending: "Not started",
    st_expired: "Expired",
    st_revoked: "Revoked",
    notPaired: "not paired",
    never: "–",
    noEndShort: "no end",
    newCode: "QR / new code",
    extend: "Extend",
    revoke: "End",
    del: "Delete",
    confirmRevoke: "End this pass? The guest device disconnects immediately.",
    confirmDelete: "Delete this pass?",
    noPasses: "No passes yet.",
    profiles: "Room profiles",
    fromArea: "From area",
    pickArea: "Choose an area…",
    emptyProfile: "Empty profile",
    devices: (n) => `${n} devices`,
    editDevices: "Devices",
    wifi: "Wi-Fi for guests",
    capsTitle: "Extra guest controls",
    cap_allow_color: "Light colour",
    cap_allow_color_temp: "White temperature",
    cap_allow_effects: "Light effects",
    cap_media_browse: "Browse and play music",
    cap_media_group: "Group speakers",
    cap_allow_local_player: "Radio on the guest's phone (stations read-only)",
    cap_spotify_control: "Control Spotify (through Home Assistant, no account access)",
    cap_spotify_search: "Search Spotify and play what was found",
    cap_library_browse: "Video library: browse and search films and series",
    cap_library_request: "Video library: request a film or series (you approve)",
    cap_library_allow_tv: "Video library: series too",
    cap_library_activity: "Video library: see what is downloading",
    cap_library_pick_release: "Video library: the guest picks the release",
    warn_library_pick_release: "The guest can choose what gets downloaded. Not recommended.",
    library_per_day: "Requests per day",
    maxVolume: "Maximum volume",
    mediaCapsHint: "Browsing shows the guest the library of the players in their profile and plays only what they found there. Stream and file links are never played.",
    capsHint: "Applies to every light in the profile, and only where the light supports it. Limit brightness per light.",
    confirmDeleteProfile: "Delete this profile?",
    noProfiles: "No profiles yet.",
    name: "Name",
    search: "Search…",
    allAreas: "All areas",
    noArea: "No area",
    readOnly: "view only",
    limits: "Range",
    limitDefault: (a, b) => `default ${a}–${b}`,
    reason_domain_denied: "not allowed for guests (locks, alarms, cameras, scripts…)",
    reason_domain_unsupported: "this device type is not supported yet",
    reason_device_class_denied: "garage doors, gates and doors are not allowed",
    reason_bad_request: "invalid entity",
    skipped: (n) => `${n} devices in this area cannot be given to guests.`,
    audit: "Log",
    allEvents: "All events",
    noAudit: "No entries.",
    ev_pair_code_created: "New code",
    ev_pair_ok: "Paired",
    ev_pair_failed: "Invalid code",
    ev_pass_created: "Pass created",
    ev_pass_revoked: "Pass ended",
    ev_pass_extended: "Pass extended",
    ev_pass_deleted: "Pass deleted",
    ev_pass_expired: "Pass expired",
    ev_auth_failed: "Invalid sign-in",
    ev_call_denied: "Action refused",
    ev_profile_saved: "Profile saved",
    ev_profile_deleted: "Profile deleted",
    printTitle: "Room controls",
    printSteps:
      "1. Naskenujte QR kód telefonem.\n2. Na iPhonu: Sdílet → Přidat na plochu, pak aplikaci otevřete z plochy a zadejte kód níže.\n3. Kód platí 15 minut a jen jednou. Pokud vypršel, požádejte o nový.",
    printStepsEn:
      "Scan the QR code with your phone. On iPhone: Share → Add to Home Screen, open the app and enter the code below. The code works once, for 15 minutes; ask for a new one if it expired.",
    printWifi: "Wi-Fi",
    printPassword: "Password",
    printUntil: (d) => `Valid until ${d}.`,
  },
};

const CSS = `
  .g-section { margin: 4px 0 26px; }
  .g-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .g-head h3 { margin: 0; }
  .g-head .g-tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .g-head select { width: auto; min-width: 180px; }
  .g-form { padding: 6px 0 14px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
  .g-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  .g-table th { text-align: left; font-weight: 500; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .g-table td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .g-table td.g-acts { white-space: nowrap; text-align: right; }
  .g-table td.g-acts button { padding: 5px 10px; font-size: 0.82rem; }
  .g-sub { display: block; color: var(--muted); font-size: 0.78rem; }
  .g-chip { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 0.78rem; background: var(--btn); }
  .g-chip.active { background: var(--ok-bg); color: var(--ok-text); }
  .g-chip.revoked, .g-chip.expired { background: var(--danger-bg); color: var(--danger-text); }
  .g-pair { display: grid; grid-template-columns: 200px 1fr; gap: 18px; align-items: start; padding: 8px 0 16px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
  @media (max-width: 640px) { .g-pair { grid-template-columns: 1fr; } }
  .g-qr { background: #fff; border-radius: 12px; padding: 8px; width: 200px; }
  .g-qr svg { display: block; width: 100%; height: auto; }
  .g-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.7rem; letter-spacing: 0.08em; margin: 2px 0 6px; user-select: all; }
  .g-label { margin: 0; font-weight: 600; }
  .g-url { display: block; font-size: 0.78rem; color: var(--muted); word-break: break-all; margin: 6px 0; }
  .g-prof { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
  @media (max-width: 720px) { .g-prof { grid-template-columns: 1fr; } }
  .g-caps { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 2px 18px; align-items: center; }
  .g-warn { grid-column: 1 / -1; margin: -4px 0 4px; font-size: 0.8rem; font-weight: 600; color: var(--danger-text, #b42318); }
  .g-caps-title { grid-column: 1 / -1; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .g-caps .hint { grid-column: 1 / -1; margin: 2px 0 0; }
  .g-prof input.g-name { border-color: transparent; background: transparent !important; padding-left: 0; font-weight: 600; }
  .g-prof input.g-name:focus { border-color: var(--border); padding-left: 12px; }
  .g-editor { padding: 10px 0 16px; border-bottom: 1px solid var(--border); }
  .g-filter { display: grid; grid-template-columns: 1fr 220px; gap: 8px; margin-bottom: 10px; }
  @media (max-width: 640px) { .g-filter { grid-template-columns: 1fr; } }
  .g-area { margin: 14px 0 4px; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .g-ent { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 4px 8px; padding: 6px 0; }
  .g-ent.off { opacity: 0.5; }
  .g-ent input[type="checkbox"] { margin-top: 3px; accent-color: var(--accent); }
  .g-ent .g-why { grid-column: 2; color: var(--muted); font-size: 0.78rem; }
  .g-svcs { grid-column: 2; display: flex; flex-wrap: wrap; gap: 4px; }
  .g-svcs button { padding: 3px 9px; font-size: 0.76rem; background: transparent; border: 1px solid var(--border); color: var(--muted); }
  .g-svcs button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .g-lim { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--muted); }
  .g-lim input { width: 84px !important; padding: 5px 8px !important; }
  .g-lim input::placeholder, .g-filter input::placeholder {
    color: var(--muted) !important; -webkit-text-fill-color: var(--muted) !important; opacity: 1;
  }
  .g-audit { list-style: none; margin: 0; padding: 0; font-size: 0.85rem; }
  .g-audit li { display: grid; grid-template-columns: 140px 1fr; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  .g-audit time { color: var(--muted); font-variant-numeric: tabular-nums; }
`;

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Date → value for <input type="datetime-local"> (browser local time). */
function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function atTime(date, hhmm) {
  const [h, m] = String(hhmm || "12:00").split(":").map(Number);
  const d = new Date(date);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** Same payload as the guest app's Wi-Fi card (src/components/WifiModal.vue). */
function wifiPayload({ wifiSsid, wifiPassword, wifiSecurity }) {
  const esc = (s) => String(s).replace(/([\\;,:"])/g, "\\$1");
  return `WIFI:T:${wifiSecurity || "WPA"};S:${esc(wifiSsid || "")};P:${esc(wifiPassword || "")};;`;
}

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export class GuestsTab {
  constructor(panel) {
    this.panel = panel;
    this.loaded = false;
    this.loading = false;
    this.error = null;
    this.info = null;
    this.entities = [];
    this.profiles = [];
    this.passes = [];
    this.audit = [];
    this.ui = {
      creating: false,
      form: null,
      pairing: null, // { pass, code, expiresAt }
      extendId: null,
      extendValue: "",
      editing: null, // profile draft
      skipped: 0,
      search: "",
      areaFilter: "",
      auditFilter: "",
      areaPick: "",
    };
    this._timer = null;
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  get hass() {
    return this.panel._hass;
  }

  t(key, ...args) {
    const pack = I18N[this.panel._uiLang()] || I18N.cs;
    const val = pack[key] ?? I18N.cs[key] ?? key;
    return typeof val === "function" ? val(...args) : val;
  }

  esc(s) {
    return this.panel._escape(s);
  }

  locale() {
    return this.panel._uiLang() === "en" ? "en-GB" : "cs-CZ";
  }

  fmt(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(this.locale(), { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  }

  ws(type, payload = {}) {
    return this.hass.connection.sendMessagePromise({ type: `${WS}/${type}`, ...payload });
  }

  rerender() {
    this.panel._render();
  }

  fail(err) {
    this.error = err?.message || err?.code || String(err);
    this.rerender();
  }

  /** Dashboard URL + HA host, as the guest app expects it: /<ha-host>#pair=CODE */
  pairUrl(code) {
    const cfg = this.panel._config || {};
    let host = "";
    try {
      host = new URL(this.panel._haUrl()).host;
    } catch {
      /* no HA url */
    }
    const base = cfg.hosting === "self"
      ? String(cfg.dashboardUrl || "").trim().replace(/\/$/, "")
      : this.panel._hostedUrl().replace(/\/[^/]*$/, "");
    return `${base}/${host}#pair=${code.replace(/-/g, "")}`;
  }

  // ─── data ─────────────────────────────────────────────────────────────────

  async load() {
    this.loading = true;
    try {
      const [info, ents, profiles, passes, audit] = await Promise.all([
        this.ws("guests/info"),
        this.ws("guests/entities"),
        this.ws("profile/list"),
        this.ws("pass/list"),
        this.ws("audit/list"),
      ]);
      this.info = info;
      this.entities = ents.entities || [];
      this.profiles = profiles.profiles || [];
      this.passes = passes.passes || [];
      this.audit = audit.entries || [];
      this.loaded = true;
      this.error = null;
    } catch (err) {
      this.error = err?.message || String(err);
    }
    this.loading = false;
    this.rerender();
  }

  async refresh(parts = ["passes", "audit"]) {
    try {
      if (parts.includes("passes")) this.passes = (await this.ws("pass/list")).passes || [];
      if (parts.includes("profiles")) this.profiles = (await this.ws("profile/list")).profiles || [];
      if (parts.includes("audit")) this.audit = (await this.ws("audit/list")).entries || [];
    } catch (err) {
      this.error = err?.message || String(err);
    }
    this.rerender();
  }

  // ─── render ───────────────────────────────────────────────────────────────

  render() {
    if (!this.loaded) {
      if (!this.loading) this.load();
      return `<style>${CSS}</style>${this.error ? `<p class="msg err">${this.esc(this.error)}</p>` : `<p class="hint">${this.t("loading")}</p>`}`;
    }
    return `
      <style>${CSS}</style>
      <p class="msg warn">${this.esc(this.t("ownerWarn"))}</p>
      ${this.error ? `<p class="msg err">${this.esc(this.error)}</p>` : ""}
      ${this.renderPassSection()}
      ${this.renderProfileSection()}
      ${this.renderAuditSection()}
    `;
  }

  renderPassSection() {
    const none = !this.profiles.length;
    return `
      <section class="g-section">
        <div class="g-head">
          <h3>${this.t("passes")}</h3>
          <button type="button" class="btn primary" id="gNewPass" ${none ? "disabled" : ""}>${this.t("createPass")}</button>
        </div>
        ${none ? `<p class="hint">${this.t("needProfile")}</p>` : ""}
        ${this.ui.creating ? this.renderCreate() : ""}
        ${this.ui.pairing ? this.renderPairing() : ""}
        ${this.renderPassTable()}
      </section>`;
  }

  defaultForm() {
    const d = this.info?.defaults || {};
    const now = new Date();
    let from = atTime(now, d.checkin);
    if (from < now) from = now;
    const until = atTime(new Date(from.getTime() + (d.nights || 1) * 86400000), d.checkout);
    return {
      profile_id: this.profiles[0]?.id || "",
      label: "",
      kind: "phone",
      from: toLocalInput(from),
      until: toLocalInput(until),
      noEnd: false,
    };
  }

  renderCreate() {
    const f = this.ui.form;
    const tablet = f.kind === "tablet";
    return `
      <div class="g-form">
        <div class="row"><label for="gpProfile">${this.t("profile")}</label>
          <select id="gpProfile">${this.profiles.map((p) => `<option value="${p.id}" ${p.id === f.profile_id ? "selected" : ""}>${this.esc(p.name)}</option>`).join("")}</select></div>
        <div class="row"><label for="gpLabel">${this.t("label")}</label>
          <input id="gpLabel" value="${this.esc(f.label)}" placeholder="${this.esc(this.t("labelPh"))}" maxlength="80" /></div>
        <div class="row"><label>${this.t("kind")}</label>
          <div class="seg">
            <button type="button" data-gp-kind="phone" class="${tablet ? "" : "active"}">${this.t("kindPhone")}</button>
            <button type="button" data-gp-kind="tablet" class="${tablet ? "active" : ""}">${this.t("kindTablet")}</button>
          </div></div>
        <div class="row"><label for="gpFrom">${this.t("validFrom")}</label>
          <input id="gpFrom" type="datetime-local" value="${f.from}" /></div>
        <div class="row"><label for="gpUntil">${this.t("validUntil")}</label>
          <div>
            <input id="gpUntil" type="datetime-local" value="${f.until}" ${tablet && f.noEnd ? "disabled" : ""} />
            ${tablet ? this.panel._toggle('id="gpNoEnd"', f.noEnd, this.t("noEnd")) : ""}
          </div></div>
        <div class="actions">
          <button type="button" class="btn primary" id="gpCreate" ${f.label.trim() && f.profile_id ? "" : "disabled"}>${this.t("create")}</button>
          <button type="button" class="btn ghost" id="gpCancel">${this.t("cancel")}</button>
        </div>
      </div>`;
  }

  renderPairing() {
    const { pass, code } = this.ui.pairing;
    const url = this.pairUrl(code);
    return `
      <div class="g-pair">
        <div class="g-qr" aria-label="QR">${qrSvg(url)}</div>
        <div>
          <p class="g-label">${this.esc(pass.label)}</p>
          <p class="g-code">${this.esc(code)}</p>
          <p class="hint" id="gCountdown">${this.countdownText()}</p>
          <code class="g-url">${this.esc(url.replace(/#pair=.*/, "#pair=…"))}</code>
          <p class="hint">${this.esc(this.t("haUrlHint", this.panel._haUrl()))}</p>
          <div class="actions">
            <button type="button" class="btn" id="gPrint">${this.t("print")}</button>
            <button type="button" class="btn ghost" id="gPrintA4">${this.t("printA4")}</button>
            <button type="button" class="btn ghost" id="gCopy">${this.t("copyLink")}</button>
            <button type="button" class="btn ghost" id="gPairClose">${this.t("done")}</button>
          </div>
        </div>
      </div>`;
  }

  countdownText() {
    const left = Math.max(0, new Date(this.ui.pairing?.expiresAt || 0) - Date.now());
    if (!left) return this.t("codeExpired");
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return this.t("codeValid", `${m}:${pad(s)}`);
  }

  renderPassTable() {
    if (!this.passes.length) return `<p class="hint">${this.t("noPasses")}</p>`;
    const rows = this.passes.map((p) => {
      const ended = p.status === "revoked" || p.status === "expired";
      const extending = this.ui.extendId === p.id;
      const until = p.valid_until ? this.fmt(p.valid_until) : this.t("noEndShort");
      return `
        <tr>
          <td>${this.esc(p.label)}<span class="g-sub">${p.paired ? this.esc(p.device_name || "") : this.t("notPaired")}</span></td>
          <td>${this.esc(p.profile_name)}</td>
          <td>${this.t(p.kind === "tablet" ? "kindTablet" : "kindPhone")}</td>
          <td><span class="g-chip ${p.status}">${this.t(`st_${p.status}`)}</span></td>
          <td>${extending
            ? `<input type="datetime-local" id="gExtendValue" value="${this.ui.extendValue}" />`
            : until}</td>
          <td>${p.last_seen ? this.fmt(p.last_seen) : this.t("never")}</td>
          <td class="g-acts">${extending
            ? `<button type="button" class="btn primary" data-gp-extend-ok="${p.id}">${this.t("save")}</button>
               <button type="button" class="btn ghost" data-gp-extend-cancel>${this.t("cancel")}</button>`
            : `${ended ? "" : `<button type="button" class="btn ghost" data-gp-code="${p.id}">${this.t("newCode")}</button>
               <button type="button" class="btn ghost" data-gp-extend="${p.id}">${this.t("extend")}</button>
               <button type="button" class="btn danger" data-gp-revoke="${p.id}">${this.t("revoke")}</button>`}
               ${ended ? `<button type="button" class="btn ghost" data-gp-delete="${p.id}">${this.t("del")}</button>` : ""}`}
          </td>
        </tr>`;
    });
    return `
      <table class="g-table">
        <thead><tr>
          <th>${this.t("colLabel")}</th><th>${this.t("colProfile")}</th><th>${this.t("colKind")}</th>
          <th>${this.t("colStatus")}</th><th>${this.t("colUntil")}</th><th>${this.t("colSeen")}</th><th></th>
        </tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>`;
  }

  areaName(areaId) {
    if (!areaId) return this.t("noArea");
    return this.hass?.areas?.[areaId]?.name || areaId;
  }

  renderProfileSection() {
    const areas = Object.values(this.hass?.areas || {}).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const editingNew = this.ui.editing && !this.ui.editing.id;
    return `
      <section class="g-section">
        <div class="g-head">
          <h3>${this.t("profiles")}</h3>
          <div class="g-tools">
            <select id="gAreaPick">
              <option value="">${this.t("pickArea")}</option>
              ${areas.map((a) => `<option value="${this.esc(a.area_id)}" ${a.area_id === this.ui.areaPick ? "selected" : ""}>${this.esc(a.name)}</option>`).join("")}
            </select>
            <button type="button" class="btn" id="gFromArea" ${this.ui.areaPick ? "" : "disabled"}>${this.t("fromArea")}</button>
            <button type="button" class="btn ghost" id="gEmptyProfile">${this.t("emptyProfile")}</button>
          </div>
        </div>
        ${editingNew ? this.renderEditor() : ""}
        ${this.profiles.length ? "" : editingNew ? "" : `<p class="hint">${this.t("noProfiles")}</p>`}
        ${this.profiles.map((p) => `
          <div class="g-prof">
            <input class="g-name" data-gprof-name="${p.id}" value="${this.esc(p.name)}" aria-label="${this.t("name")}" maxlength="80" />
            <span class="count">${this.t("devices", Object.keys(p.entities || {}).length)}</span>
            ${this.panel._toggle(`data-gprof-wifi="${p.id}"`, p.show_wifi !== false, this.t("wifi"))}
            ${this.renderCaps(p)}
            <div class="g-acts">
              <button type="button" class="btn ghost" data-gprof-edit="${p.id}">${this.t("editDevices")}</button>
              <button type="button" class="btn ghost" data-gprof-delete="${p.id}">${this.t("del")}</button>
            </div>
          </div>
          ${this.ui.editing?.id === p.id ? this.renderEditor() : ""}`).join("")}
      </section>`;
  }

  /**
   * Profile-wide capability switches (guest_policy.GUEST_CAPABILITY_DEFAULTS).
   * Missing in an older profile = the defaults: colour and effects off.
   */
  renderCaps(p) {
    const caps = { ...CAPABILITY_DEFAULTS, ...(p.capabilities || {}) };
    return `
      <div class="g-caps" role="group" aria-label="${this.esc(this.t("capsTitle"))}">
        <span class="g-caps-title">${this.t("capsTitle")}</span>
        ${CAPABILITY_TOGGLES.map((key) => `${this.panel._toggle(`data-gprof-cap="${p.id}" data-cap="${key}"`, caps[key] === true, this.t(`cap_${key}`))}${
          CAPABILITY_WARN[key] && caps[key] === true ? `<p class="g-warn" role="note" data-cap-warn="${key}">${this.t(CAPABILITY_WARN[key])}</p>` : ""}`).join("")}
        <label class="g-cap-vol">${this.t("library_per_day")}
          <select data-gprof-libday="${p.id}">${LIBRARY_DAY_STEPS.map((v) => `<option value="${v}" ${(caps.library_max_per_day ?? 3) === v ? "selected" : ""}>${v}</option>`).join("")}</select>
        </label>
        <label class="g-cap-vol">${this.t("maxVolume")}
          <select data-gprof-vol="${p.id}">${MAX_VOLUME_STEPS.map((v) => `<option value="${v}" ${Math.abs((caps.max_volume ?? 0.7) - v) < 0.001 ? "selected" : ""}>${Math.round(v * 100)} %</option>`).join("")}</select>
        </label>
        <p class="hint">${this.t("capsHint")} ${this.t("mediaCapsHint")}</p>
      </div>`;
  }

  renderEditor() {
    const draft = this.ui.editing;
    const q = this.ui.search.trim().toLowerCase();
    const areaFilter = this.ui.areaFilter;
    const visible = this.entities.filter((e) => {
      if (draft.entities[e.entity_id]) return true;
      if (areaFilter && areaFilter !== "*" && e.area_id !== areaFilter) return false;
      if (!areaFilter && draft.area_ids?.length && !draft.area_ids.includes(e.area_id)) return false;
      if (q && !`${e.name} ${e.entity_id}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const groups = new Map();
    for (const e of visible) {
      const key = e.area_id || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const areaOptions = [...new Set(this.entities.map((e) => e.area_id).filter(Boolean))];
    return `
      <div class="g-editor">
        ${draft.id ? "" : `<div class="row"><label for="gDraftName">${this.t("name")}</label>
          <input id="gDraftName" value="${this.esc(draft.name)}" maxlength="80" /></div>`}
        ${this.ui.skipped ? `<p class="hint">${this.t("skipped", this.ui.skipped)}</p>` : ""}
        <div class="g-filter">
          <input id="gSearch" value="${this.esc(this.ui.search)}" placeholder="${this.esc(this.t("search"))}" />
          <select id="gAreaFilter">
            <option value="" ${areaFilter === "" ? "selected" : ""}>${draft.area_ids?.length ? this.esc(draft.area_ids.map((a) => this.areaName(a)).join(", ")) : this.t("allAreas")}</option>
            <option value="*" ${areaFilter === "*" ? "selected" : ""}>${this.t("allAreas")}</option>
            ${areaOptions.map((a) => `<option value="${this.esc(a)}" ${areaFilter === a ? "selected" : ""}>${this.esc(this.areaName(a))}</option>`).join("")}
          </select>
        </div>
        ${[...groups.entries()].map(([area, list]) => `
          <p class="g-area">${this.esc(this.areaName(area))}</p>
          ${list.map((e) => this.renderEntity(e, draft)).join("")}`).join("")}
        <div class="actions">
          <button type="button" class="btn primary" id="gDraftSave" ${draft.name?.trim() ? "" : "disabled"}>${this.t("save")}</button>
          <button type="button" class="btn ghost" id="gDraftCancel">${this.t("cancel")}</button>
        </div>
      </div>`;
  }

  renderEntity(e, draft) {
    const sel = draft.entities[e.entity_id];
    const id = this.esc(e.entity_id);
    if (!e.selectable) {
      return `
        <div class="g-ent off">
          <input type="checkbox" disabled aria-label="${id}" />
          <span>${this.esc(e.name)} <span class="g-sub">${id}</span></span>
          <span class="g-why">${this.esc(this.t(`reason_${e.reason}`))}</span>
        </div>`;
    }
    const svcs = sel && !e.read_only
      ? `<div class="g-svcs">${e.services.map((s) => `<button type="button" data-gent-svc="${id}" data-svc="${s}" class="${sel.services.includes(s) ? "on" : ""}">${this.esc(s.split(".")[1])}</button>`).join("")}</div>`
      : "";
    const limits = sel && !e.read_only ? this.renderLimits(e, sel) : "";
    return `
      <div class="g-ent">
        <input type="checkbox" data-gent="${id}" ${sel ? "checked" : ""} aria-label="${id}" />
        <span>${this.esc(e.name)} <span class="g-sub">${id}${e.read_only ? ` · ${this.t("readOnly")}` : ""}</span></span>
        ${svcs}${limits}
      </div>`;
  }

  renderLimits(e, sel) {
    const required = this.info?.required_limits || {};
    const parts = [];
    for (const call of sel.services) {
      const fields = e.fields?.[call] || {};
      for (const [field, spec] of Object.entries(fields)) {
        if (!["int", "number"].includes(spec.type)) continue;
        const cur = sel.limits?.[call]?.[field] || {};
        const def = required[call]?.[field];
        const ph = def || spec;
        parts.push(`
          <span>${this.esc(field)}</span>
          <input type="number" step="any" data-glim="${this.esc(e.entity_id)}" data-call="${call}" data-field="${field}" data-bound="min"
            value="${cur.min ?? ""}" placeholder="${ph.min ?? ""}" aria-label="${field} min" />
          <span>–</span>
          <input type="number" step="any" data-glim="${this.esc(e.entity_id)}" data-call="${call}" data-field="${field}" data-bound="max"
            value="${cur.max ?? ""}" placeholder="${ph.max ?? ""}" aria-label="${field} max" />
          ${def ? `<span>${this.t("limitDefault", def.min, def.max)}</span>` : ""}`);
      }
    }
    return parts.length ? `<div class="g-lim">${this.t("limits")}: ${parts.join("")}</div>` : "";
  }

  renderAuditSection() {
    const passLabel = (id) => this.passes.find((p) => p.id === id)?.label || "";
    const events = [...new Set(this.audit.map((e) => e.event))];
    const list = this.audit.filter((e) => !this.ui.auditFilter || e.event === this.ui.auditFilter);
    return `
      <section class="g-section">
        <div class="g-head">
          <h3>${this.t("audit")}</h3>
          <div class="g-tools">
            <select id="gAuditFilter">
              <option value="">${this.t("allEvents")}</option>
              ${events.map((ev) => `<option value="${ev}" ${ev === this.ui.auditFilter ? "selected" : ""}>${this.esc(this.t(`ev_${ev}`))}</option>`).join("")}
            </select>
          </div>
        </div>
        ${list.length ? `<ul class="g-audit">${list.map((e) => `
          <li>
            <time datetime="${this.esc(e.ts)}">${this.fmt(e.ts)}</time>
            <span>${this.esc(this.t(`ev_${e.event}`))}${e.pass_id ? ` · ${this.esc(passLabel(e.pass_id))}` : ""}
              ${e.entity_id || e.service || e.reason || e.ip
                ? `<span class="g-sub">${this.esc([e.entity_id, e.service, e.reason, e.ip].filter(Boolean).join(" · "))}</span>`
                : ""}</span>
          </li>`).join("")}</ul>` : `<p class="hint">${this.t("noAudit")}</p>`}
      </section>`;
  }

  // ─── events ───────────────────────────────────────────────────────────────

  bind(root) {
    const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
    const byId = (id) => root.getElementById(id);

    this.startCountdown(root);

    byId("gNewPass")?.addEventListener("click", () => {
      this.ui.creating = true;
      this.ui.pairing = null;
      this.ui.form = this.defaultForm();
      this.rerender();
    });
    const f = this.ui.form;
    byId("gpProfile")?.addEventListener("change", (e) => { f.profile_id = e.target.value; });
    byId("gpLabel")?.addEventListener("input", (e) => {
      f.label = e.target.value;
      byId("gpCreate").disabled = !f.label.trim() || !f.profile_id;
    });
    byId("gpFrom")?.addEventListener("change", (e) => { f.from = e.target.value; });
    byId("gpUntil")?.addEventListener("change", (e) => { f.until = e.target.value; });
    byId("gpNoEnd")?.addEventListener("change", (e) => { f.noEnd = e.target.checked; this.rerender(); });
    on("[data-gp-kind]", "click", (e) => {
      f.kind = e.currentTarget.dataset.gpKind;
      if (f.kind === "phone") f.noEnd = false;
      this.rerender();
    });
    byId("gpCancel")?.addEventListener("click", () => { this.ui.creating = false; this.rerender(); });
    byId("gpCreate")?.addEventListener("click", () => this.createPass());

    byId("gPairClose")?.addEventListener("click", () => { this.ui.pairing = null; this.rerender(); });
    byId("gPrint")?.addEventListener("click", () => this.print("A6"));
    byId("gPrintA4")?.addEventListener("click", () => this.print("A4"));
    byId("gCopy")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(this.pairUrl(this.ui.pairing.code));
        btn.textContent = this.t("copied");
      } catch { /* clipboard blocked */ }
    });

    on("[data-gp-code]", "click", (e) => this.newCode(e.currentTarget.dataset.gpCode));
    on("[data-gp-revoke]", "click", (e) => this.passAction("revoke", e.currentTarget.dataset.gpRevoke, "confirmRevoke"));
    on("[data-gp-delete]", "click", (e) => this.passAction("delete", e.currentTarget.dataset.gpDelete, "confirmDelete"));
    on("[data-gp-extend]", "click", (e) => {
      const p = this.passes.find((x) => x.id === e.currentTarget.dataset.gpExtend);
      const base = p?.valid_until ? new Date(p.valid_until) : new Date();
      this.ui.extendId = p.id;
      this.ui.extendValue = toLocalInput(new Date(base.getTime() + 86400000));
      this.rerender();
    });
    byId("gExtendValue")?.addEventListener("change", (e) => { this.ui.extendValue = e.target.value; });
    on("[data-gp-extend-cancel]", "click", () => { this.ui.extendId = null; this.rerender(); });
    on("[data-gp-extend-ok]", "click", (e) => this.extend(e.currentTarget.dataset.gpExtendOk));

    // profiles
    byId("gAreaPick")?.addEventListener("change", (e) => { this.ui.areaPick = e.target.value; this.rerender(); });
    byId("gFromArea")?.addEventListener("click", () => this.profileFromArea());
    byId("gEmptyProfile")?.addEventListener("click", () => {
      this.ui.editing = { name: "", area_ids: [], entities: {}, show_wifi: true };
      this.ui.skipped = 0;
      this.ui.areaFilter = "*";
      this.rerender();
    });
    on("[data-gprof-name]", "change", (e) => this.saveProfile(e.currentTarget.dataset.gprofName, { name: e.currentTarget.value }));
    on("[data-gprof-wifi]", "change", (e) => this.saveProfile(e.currentTarget.dataset.gprofWifi, { show_wifi: e.currentTarget.checked }));
    on("[data-gprof-cap]", "change", (e) => {
      const id = e.currentTarget.dataset.gprofCap;
      const p = this.profiles.find((x) => x.id === id);
      const caps = { ...CAPABILITY_DEFAULTS, ...(p?.capabilities || {}), [e.currentTarget.dataset.cap]: e.currentTarget.checked };
      this.saveProfile(id, { capabilities: caps });
    });
    on("[data-gprof-libday]", "change", (e) => {
      const id = e.currentTarget.dataset.gprofLibday;
      const p = this.profiles.find((x) => x.id === id);
      this.saveProfile(id, { capabilities: { ...CAPABILITY_DEFAULTS, ...(p?.capabilities || {}), library_max_per_day: Number(e.currentTarget.value) } });
    });
    on("[data-gprof-vol]", "change", (e) => {
      const id = e.currentTarget.dataset.gprofVol;
      const p = this.profiles.find((x) => x.id === id);
      this.saveProfile(id, { capabilities: { ...CAPABILITY_DEFAULTS, ...(p?.capabilities || {}), max_volume: Number(e.currentTarget.value) } });
    });
    on("[data-gprof-edit]", "click", (e) => {
      const p = this.profiles.find((x) => x.id === e.currentTarget.dataset.gprofEdit);
      this.ui.editing = this.ui.editing?.id === p.id ? null : JSON.parse(JSON.stringify(p));
      this.ui.skipped = 0;
      this.ui.areaFilter = "";
      this.rerender();
    });
    on("[data-gprof-delete]", "click", (e) => this.deleteProfile(e.currentTarget.dataset.gprofDelete));

    // editor
    const draft = this.ui.editing;
    byId("gDraftName")?.addEventListener("input", (e) => {
      draft.name = e.target.value;
      byId("gDraftSave").disabled = !draft.name.trim();
    });
    byId("gSearch")?.addEventListener("input", (e) => {
      this.ui.search = e.target.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.rerender(), 250);
    });
    byId("gAreaFilter")?.addEventListener("change", (e) => { this.ui.areaFilter = e.target.value; this.rerender(); });
    on("[data-gent]", "change", (e) => {
      const id = e.currentTarget.dataset.gent;
      const ent = this.entities.find((x) => x.entity_id === id);
      if (e.currentTarget.checked) draft.entities[id] = { services: [...(ent?.services || [])], limits: {}, read_only: Boolean(ent?.read_only) };
      else delete draft.entities[id];
      this.rerender();
    });
    on("[data-gent-svc]", "click", (e) => {
      const sel = draft.entities[e.currentTarget.dataset.gentSvc];
      const svc = e.currentTarget.dataset.svc;
      sel.services = sel.services.includes(svc) ? sel.services.filter((s) => s !== svc) : [...sel.services, svc];
      this.rerender();
    });
    on("[data-glim]", "change", (e) => {
      const { glim, call, field, bound } = e.currentTarget.dataset;
      const sel = draft.entities[glim];
      const value = e.currentTarget.value === "" ? null : Number(e.currentTarget.value);
      sel.limits ||= {};
      sel.limits[call] ||= {};
      sel.limits[call][field] ||= {};
      if (value == null || Number.isNaN(value)) delete sel.limits[call][field][bound];
      else sel.limits[call][field][bound] = value;
    });
    byId("gDraftCancel")?.addEventListener("click", () => { this.ui.editing = null; this.rerender(); });
    byId("gDraftSave")?.addEventListener("click", () => this.saveDraft());

    byId("gAuditFilter")?.addEventListener("change", (e) => { this.ui.auditFilter = e.target.value; this.rerender(); });
  }

  startCountdown(root) {
    clearInterval(this._timer);
    if (!this.ui.pairing) return;
    this._timer = setInterval(() => {
      const el = root.getElementById("gCountdown");
      if (!el) {
        clearInterval(this._timer);
        return;
      }
      el.textContent = this.countdownText();
    }, 1000);
  }

  // ─── actions ──────────────────────────────────────────────────────────────

  async createPass() {
    const f = this.ui.form;
    const payload = {
      profile_id: f.profile_id,
      label: f.label.trim(),
      kind: f.kind,
      valid_from: f.from ? new Date(f.from).toISOString() : null,
      valid_until: f.kind === "tablet" && f.noEnd ? null : f.until ? new Date(f.until).toISOString() : null,
    };
    try {
      const res = await this.ws("pass/create", payload);
      this.ui.creating = false;
      this.ui.pairing = { pass: res.pass, code: res.pairing.code, expiresAt: res.pairing.expires_at };
      this.error = null;
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  async newCode(passId) {
    try {
      const res = await this.ws("pass/new_code", { pass_id: passId });
      const pass = this.passes.find((p) => p.id === passId);
      this.ui.pairing = { pass, code: res.pairing.code, expiresAt: res.pairing.expires_at };
      this.ui.creating = false;
      this.error = null;
      await this.refresh(["audit"]);
    } catch (err) {
      this.fail(err);
    }
  }

  async passAction(action, passId, confirmKey) {
    if (!window.confirm(this.t(confirmKey))) return;
    try {
      await this.ws(`pass/${action}`, { pass_id: passId });
      if (this.ui.pairing?.pass?.id === passId) this.ui.pairing = null;
      this.error = null;
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  async extend(passId) {
    try {
      await this.ws("pass/extend", { pass_id: passId, valid_until: new Date(this.ui.extendValue).toISOString() });
      this.ui.extendId = null;
      this.error = null;
      await this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  async profileFromArea() {
    try {
      const res = await this.ws("profile/from_area", { area_id: this.ui.areaPick });
      this.ui.editing = res.profile;
      this.ui.skipped = (res.skipped || []).length;
      this.ui.areaFilter = "";
      this.error = null;
      this.rerender();
    } catch (err) {
      this.fail(err);
    }
  }

  async saveProfile(id, patch) {
    const p = this.profiles.find((x) => x.id === id);
    if (!p) return;
    try {
      await this.ws("profile/save", { profile: { ...p, ...patch } });
      this.error = null;
      await this.refresh(["profiles", "passes", "audit"]);
    } catch (err) {
      this.fail(err);
    }
  }

  async saveDraft() {
    const draft = this.ui.editing;
    try {
      await this.ws("profile/save", { profile: draft });
      this.ui.editing = null;
      this.error = null;
      await this.refresh(["profiles", "passes", "audit"]);
    } catch (err) {
      this.fail(err);
    }
  }

  async deleteProfile(id) {
    if (!window.confirm(this.t("confirmDeleteProfile"))) return;
    try {
      await this.ws("profile/delete", { profile_id: id });
      if (this.ui.editing?.id === id) this.ui.editing = null;
      this.error = null;
      await this.refresh(["profiles", "audit"]);
    } catch (err) {
      this.fail(err);
    }
  }

  // ─── print card ───────────────────────────────────────────────────────────

  print(size) {
    const { pass, code } = this.ui.pairing;
    const profile = this.profiles.find((p) => p.id === pass.profile_id);
    const g = this.panel._config?.guestInfo || {};
    const wifi = profile?.show_wifi !== false && g.wifiSsid;
    const e = (s) => this.esc(s);
    const steps = this.t("printSteps").split("\n").map((s) => `<li>${e(s.replace(/^\d+\.\s*/, ""))}</li>`).join("");
    const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>dash – ${e(pass.label)}</title>
      <style>
        @page { size: ${size}; margin: ${size === "A6" ? "8mm" : "18mm"}; }
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; color: #111; margin: 0; }
        main { max-width: ${size === "A6" ? "90mm" : "130mm"}; margin: 0 auto; }
        h1 { font-size: ${size === "A6" ? "15pt" : "22pt"}; margin: 0 0 2mm; }
        .label { margin: 0 0 4mm; color: #555; }
        .qr svg { width: ${size === "A6" ? "42mm" : "60mm"}; height: auto; display: block; }
        .code { font-family: ui-monospace, Menlo, monospace; font-size: ${size === "A6" ? "15pt" : "20pt"}; letter-spacing: 0.08em; margin: 3mm 0; }
        ol { padding-left: 5mm; margin: 2mm 0; font-size: ${size === "A6" ? "8.5pt" : "11pt"}; line-height: 1.35; }
        .en { font-size: ${size === "A6" ? "7.5pt" : "10pt"}; color: #555; margin: 2mm 0 4mm; line-height: 1.35; }
        .until { font-size: ${size === "A6" ? "8.5pt" : "11pt"}; margin: 0 0 4mm; }
        .wifi { display: flex; gap: 4mm; align-items: center; border-top: 0.3mm solid #ccc; padding-top: 4mm; }
        .wifi svg { width: ${size === "A6" ? "26mm" : "40mm"}; height: auto; display: block; }
        .wifi p { margin: 0 0 1mm; font-size: ${size === "A6" ? "8.5pt" : "11pt"}; }
      </style></head><body><main>
        <h1>${e(this.t("printTitle"))}</h1>
        <p class="label">${e(pass.label)}</p>
        <div class="qr">${qrSvg(this.pairUrl(code))}</div>
        <p class="code">${e(code)}</p>
        <ol>${steps}</ol>
        <p class="en">${e(this.t("printStepsEn"))}</p>
        ${pass.valid_until ? `<p class="until">${e(this.t("printUntil", this.fmt(pass.valid_until)))}</p>` : ""}
        ${wifi ? `<div class="wifi">${qrSvg(wifiPayload(g))}<div>
          <p><strong>${e(this.t("printWifi"))}:</strong> ${e(g.wifiSsid)}</p>
          ${g.wifiPassword ? `<p><strong>${e(this.t("printPassword"))}:</strong> ${e(g.wifiPassword)}</p>` : ""}
        </div></div>` : ""}
      </main><script>window.onload = () => { window.print(); };<\/script></body></html>`;
    const w = window.open("", "_blank", "width=520,height=760");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}
