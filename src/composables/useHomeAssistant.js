import { reactive, computed } from 'vue'
import {
  createConnection,
  createLongLivedTokenAuth,
  getAuth,
  subscribeEntities,
  callService as haCallService,
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_AUTH,
} from 'home-assistant-js-websocket'
import { guestDashboard } from '@/config/guestDashboard'
import {
  applyGuestConfig,
  useFallbackGuestConfig,
  getGuestConfig,
} from './useGuestConfig'
import { playTick } from './useSound'
import { translate } from '@/i18n/messages'
import { detectUiLang } from './useI18n'
import {
  isEmbedded,
  hassUrlFromPath,
  pathForHassUrl,
  storageKey,
  requestParentAuth,
  createParentAuth,
} from '@/lib/hassTarget'
import {
  takePairCodeFromUrl,
  isStandalone,
  loadGuest,
  findAnyGuest,
  saveGuest,
  pairWithCode,
  normalizeCode,
  PairError,
} from '@/lib/guestPass'
import { GuestPassTransport, GuestError } from '@/lib/guestTransport'
import { MOCK_PHOTO_IDS, mockPhotoUrl, mockPhotosFlag } from '@/lib/mockPhotos'
import {
  MOCK_GUEST_PASS,
  MOCK_GUEST_PROFILE,
  filterConfigForProfile,
  mockDenyReason,
} from '@/lib/mockGuest'

function tt(key) {
  return translate(detectUiLang(), key)
}

/**
 * @typedef {'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'mock' | 'need_url' | 'login'
 *   | 'pairing' | 'guest_ended' | 'guest_pending'} HaStatus
 */

const LEGACY_TOKENS_KEY = 'guest_ha_tokens'
const TOKENS_KEY = 'dash_tokens'
const HASS_URL_KEY = 'guest_ha_url'
/** Set after the first successful sign-in; the hello.dash intro never shows again. */
const SETUP_DONE_KEY = 'dash_setup_done'

const pathHassUrl = hassUrlFromPath()

const state = reactive({
  /** @type {Record<string, object>} */
  entities: {},
  /** @type {HaStatus} */
  status: 'idle',
  isMock: false,
  lastError: null,
  /** Running inside the HA config panel's live preview */
  isPreview: isEmbedded,
  setupDone: localStorage.getItem(SETUP_DONE_KEY) === '1',
  hassUrl: pathHassUrl || localStorage.getItem(HASS_URL_KEY) || import.meta.env.VITE_HA_URL || '',
  /** True once we have successfully connected in this tab session */
  everConnected: false,
  /** Display name of the HA user signed in on this dashboard */
  userName: '',
  /** HA core config subset: home location for weather */
  haConfig: null,
  /** owner = HA login (unrestricted), guest = guest pass (restricted by the integration) */
  mode: 'owner',
  /** Guest pass shown to the guest: { id, label, kind, valid_from, valid_until } */
  guestPass: null,
  guestProfileName: '',
  /** Pairing screen: code from the QR fragment, last error, request running */
  pairCode: '',
  pairError: null,
  pairBusy: false,
  /** Why the guest pass stopped: expired | revoked | invalid_auth */
  endedReason: '',
  /** Short message after a refused guest action: { id, text } */
  toast: null,
})

let connection = null
let brightnessTimers = new Map()
let initialized = false
let configUnsub = null
let connectInFlight = null

function wantsMock() {
  const url = import.meta.env.VITE_HA_URL
  const mode = import.meta.env.VITE_MODE
  return mode === 'mock' || url === 'mock'
}

function cleanAuthParamsFromUrl() {
  try {
    const url = new URL(window.location.href)
    ;['auth_callback', 'code', 'state'].forEach((k) => url.searchParams.delete(k))
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, document.title, next)
  } catch {
    /* ignore */
  }
}

function hasOAuthCallback() {
  try {
    const q = new URLSearchParams(window.location.search)
    return q.get('auth_callback') === '1' || q.has('code')
  } catch {
    return false
  }
}

/** Tokens are kept per HA host so several homes can share one browser. */
function tokensKey() {
  return storageKey(TOKENS_KEY, state.hassUrl)
}

function saveTokens(tokens) {
  if (tokens) localStorage.setItem(tokensKey(), JSON.stringify(tokens))
  else localStorage.removeItem(tokensKey())
  localStorage.removeItem(LEGACY_TOKENS_KEY)
}

