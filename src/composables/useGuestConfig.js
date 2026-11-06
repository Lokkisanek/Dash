import { reactive, computed, readonly } from 'vue'
import { guestDashboard as fallbackConfig } from '@/config/guestDashboard'

const state = reactive({
  loaded: false,
  source: 'fallback', // fallback | ha | mock
  config: structuredClone(fallbackConfig),
})

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
  }
}

export function applyGuestConfig(config, source = 'ha') {
  if (!config || typeof config !== 'object') return
  state.config = {
    guestInfo: {
      ...fallbackConfig.guestInfo,
      ...(config.guestInfo || {}),
    },
    scenes: Array.isArray(config.scenes) ? config.scenes : [],
    rooms: Array.isArray(config.rooms) ? config.rooms : [],
  }
  state.source = source
  state.loaded = true
}

export function useFallbackGuestConfig(source = 'fallback') {
  applyGuestConfig(fallbackConfig, source)
}

export default useGuestConfig
