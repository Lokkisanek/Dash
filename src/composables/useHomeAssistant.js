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

/** @typedef {'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'mock' | 'need_url' | 'login'} HaStatus */

const TOKENS_KEY = 'guest_ha_tokens'
const HASS_URL_KEY = 'guest_ha_url'

const state = reactive({
  /** @type {Record<string, object>} */
  entities: {},
  /** @type {HaStatus} */
  status: 'idle',
  isMock: false,
  lastError: null,
  hassUrl: localStorage.getItem(HASS_URL_KEY) || import.meta.env.VITE_HA_URL || '',
  /** True once we have successfully connected in this tab session */
  everConnected: false,
})

let connection = null
let brightnessTimers = new Map()
let initialized = false
let configUnsub = null
let connectInFlight = null

function isPreviewMode() {
  try {
    return new URLSearchParams(window.location.search).get('preview') === '1'
  } catch {
    return false
  }
}

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

function saveTokens(tokens) {
  if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  else localStorage.removeItem(TOKENS_KEY)
}

function loadTokens() {
  const raw = localStorage.getItem(TOKENS_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
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

  for (const room of cfg.rooms || []) {
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
            min_temp: 16,
            max_temp: 28,
          },
          last_changed: now,
          last_updated: now,
        }
      }
    }
  }

  for (const scene of cfg.scenes || []) {
    if (!scene.entityId) continue
    entities[scene.entityId] = {
      entity_id: scene.entityId,
      state: 'scening',
      attributes: { friendly_name: scene.label },
      last_changed: now,
      last_updated: now,
    }
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
  useFallbackGuestConfig('mock')
  state.entities = buildMockEntities()
  state.lastError = null
}

async function loadRemoteConfig(conn) {
  try {
    const config = await conn.sendMessagePromise({
      type: 'guest_ha_dashboard/get_config',
    })
    if (config?.rooms?.length || config?.guestInfo) {
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

/* ─── Real HA connection (OAuth) ──────────────────────────── */

async function connectLive(hassUrl) {
  // Dedupe parallel connects (main tab + preview iframe refresh storms)
  if (connectInFlight) return connectInFlight

  connectInFlight = (async () => {
    const url = (hassUrl || state.hassUrl || import.meta.env.VITE_HA_URL || '').replace(/\/$/, '')
    const token = import.meta.env.VITE_HA_TOKEN
    const preview = isPreviewMode()

    state.status = 'connecting'
    state.isMock = false
    state.lastError = null

    try {
      let auth

      // Optional escape hatch: long-lived token (CI / kiosk without OAuth)
      if (token && token !== 'mock' && url && url !== 'mock') {
        auth = createLongLivedTokenAuth(url, token)
      } else {
        // Preview iframe: only reuse stored tokens — never kick OAuth redirect loops
        if (preview && !loadTokens() && !hasOAuthCallback()) {
          state.status = 'need_url'
          state.lastError = null
          return
        }
        try {
          auth = await getAuth({
            hassUrl: url || undefined,
            clientId: `${window.location.origin}/`,
            // Keep preview/theme query params out of redirect base
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
            state.status = preview ? 'need_url' : 'login'
            state.lastError = preview ? null : 'Neplatné přihlášení — zkus to znovu'
            return
          }
          throw err
        }
      }

      if (auth.data?.hassUrl) {
        state.hassUrl = auth.data.hassUrl
        localStorage.setItem(HASS_URL_KEY, auth.data.hassUrl)
      } else if (url) {
        state.hassUrl = url
        localStorage.setItem(HASS_URL_KEY, url)
      }

      connection = await createConnection({ auth })
      state.status = 'connected'
      state.everConnected = true

      subscribeEntities(connection, (entities) => {
        state.entities = entities
      })

      await loadRemoteConfig(connection)

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
          state.lastError = 'Session vypršela — přihlas se znovu'
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
        state.status = preview ? 'need_url' : 'login'
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
    state.lastError = 'Zadej URL Home Assistantu'
    return
  }
  state.hassUrl = cleaned
  localStorage.setItem(HASS_URL_KEY, cleaned)
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

export async function callService(domain, service, serviceData = {}) {
  playTick('tap')

  if (state.isMock) {
    handleMockService(domain, service, serviceData)
    return
  }

  if (!connection) {
    console.warn('[HA] No connection, service ignored')
    return
  }

  try {
    await haCallService(connection, domain, service, serviceData)
  } catch (err) {
    console.error('[HA] callService failed:', err)
    state.lastError = err?.message || String(err)
  }
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
    }
    e.last_updated = now
  } else if (domain === 'climate' && entityId) {
    const e = state.entities[entityId]
    if (!e) return
    if (service === 'set_temperature' && data.temperature != null) {
      e.attributes.temperature = data.temperature
      e.last_updated = now
    }
  } else if (domain === 'scene' && service === 'turn_on' && entityId) {
    const scene = (cfg.scenes || []).find((s) => s.entityId === entityId)
    if (scene?.mockAction) applyMockScene(scene.mockAction)
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
      if (state.isMock) {
        handleMockService('light', 'turn_on', {
          entity_id: entityId,
          brightness_pct: pct,
        })
      } else if (connection) {
        try {
          await haCallService(connection, 'light', 'turn_on', {
            entity_id: entityId,
            brightness_pct: pct,
          })
        } catch (err) {
          console.error('[HA] setLightBrightness failed:', err)
        }
      }
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

export function initHomeAssistant() {
  if (initialized) return
  initialized = true

  if (wantsMock()) {
    startMockMode()
    return
  }

  const savedUrl = localStorage.getItem(HASS_URL_KEY) || import.meta.env.VITE_HA_URL
  const canResume =
    hasOAuthCallback() || Boolean(loadTokens()) || (Boolean(savedUrl) && savedUrl !== 'mock')

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
    loginWithHassUrl,
    logoutHa,
    startMockMode,
  }
}

export default useHomeAssistant