function loadTokens() {
  const parse = (raw) => {
    try {
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }
  const tokens = parse(localStorage.getItem(tokensKey()))
  if (tokens) return tokens
  const legacy = parse(localStorage.getItem(LEGACY_TOKENS_KEY))
  if (legacy && (!state.hassUrl || legacy.hassUrl?.replace(/\/$/, '') === state.hassUrl.replace(/\/$/, ''))) {
    return legacy
  }
  return null
}

function markSetupDone() {
  if (state.setupDone || state.isPreview) return
  state.setupDone = true
  localStorage.setItem(SETUP_DONE_KEY, '1')
}

/** Without a baked-in HA URL, keep the HA host in the path: /<ha-host>. */
function syncPathWithHassUrl(url) {
  if (import.meta.env.VITE_HA_URL || state.isPreview || !url) return
  const path = pathForHassUrl(url)
  if (window.location.pathname === path) return
  window.history.replaceState({}, document.title, `${path}${window.location.search}${window.location.hash}`)
}

/* ─── Mock entity factory ─────────────────────────────────── */

function buildMockEntities() {
  /** @type {Record<string, object>} */
  const entities = {}
  const now = new Date().toISOString()
  const cfg = getGuestConfig()

  const sensorDefaults = {
    'sensor.obyvak_teplota': { state: '22.4', unit: '°C' },
    'sensor.obyvak_vlhkost': { state: '48', unit: '%' },
    'sensor.loznice_teplota': { state: '20.8', unit: '°C' },
    'sensor.loznice_vlhkost': { state: '52', unit: '%' },
    'sensor.koupelna_teplota': { state: '23.1', unit: '°C' },
    'sensor.koupelna_vlhkost': { state: '61', unit: '%' },
    'sensor.chodba_teplota': { state: '21.0', unit: '°C' },
    'sensor.chodba_vlhkost': { state: '45', unit: '%' },
  }

  for (const [id, meta] of Object.entries(sensorDefaults)) {
    entities[id] = {
      entity_id: id,
      state: meta.state,
      attributes: { unit_of_measurement: meta.unit, friendly_name: id },
      last_changed: now,
      last_updated: now,
    }
  }

  for (const room of cfg.pages || cfg.rooms || []) {
    for (const device of room.devices || []) {
      if (device.type === 'light') {
        entities[device.id] = {
          entity_id: device.id,
          state: 'off',
          attributes: {
            friendly_name: device.label,
            brightness: 0,
            color_temp_kelvin: 3000,
            min_color_temp_kelvin: 2200,
            max_color_temp_kelvin: 6500,
            supported_color_modes: device.supportsBrightness
              ? ['brightness', 'color_temp']
              : ['onoff'],
          },
          last_changed: now,
          last_updated: now,
        }
      } else if (device.type === 'switch') {
        entities[device.id] = {
          entity_id: device.id,
          state: 'off',
          attributes: { friendly_name: device.label },
          last_changed: now,
          last_updated: now,
        }
      } else if (device.type === 'cover') {
        entities[device.id] = {
          entity_id: device.id,
          state: 'open',
          attributes: {
            friendly_name: device.label,
            current_position: 100,
          },
          last_changed: now,
          last_updated: now,
        }
      } else if (device.type === 'climate') {
        entities[device.id] = {
          entity_id: device.id,
          state: 'heat',
          attributes: {
            friendly_name: device.label,
            temperature: 21.5,
            current_temperature: 21.2,
            hvac_modes: ['off', 'heat', 'auto'],
            hvac_action: 'heating',
            min_temp: 10,
            max_temp: 30,
          },
          last_changed: now,
          last_updated: now,
        }
      } else if (device.type === 'media_player') {
        entities[device.id] = {
          entity_id: device.id,
          state: 'playing',
          attributes: {
            friendly_name: device.label,
            media_title: 'Midnight City',
            media_artist: 'M83',
            volume_level: 0.35,
          },
          last_changed: now,
          last_updated: now,
        }
      }
    }
  }

  entities['weather.forecast_home'] = {
    entity_id: 'weather.forecast_home',
    state: 'partlycloudy',
    attributes: { friendly_name: 'Forecast Home', temperature: 12.4, humidity: 71 },
    last_changed: now,
    last_updated: now,
  }

  setLightMock(entities, 'light.obyvak_strop', true, 70, 3000)
  setLightMock(entities, 'light.obyvak_lampa', true, 45, 2700)
  setLightMock(entities, 'light.chodba_vstup', true, 40, 3000)

  return entities
}

function setLightMock(entities, id, on, brightnessPct = 80, kelvin = 3000) {
  const e = entities[id]
  if (!e) return
  e.state = on ? 'on' : 'off'
  e.attributes = {
    ...e.attributes,
    brightness: on ? Math.round((brightnessPct / 100) * 255) : 0,
    color_temp_kelvin: kelvin,
  }
  e.last_updated = new Date().toISOString()
}

function applyMockScene(action) {
  const ents = state.entities
  const allLights = Object.keys(ents).filter((id) => id.startsWith('light.'))

  if (action === 'all_off') {
    allLights.forEach((id) => setLightMock(ents, id, false))
  } else if (action === 'evening') {
    allLights.forEach((id) => setLightMock(ents, id, false))
    setLightMock(ents, 'light.obyvak_lampa', true, 35, 2200)
    setLightMock(ents, 'light.obyvak_led_pas', true, 25, 2200)
    setLightMock(ents, 'light.loznice_nocni_leva', true, 20, 2200)
    setLightMock(ents, 'light.loznice_nocni_prava', true, 20, 2200)
  } else if (action === 'cinema') {
    allLights.forEach((id) => setLightMock(ents, id, false))
    setLightMock(ents, 'light.obyvak_led_pas', true, 15, 2200)
  } else if (action === 'morning') {
    allLights.forEach((id) => setLightMock(ents, id, true, 90, 4500))
  }
}

function startMockMode() {
  state.isMock = true
  state.status = 'mock'
  state.mode = 'owner'
  useFallbackGuestConfig('mock')
  const cfg = getGuestConfig()
  if (mockPhotosFlag()) {
    // demo/test only: photo mode with a short interval
    cfg.standby = { ...cfg.standby, mode: 'photos', photoSeconds: 3 }
  }
  // demo only: ?theme=dark|light wins over the bundled config (screenshots, previews)
  const urlTheme = new URLSearchParams(window.location.search).get('theme')
  if (urlTheme === 'dark' || urlTheme === 'light') cfg.appearance = { ...cfg.appearance, mode: urlTheme }
  state.entities = buildMockEntities()
  state.lastError = null
  state.userName = 'Host'
  state.haConfig = { latitude: 50.08, longitude: 14.42, location_name: 'Home' }

  // Guest experience in the demo: #pair=CODE, ?guest=1, ?guest=ended
  const code = takePairCodeFromUrl()
  const guest = new URLSearchParams(window.location.search).get('guest')
  if (code) {
    state.pairCode = code
    state.status = 'pairing'
  } else if (guest === 'ended') {
    state.endedReason = 'expired'
    state.status = 'guest_ended'
  } else if (guest === '1') {
    startMockGuest()
  }
}

/** Demo guest pass: restricted profile, denied calls snap back (src/lib/mockGuest.js). */
function startMockGuest() {
  state.isMock = true
  state.mode = 'guest'
  state.status = 'mock'
  state.guestPass = MOCK_GUEST_PASS
  state.guestProfileName = MOCK_GUEST_PROFILE.name
  state.userName = ''
  state.haConfig = null
  state.pairCode = ''
  useFallbackGuestConfig('mock')
  applyGuestConfig(filterConfigForProfile(getGuestConfig(), MOCK_GUEST_PROFILE), 'mock')
  const allowed = new Set(Object.keys(MOCK_GUEST_PROFILE.entities))
  state.entities = Object.fromEntries(
    Object.entries(buildMockEntities()).filter(([id]) => allowed.has(id)),
  )
}

async function loadSessionInfo(conn) {
  try {
    const user = await conn.sendMessagePromise({ type: 'auth/current_user' })
    state.userName = user?.name || ''
  } catch (err) {
    console.warn('[HA] current_user failed:', err)
  }
  try {
    const cfg = await conn.sendMessagePromise({ type: 'get_config' })
    state.haConfig = {
      latitude: cfg?.latitude,
      longitude: cfg?.longitude,
      location_name: cfg?.location_name || '',
    }
  } catch (err) {
    console.warn('[HA] get_config failed:', err)
  }
}

async function loadRemoteConfig(conn) {
  try {
    const config = await conn.sendMessagePromise({
      type: 'guest_ha_dashboard/get_config',
    })
    if (config?.pages?.length || config?.rooms?.length || config?.guestInfo) {
      applyGuestConfig(config, 'ha')
    } else {
      useFallbackGuestConfig('fallback')
    }
  } catch (err) {
    console.warn('[HA] Config integration missing, using bundled fallback:', err)
    useFallbackGuestConfig('fallback')
  }

  try {
    configUnsub?.()
    configUnsub = conn.subscribeMessage(
      (ev) => {
        if (ev?.config) applyGuestConfig(ev.config, 'ha')
      },
      { type: 'guest_ha_dashboard/subscribe_config' },
    )
  } catch (err) {
    console.warn('[HA] Config subscribe failed:', err)
  }
}

/* ─── Guest pass (restricted, enforced by the integration) ── */

let guestTransport = null
/** Last state the server confirmed, so refused optimistic changes can snap back */
let serverStates = {}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function startGuest(hassUrl, saved) {
  state.mode = 'guest'
  state.isMock = false
  state.hassUrl = hassUrl
  state.guestPass = saved.pass || null
  state.userName = ''
  state.haConfig = null
  state.lastError = null
  if (!state.everConnected) state.status = 'connecting'
  guestTransport?.close()
  guestTransport = new GuestPassTransport({ hassUrl, token: saved.token, onEvent: onGuestEvent })
  guestTransport.connect()
}

function onGuestEvent(ev) {
  switch (ev.type) {
    case 'auth_ok':
      state.guestPass = ev.pass
      state.guestProfileName = ev.profile?.name || ''
      saveGuest(state.hassUrl, { ...(loadGuest(state.hassUrl) || {}), pass: ev.pass })
      break
    case 'config':
      applyGuestConfig(ev.config || {}, 'guest')
      break
    case 'states':
      serverStates = clone(ev.states)
      state.entities = clone(ev.states)
      state.status = 'connected'
      state.everConnected = true
      markSetupDone()
      break
    case 'state':
      if (ev.state) {
        serverStates[ev.entityId] = clone(ev.state)
        state.entities[ev.entityId] = clone(ev.state)
      } else {
        delete serverStates[ev.entityId]
        delete state.entities[ev.entityId]
      }
      break
    case 'ended':
      endGuest(ev.reason)
      break
    case 'pending':
      state.status = 'guest_pending'
      break
    case 'disconnected':
      if (state.everConnected) state.status = 'disconnected'
      state.lastError = ev.reason === 'unreachable' ? tt('pairUnreachable') : null
      break
    default:
      break
  }
}

/** Pass expired or revoked: forget the token, show the calm "ended" screen. */
function endGuest(reason) {
  guestTransport?.close()
  guestTransport = null
  saveGuest(state.hassUrl, null)
  serverStates = {}
  state.entities = {}
  state.endedReason = reason || 'expired'
  state.status = 'guest_ended'
}

/** Show the pairing screen (code from the QR, or typed by hand). */
export function openPairing(code = '') {
  state.pairCode = code
  state.pairError = null
  state.status = 'pairing'
}

/** Back from the pairing screen to the normal sign-in. */
export function closePairing() {
  state.pairError = null
  state.status = state.isMock ? 'mock' : 'need_url'
}

/** Exchange a pairing code for a guest token and connect. */
export async function pairNow(hassUrl, code) {
  state.pairBusy = true
  state.pairError = null
  try {
    if (state.isMock) {
      if (!normalizeCode(code)) throw new PairError('invalid_code')
      startMockGuest()
      return
    }
    const url = String(hassUrl || '').trim().replace(/\/$/, '')
    const res = await pairWithCode(url, code)
    saveGuest(url, { token: res.token, pass: res.pass })
    localStorage.setItem(HASS_URL_KEY, url)
    syncPathWithHassUrl(url)
    state.pairCode = ''
    startGuest(url, { token: res.token, pass: res.pass })
  } catch (err) {
    state.pairError = { code: err?.code || 'unreachable', retryAfter: err?.retryAfter || 0 }
  } finally {
    state.pairBusy = false
  }
}

/* ─── Real HA connection (OAuth) ──────────────────────────── */

async function connectLive(hassUrl) {
  // Dedupe parallel connects (main tab + preview iframe refresh storms)
  if (connectInFlight) return connectInFlight
  // Already have a socket (connected or auto-reconnecting) — don't open a second one
  if (connection) return connection

  connectInFlight = (async () => {
    const url = (hassUrl || state.hassUrl || import.meta.env.VITE_HA_URL || '').replace(/\/$/, '')
    const token = import.meta.env.VITE_HA_TOKEN

    // Keep showing the dashboard during soft reconnects; only gate first auth
    if (!state.everConnected) state.status = 'connecting'
    else if (state.status !== 'connected') state.status = 'disconnected'
    state.isMock = false
    state.lastError = null

    try {
      let auth
      const parent = state.isPreview ? await requestParentAuth() : null

      if (parent) {
        auth = createParentAuth(parent)
      } else if (token && token !== 'mock' && url && url !== 'mock') {
        // Optional escape hatch: long-lived token (CI / kiosk without OAuth)
        auth = createLongLivedTokenAuth(url, token)
      } else {
        try {
          auth = await getAuth({
            hassUrl: url || undefined,
            clientId: `${window.location.origin}/`,
            redirectUrl: `${window.location.origin}${window.location.pathname}`,
            saveTokens,
            loadTokens,
          })
        } catch (err) {
          if (err === ERR_HASS_HOST_REQUIRED) {
            state.status = 'need_url'
            return
          }
          if (err === ERR_INVALID_AUTH) {
            saveTokens(null)
            state.status = 'login'
            state.lastError = tt('loginInvalid')
            return
          }
          throw err
        }
      }

      const resolvedUrl = auth.data?.hassUrl || url
      if (resolvedUrl) {
        state.hassUrl = resolvedUrl
        if (!parent) localStorage.setItem(HASS_URL_KEY, resolvedUrl)
      }

      connection = await createConnection({ auth })
      state.status = 'connected'
      state.everConnected = true
      markSetupDone()

      subscribeEntities(connection, (entities) => {
        state.entities = entities
      })

      await loadRemoteConfig(connection)
      loadSessionInfo(connection)

      connection.addEventListener('ready', () => {
        state.status = 'connected'
        state.everConnected = true
      })
      connection.addEventListener('disconnected', () => {
        // Stay on dashboard during brief drops — do not bounce to login
        if (state.status === 'connected') state.status = 'disconnected'
      })
      connection.addEventListener('reconnect-error', (ev) => {
        // Only force re-login on hard auth failure
        if (ev === ERR_INVALID_AUTH || ev?.detail === ERR_INVALID_AUTH) {
          saveTokens(null)
          state.status = 'login'
          state.lastError = tt('sessionExpired')
          return
        }
        state.status = 'disconnected'
        state.lastError = 'Reconnect failed'
      })

      cleanAuthParamsFromUrl()
    } catch (err) {
      console.error('[HA] Connection failed:', err)
      state.lastError = err?.message || String(err)
      // Keep dashboard if we already had a session; otherwise ask for login
      if (state.everConnected || loadTokens()) {
        state.status = 'disconnected'
      } else {
        state.status = 'login'
      }
    } finally {
      connectInFlight = null
    }
  })()

  return connectInFlight
}

export async function loginWithHassUrl(hassUrl) {
  const cleaned = hassUrl.trim().replace(/\/$/, '')
  if (!cleaned) {
    state.lastError = tt('loginNeedUrl')
    return
  }
  state.hassUrl = cleaned
  localStorage.setItem(HASS_URL_KEY, cleaned)
  // OAuth redirects back to the current path, so put the HA host there first
  syncPathWithHassUrl(cleaned)
  await connectLive(cleaned)
}

export async function logoutHa() {
  saveTokens(null)
  configUnsub?.()
  configUnsub = null
  try {
    connection?.close()
  } catch {
    /* ignore */
  }
  connection = null
  state.entities = {}
  state.status = 'need_url'
  state.isMock = false
}

/* ─── Public API ──────────────────────────────────────────── */

export function getEntity(entityId) {
  return computed(() => state.entities[entityId] || null)
}

export function getEntityState(entityId) {
  return state.entities[entityId] || null
}

/* ─── Transports ───────────────────────────────────────────
 * One small interface for the three ways the dashboard talks to a home:
 *   callService(domain, service, data), photoList(), photoGet(id)
 * owner = home-assistant-js-websocket + OAuth (unchanged), guest = guest pass
 * socket, mock = demo data (optionally with the demo guest profile).
 */

const ownerTransport = {
  async callService(domain, service, data) {
    if (!connection) {
      console.warn('[HA] No connection, service ignored')
      return
    }
    await haCallService(connection, domain, service, data)
  },
  async photoList() {
    if (!connection) return []
    const res = await connection.sendMessagePromise({ type: 'guest_ha_dashboard/photo_list' })
    return Array.isArray(res?.photos) ? res.photos : []
  },
  async photoGet(id) {
    const res = await connection.sendMessagePromise({
      type: 'guest_ha_dashboard/photo_get',
      // not `id`: that is the websocket message id and gets overwritten
      photo_id: id,
    })
    const bin = atob(res.data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: res.mime || 'image/jpeg' }))
  },
}

