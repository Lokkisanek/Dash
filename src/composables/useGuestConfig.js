import { reactive, computed } from 'vue'
import { guestDashboard as fallbackConfig } from '@/config/guestDashboard'

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

function normalizeDock(config) {
  if (!Array.isArray(config?.dock)) return []
  return config.dock
    .filter((d) => d && !d.entityId && !d.entity_id)
    .slice(0, 4)
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
    /** @deprecated alias — use pages */
    rooms: computed(() => state.config.pages || []),
    pages: computed(() => state.config.pages || []),
    dock: computed(() => (Array.isArray(state.config.dock) ? state.config.dock.slice(0, 4) : [])),
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

export function applyGuestConfig(config, source = 'ha') {
  if (!config || typeof config !== 'object') return
  state.config = {
    guestInfo: {
      ...fallbackConfig.guestInfo,
      ...(config.guestInfo || {}),
    },
    general: {
      ...fallbackConfig.general,
      ...(config.general || {}),
    },
    appearance: {
      mode: 'light',
      accent: '#ff6b00',
      ...(config.appearance || {}),
    },
    pages: normalizePages(config),
    dock: normalizeDock(config),
    dashboardUrl: config.dashboardUrl || '',
  }
  state.source = source
  state.loaded = true
}

export function useFallbackGuestConfig(source = 'fallback') {
  applyGuestConfig(fallbackConfig, source)
}

export default useGuestConfig
