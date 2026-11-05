import { reactive, computed } from 'vue'
import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService as haCallService,
} from 'home-assistant-js-websocket'
import { guestDashboard } from '@/config/guestDashboard'
import { playTick } from './useSound'

/** @typedef {'connecting' | 'connected' | 'disconnected' | 'error' | 'mock'} HaStatus */

const state = reactive({
  /** @type {Record<string, object>} */
  entities: {},
  /** @type {HaStatus} */
  status: 'connecting',
  isMock: false,
  lastError: null,
})

let connection = null
let brightnessTimers = new Map()
let initialized = false

function isMockConfigured() {
  const url = import.meta.env.VITE_HA_URL
  const token = import.meta.env.VITE_HA_TOKEN
  return (
    !url ||
    !token ||
    url === 'mock' ||
    token === 'mock' ||
    url.trim() === '' ||
    token.trim() === ''
  )
}

/* ─── Mock entity factory ─────────────────────────────────── */

function buildMockEntities() {
  /** @type {Record<string, object>} */
  const entities = {}
  const now = new Date().toISOString()

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

  for (const room of guestDashboard.rooms) {
    for (const device of room.devices) {
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

  for (const scene of guestDashboard.scenes) {
    entities[scene.entityId] = {
      entity_id: scene.entityId,
      state: 'scening',
      attributes: { friendly_name: scene.label },
      last_changed: now,
      last_updated: now,
    }
  }

  // Seed a few lights on for a lively first paint
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
  state.entities = buildMockEntities()
  state.lastError = null
}

/* ─── Real HA connection ──────────────────────────────────── */

async function connectLive() {
  const haUrl = import.meta.env.VITE_HA_URL
  const haToken = import.meta.env.VITE_HA_TOKEN

  state.status = 'connecting'
  state.isMock = false

  try {
    const auth = createLongLivedTokenAuth(haUrl, haToken)
    connection = await createConnection({ auth })
    state.status = 'connected'

    subscribeEntities(connection, (entities) => {
      state.entities = entities
    })

    connection.addEventListener('ready', () => {
      state.status = 'connected'
    })
    connection.addEventListener('disconnected', () => {
      state.status = 'disconnected'
    })
    connection.addEventListener('reconnect-error', () => {
      state.status = 'error'
      state.lastError = 'Reconnect failed'
    })
  } catch (err) {
    console.error('[HA] Connection failed, falling back to mock:', err)
    state.lastError = err?.message || String(err)
    startMockMode()
  }
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

  if (domain === 'light' && entityId) {
    const e = state.entities[entityId]
    if (!e) return

    if (service === 'toggle') {
      const on = e.state !== 'on'
      const pct = e.attributes.brightness
        ? Math.round((e.attributes.brightness / 255) * 100)
        : 80
      setLightMock(state.entities, entityId, on, on ? Math.max(pct, 1) : 0, e.attributes.color_temp_kelvin)
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
    const scene = guestDashboard.scenes.find((s) => s.entityId === entityId)
    if (scene?.mockAction) applyMockScene(scene.mockAction)
  }
}

export async function toggleLight(entityId) {
  await callService('light', 'toggle', { entity_id: entityId })
}

export async function setLightBrightness(entityId, brightnessPct) {
  const pct = Math.max(1, Math.min(100, Math.round(brightnessPct)))

  // Optimistic local update for silky drag feedback
  const e = state.entities[entityId]
  if (e) {
    e.state = 'on'
    e.attributes = {
      ...e.attributes,
      brightness: Math.round((pct / 100) * 255),
    }
  }

  // Debounce HA writes while dragging
  if (brightnessTimers.has(entityId)) {
    clearTimeout(brightnessTimers.get(entityId))
  }

  brightnessTimers.set(
    entityId,
    setTimeout(async () => {
      brightnessTimers.delete(entityId)
      // Skip playTick on every drag — only fire once at end via soft
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

  if (isMockConfigured()) {
    startMockMode()
  } else {
    connectLive()
  }
}

/**
 * Singleton composable — call from any component.
 */
export function useHomeAssistant() {
  if (!initialized) initHomeAssistant()

  return {
    entities: computed(() => state.entities),
    status: computed(() => state.status),
    isMock: computed(() => state.isMock),
    lastError: computed(() => state.lastError),
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
  }
}

export default useHomeAssistant