const mockTransport = {
  async callService(domain, service, data) {
    if (state.mode === 'guest') {
      const reason = mockDenyReason(MOCK_GUEST_PROFILE, domain, service, data)
      if (reason) throw new GuestError(reason)
    }
    handleMockService(domain, service, data)
  },
  async photoList() {
    const flag = mockPhotosFlag()
    if (flag === 'fail') throw new Error('demo: photo_list refused (?mockPhotos=fail)')
    return flag === 'empty' ? [] : MOCK_PHOTO_IDS.slice()
  },
  async photoGet(id) {
    return mockPhotoUrl(id)
  },
}

function transport() {
  if (state.isMock) return mockTransport
  if (state.mode === 'guest' && guestTransport) return guestTransport
  return ownerTransport
}

/** Photo calls that throw on failure (the StandBy photo cache shows the reason). */
export const photoApi = {
  list: () => transport().photoList(),
  get: (id) => transport().photoGet(id),
}

/** Refused by the guest pass: say why, put the control back to the real state. */
function onGuestRefused(code, entityId) {
  const text = translate(detectUiLang(), `guestDeny_${code}`)
  state.toast = {
    id: Date.now(),
    text: text === `guestDeny_${code}` ? tt('guestDeny_default') : text,
  }
  if (!entityId) return
  const real = state.isMock ? state.entities[entityId] : serverStates[entityId]
  if (real) state.entities[entityId] = clone(real)
}

