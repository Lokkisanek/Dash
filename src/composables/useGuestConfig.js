import { reactive, computed } from 'vue'
import { guestDashboard as fallbackConfig } from '@/config/guestDashboard'
import { migrateConfig } from '@/lib/configMigrate'
import { onPreviewMessage } from '@/lib/previewBridge'

const state = reactive({
  loaded: false,
  source: 'fallback', // fallback | ha | mock
  config: structuredClone(fallbackConfig),
})

function readUrlTheme() {
  try {
    const t = new URLSearchParams(window.location.search).get('theme')
    if (t === 'light' || t === 'dark') return t
  } catch {
    /* ignore */
  }
  return null
}

function normalizePages(config) {
  if (Array.isArray(config?.pages) && config.pages.length) return config.pages
  if (Array.isArray(config?.rooms)) return config.rooms
  if (Array.isArray(config?.pages)) return config.pages
  return []
}

export const DOCK_MAX = 6

function normalizeDock(config) {
  if (!Array.isArray(config?.dock)) return []
  return config.dock
    .filter((d) => d && !d.entityId && !d.entity_id)
    .slice(0, DOCK_MAX)
    .map((d) => ({
      pageId: d.pageId || d.page_id || d.roomId || d.room_id || '',
      label: d.label || '',
      showLabel: d.showLabel !== false,
      icon: d.icon || 'Home',
    }))
    .filter((d) => d.pageId)
}

export function getGuestConfig() {
  return state.config
}

export function useGuestConfig() {
  return {
    loaded: computed(() => state.loaded),
    source: computed(() => state.source),
    config: computed(() => state.config),
    guestInfo: computed(() => state.config.guestInfo),
    general: computed(() => ({ ...fallbackConfig.general, ...(state.config.general || {}) })),
    standby: computed(() => ({ ...fallbackConfig.standby, ...(state.config.standby || {}) })),
    /** @deprecated alias — use pages */
    rooms: computed(() => state.config.pages || []),
    pages: computed(() => state.config.pages || []),
    dock: computed(() => (Array.isArray(state.config.dock) ? state.config.dock.slice(0, DOCK_MAX) : [])),
    capabilities: computed(() => state.config.capabilities || null),
    appearance: computed(() => ({
      mode: 'light',
      accent: '#ff6b00',
      ...(state.config.appearance || {}),
    })),
    themeMode: computed(() => {
      if (state.config.appearance?.mode === 'dark') return 'dark'
      if (state.config.appearance?.mode === 'light') return 'light'
      const urlTheme = readUrlTheme()
      if (urlTheme) return urlTheme
      return 'light'
    }),
  }
}

/**
 * Live preview: the HA panel pushes its unsaved draft (lib/previewBridge.js).
 * Once a draft arrived it wins over the saved config from the subscription,
 * which only catches up after Uložit.
 */
let previewDraft = false
onPreviewMessage((data) => {
  if (data?.config && typeof data.config === 'object') {
    previewDraft = true
    applyGuestConfig(data.config, 'preview')
  }
})

export function applyGuestConfig(raw, source = 'ha') {
  if (!raw || typeof raw !== 'object') return
  if (previewDraft && source !== 'preview') return
  // An older integration may still send the header switches in `general` (v2):
  // convert them like config_schema.migrate_config does on the server.
  const config = migrateConfig(raw)
  state.config = {
    configVersion: config.configVersion,
    guestInfo: {
      ...fallbackConfig.guestInfo,
      ...(config.guestInfo || {}),
    },
    general: {
      ...fallbackConfig.general,
      ...(config.general || {}),
    },
    standby: {
      ...fallbackConfig.standby,
      ...(config.standby || {}),
    },
    appearance: {
      mode: 'light',
      accent: '#ff6b00',
      ...(config.appearance || {}),
    },
    pages: normalizePages(config),
    dock: normalizeDock(config),
    // guest passes only: what the profile allows beyond on/off (null = owner, everything)
    capabilities: config.capabilities && typeof config.capabilities === 'object' ? { ...config.capabilities } : null,
    dashboardUrl: config.dashboardUrl || '',
    // browser radio (owner, or a guest with allow_local_player) and the Spotify switch
    radio: config.radio && typeof config.radio === 'object' ? { ...config.radio } : { stations: [] },
    spotify: config.spotify && typeof config.spotify === 'object' ? { ...config.spotify } : { enabled: false },
  }
  state.source = source
  state.loaded = true
}

/** Shown only in mock/demo mode, so the Wi-Fi card has an obviously fake value. */
const DEMO_WIFI_PASSWORD = 'demo-password'

export function useFallbackGuestConfig(source = 'fallback') {
  const config =
    source === 'mock'
      ? { ...fallbackConfig, guestInfo: { ...fallbackConfig.guestInfo, wifiPassword: DEMO_WIFI_PASSWORD } }
      : fallbackConfig
  applyGuestConfig(config, source)
}

export default useGuestConfig
