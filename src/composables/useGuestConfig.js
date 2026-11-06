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

export function getGuestConfig() {
  return state.config
}

export function useGuestConfig() {
  return {
    loaded: computed(() => state.loaded),
    source: computed(() => state.source),
    config: computed(() => state.config),
    guestInfo: computed(() => state.config.guestInfo),
    rooms: computed(() => state.config.rooms || []),
    scenes: computed(() => state.config.scenes || []),
    dock: computed(() => (Array.isArray(state.config.dock) ? state.config.dock.slice(0, 4) : [])),
    appearance: computed(() => ({
      mode: 'light',
      accent: '#ff6b00',
      ...(state.config.appearance || {}),
    })),
    // Saved HA config wins — draft panel edits must not leak via ?theme= before Save
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
  const dock = Array.isArray(config.dock)
    ? config.dock
        .filter((d) => d && (d.entityId || d.entity_id))
        .slice(0, 4)
        .map((d) => ({
          entityId: d.entityId || d.entity_id || '',
          label: d.label || '',
          showLabel: d.showLabel !== false && Boolean(d.label),
          icon: d.icon || 'Power',
        }))
    : []
  state.config = {
    guestInfo: {
      ...fallbackConfig.guestInfo,
      ...(config.guestInfo || {}),
    },
    appearance: {
      mode: 'light',
      accent: '#ff6b00',
      ...(config.appearance || {}),
    },
    scenes: Array.isArray(config.scenes) ? config.scenes : [],
    rooms: Array.isArray(config.rooms) ? config.rooms : [],
    dock,
    dashboardUrl: config.dashboardUrl || '',
  }
  state.source = source
  state.loaded = true
}

export function useFallbackGuestConfig(source = 'fallback') {
  applyGuestConfig(fallbackConfig, source)
}

export default useGuestConfig