async function sendService(domain, service, serviceData) {
  try {
    await transport().callService(domain, service, serviceData)
  } catch (err) {
    if (err instanceof GuestError) {
      onGuestRefused(err.code, serviceData?.entity_id)
      return
    }
    console.error('[HA] callService failed:', err)
    state.lastError = err?.message || String(err)
  }
}

export async function callService(domain, service, serviceData = {}) {
  playTick('tap')
  await sendService(domain, service, serviceData)
}

function handleMockService(domain, service, data) {
  const now = new Date().toISOString()
  const entityId = data?.entity_id
  const cfg = getGuestConfig()

  if (domain === 'light' && entityId) {
    const e = state.entities[entityId]
    if (!e) return

    if (service === 'toggle') {
      const on = e.state !== 'on'
      const pct = e.attributes.brightness
        ? Math.round((e.attributes.brightness / 255) * 100)
        : 80
      setLightMock(
        state.entities,
        entityId,
        on,
        on ? Math.max(pct, 1) : 0,
        e.attributes.color_temp_kelvin,
      )
    } else if (service === 'turn_on') {
      const pct =
        data.brightness_pct ??
        (data.brightness != null ? Math.round((data.brightness / 255) * 100) : 80)
      const kelvin = data.color_temp_kelvin ?? e.attributes.color_temp_kelvin ?? 3000
      setLightMock(state.entities, entityId, true, pct, kelvin)
    } else if (service === 'turn_off') {
      setLightMock(state.entities, entityId, false)
    }
  } else if (domain === 'switch' && entityId) {
    const e = state.entities[entityId]
    if (!e) return
    if (service === 'toggle') {
      e.state = e.state === 'on' ? 'off' : 'on'
    } else if (service === 'turn_on') {
      e.state = 'on'
    } else if (service === 'turn_off') {
      e.state = 'off'
    }
    e.last_updated = now
  } else if (domain === 'cover' && entityId) {
    const e = state.entities[entityId]
    if (!e) return
    if (service === 'open_cover') {
      e.state = 'open'
      e.attributes.current_position = 100
    } else if (service === 'close_cover') {
      e.state = 'closed'
      e.attributes.current_position = 0
    } else if (service === 'stop_cover') {
      e.state = e.attributes.current_position > 50 ? 'open' : 'closed'
    } else if (service === 'set_cover_position') {
      e.attributes = { ...e.attributes, current_position: data.position }
      e.state = data.position > 0 ? 'open' : 'closed'
    }
    e.last_updated = now
  } else if (domain === 'climate' && entityId) {
    const e = state.entities[entityId]
    if (!e) return
    if (service === 'set_temperature' && data.temperature != null) {
      e.attributes = { ...e.attributes, temperature: data.temperature }
    } else if (service === 'turn_off') {
      e.state = 'off'
    } else if (service === 'turn_on') {
      e.state = 'heat'
    }
    e.last_updated = now
  } else if (domain === 'media_player' && entityId) {
    const e = state.entities[entityId]
    if (!e) return
    if (service === 'media_play_pause') {
      e.state = e.state === 'playing' ? 'paused' : 'playing'
    } else if (service === 'volume_set') {
      e.attributes = { ...e.attributes, volume_level: data.volume_level }
    } else if (service === 'turn_off') {
      e.state = 'off'
    } else if (service === 'turn_on') {
      e.state = 'paused'
    }
    e.last_updated = now
  } else if (domain === 'scene' && service === 'turn_on' && entityId) {
    // Scenes removed from guest UI — keep mock hook for optional future use
    if (entityId && cfg.pages) {
      /* no-op */
    }
  }
}

