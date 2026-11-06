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
    appearance: computed(() => ({
      mode: 'light',
      accent: '#ff6b00',
      ...(state.config.appearance || {}),
    })),
    themeMode: computed(() => {
      const urlTheme = readUrlTheme()
      if (urlTheme) return urlTheme
      return state.config.appearance?.mode === 'dark' ? 'dark' : 'light'
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
    appearance: {
      ...fallbackConfig.appearance,
      ...(config.appearance || {}),
    },
    scenes: Array.isArray(config.scenes) ? config.scenes : [],
    rooms: Array.isArray(config.rooms) ? config.rooms : [],
    dashboardUrl: config.dashboardUrl || '',
  }
  state.source = source
  state.loaded = true
}

export function useFallbackGuestConfig(source = 'fallback') {
  applyGuestConfig(fallbackConfig, source)
}

export default useGuestConfig