export async function toggleLight(entityId) {
  await callService('light', 'toggle', { entity_id: entityId })
}

export async function setLightBrightness(entityId, brightnessPct) {
  const pct = Math.max(1, Math.min(100, Math.round(brightnessPct)))

  const e = state.entities[entityId]
  if (e) {
    e.state = 'on'
    e.attributes = {
      ...e.attributes,
      brightness: Math.round((pct / 100) * 255),
    }
  }

  if (brightnessTimers.has(entityId)) {
    clearTimeout(brightnessTimers.get(entityId))
  }

  brightnessTimers.set(
    entityId,
    setTimeout(async () => {
      brightnessTimers.delete(entityId)
      await sendService('light', 'turn_on', {
        entity_id: entityId,
        brightness_pct: pct,
      })
      playTick('snap')
    }, 80),
  )
}

export async function setLightColorTemp(entityId, kelvin) {
  await callService('light', 'turn_on', {
    entity_id: entityId,
    color_temp_kelvin: Math.round(kelvin),
  })
}

export async function activateScene(entityId) {
  await callService('scene', 'turn_on', { entity_id: entityId })
}

export async function toggleSwitch(entityId) {
  await callService('switch', 'toggle', { entity_id: entityId })
}

export async function setCover(entityId, action) {
  const map = {
    open: 'open_cover',
    close: 'close_cover',
    stop: 'stop_cover',
  }
  await callService('cover', map[action] || 'stop_cover', { entity_id: entityId })
}

export async function setClimateTemp(entityId, temperature) {
  await callService('climate', 'set_temperature', {
    entity_id: entityId,
    temperature,
  })
}

export async function setClimatePower(entityId, on) {
  await callService('climate', on ? 'turn_on' : 'turn_off', { entity_id: entityId })
}

export async function setCoverPosition(entityId, position) {
  await callService('cover', 'set_cover_position', {
    entity_id: entityId,
    position: Math.max(0, Math.min(100, Math.round(position))),
  })
}

/** media_player services: media_play_pause, media_next_track, volume_set, … */
export async function mediaCommand(entityId, service, data = {}) {
  await callService('media_player', service, { entity_id: entityId, ...data })
}

/** HA serves entity pictures as relative URLs; make them absolute for the PWA origin. */
export function haAssetUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('data:')) return path
  return `${(state.hassUrl || '').replace(/\/$/, '')}${path}`
}

/**
 * Album art of a media player. Owner mode uses HA's picture URL; guest mode
 * never sees that URL (it carries an HA token) and asks the guest socket.
 */
const artwork = reactive({})
export function mediaArtwork(entityId, attrs = {}) {
  if (state.mode !== 'guest') return haAssetUrl(attrs.entity_picture_local || attrs.entity_picture)
  if (!attrs.dash_artwork || state.isMock || !guestTransport) return ''
  const key = `${attrs.media_content_id || ''}|${attrs.media_title || ''}|${attrs.media_artist || ''}`
  const entry = artwork[entityId]
  if (!entry || entry.key !== key) {
    artwork[entityId] = { key, url: entry?.url || '' }
    guestTransport.mediaImage(entityId).then((url) => {
      if (artwork[entityId]?.key !== key) {
        if (url) URL.revokeObjectURL(url)
        return
      }
      if (artwork[entityId].url) URL.revokeObjectURL(artwork[entityId].url)
      artwork[entityId] = { key, url: url || '' }
    })
  }
  return artwork[entityId].url
}

/** Ids of the standby photos stored by the HA integration. */
export async function listPhotos() {
  try {
    return await transport().photoList()
  } catch (err) {
    console.warn('[HA] photo_list failed:', err)
    return []
  }
}

/** Standby photo from the HA integration as an object URL (null if unavailable). */
export async function fetchPhoto(id) {
  if (!id) return null
  try {
    return await transport().photoGet(id)
  } catch (err) {
    console.warn('[HA] photo_get failed:', err)
    return null
  }
}

export function initHomeAssistant() {
  if (initialized) return
  initialized = true

  if (wantsMock()) {
    startMockMode()
    return
  }

  const savedUrl = pathHassUrl || localStorage.getItem(HASS_URL_KEY) || import.meta.env.VITE_HA_URL

  // Guest passes. The HA panel's live preview always signs in as the owner.
  if (!state.isPreview) {
    const pairCode = takePairCodeFromUrl()
    if (pairCode) {
      state.pairCode = pairCode
      state.status = 'pairing'
      // Installed app: pair right away. Browser tab: the pairing screen
      // explains Add to Home Screen first (iOS keeps app storage separate).
      if (isStandalone() && savedUrl && savedUrl !== 'mock') pairNow(savedUrl, pairCode)
      return
    }
    const stored =
      savedUrl && savedUrl !== 'mock'
        ? (loadGuest(savedUrl) && { hassUrl: savedUrl, data: loadGuest(savedUrl) })
        : findAnyGuest()
    if (stored && !loadTokens()) {
      if (!pathHassUrl) syncPathWithHassUrl(stored.hassUrl)
      startGuest(stored.hassUrl, stored.data)
      return
    }
  }

  if (!pathHassUrl && savedUrl && savedUrl !== 'mock') syncPathWithHassUrl(savedUrl)
  const canResume =
    state.isPreview ||
    hasOAuthCallback() ||
    Boolean(loadTokens()) ||
    (Boolean(savedUrl) && savedUrl !== 'mock' && state.setupDone)

  if (canResume) {
    // If we only have a URL but no tokens yet, still try — getAuth will redirect once
    connectLive(savedUrl && savedUrl !== 'mock' ? savedUrl : undefined)
  } else {
    state.status = 'need_url'
    useFallbackGuestConfig('fallback')
  }
}

export function useHomeAssistant() {
  if (!initialized) initHomeAssistant()

  return {
    entities: computed(() => state.entities),
    status: computed(() => state.status),
    isMock: computed(() => state.isMock),
    lastError: computed(() => state.lastError),
    hassUrl: computed(() => state.hassUrl),
    isPreview: computed(() => state.isPreview),
    setupDone: computed(() => state.setupDone),
    userName: computed(() => state.userName),
    haConfig: computed(() => state.haConfig),
    mode: computed(() => state.mode),
    guestPass: computed(() => state.guestPass),
    guestProfileName: computed(() => state.guestProfileName),
    pairCode: computed(() => state.pairCode),
    pairError: computed(() => state.pairError),
    pairBusy: computed(() => state.pairBusy),
    endedReason: computed(() => state.endedReason),
    toast: computed(() => state.toast),
    openPairing,
    closePairing,
    pairNow,
    mediaArtwork,
    getEntity,
    getEntityState,
    callService,
    toggleLight,
    setLightBrightness,
    setLightColorTemp,
    activateScene,
    toggleSwitch,
    setCover,
    setClimateTemp,
    setClimatePower,
    setCoverPosition,
    mediaCommand,
    haAssetUrl,
    fetchPhoto,
    listPhotos,
    loginWithHassUrl,
    logoutHa,
    startMockMode,
  }
}

export default useHomeAssistant
