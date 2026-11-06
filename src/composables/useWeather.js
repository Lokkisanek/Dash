import { ref, computed, watch } from 'vue'
import { useHomeAssistant } from './useHomeAssistant'
import { useGuestConfig } from './useGuestConfig'

const REFRESH_MS = 15 * 60 * 1000

/** Open-Meteo WMO weather code → HA weather condition. */
function wmoToCondition(code) {
  if (code === 0) return 'sunny'
  if (code <= 2) return 'partlycloudy'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 67) return code >= 65 ? 'pouring' : 'rainy'
  if (code >= 71 && code <= 77) return 'snowy'
  if (code >= 80 && code <= 82) return 'rainy'
  if (code === 85 || code === 86) return 'snowy'
  if (code >= 95) return 'lightning-rainy'
  return 'cloudy'
}

const fallback = ref(null)
let fetchedFor = ''
let timer = null

async function fetchOpenMeteo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code,is_day'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const cur = data?.current || {}
    const condition = wmoToCondition(cur.weather_code)
    fallback.value = {
      temperature: cur.temperature_2m ?? null,
      humidity: cur.relative_humidity_2m ?? null,
      condition: condition === 'sunny' && cur.is_day === 0 ? 'clear-night' : condition,
    }
  } catch (err) {
    console.warn('[weather] Open-Meteo failed:', err)
  }
}

/**
 * Outside weather for the HA home location: the configured (or first) weather.*
 * entity, otherwise Open-Meteo at the coordinates from HA core config.
 */
export function useWeather() {
  const { entities, haConfig } = useHomeAssistant()
  const { general } = useGuestConfig()

  const entity = computed(() => {
    const all = entities.value || {}
    const wanted = general.value.weatherEntity
    if (wanted && all[wanted]) return all[wanted]
    const id = Object.keys(all).find((k) => k.startsWith('weather.'))
    return id ? all[id] : null
  })

  watch(
    [entity, haConfig],
    ([ent, cfg]) => {
      if (ent || cfg?.latitude == null || cfg?.longitude == null) return
      const key = `${cfg.latitude},${cfg.longitude}`
      if (key === fetchedFor) return
      fetchedFor = key
      fetchOpenMeteo(cfg.latitude, cfg.longitude)
      clearInterval(timer)
      timer = setInterval(() => fetchOpenMeteo(cfg.latitude, cfg.longitude), REFRESH_MS)
    },
    { immediate: true },
  )

  return computed(() => {
    const ent = entity.value
    if (ent) {
      const t = parseFloat(ent.attributes?.temperature)
      const h = parseFloat(ent.attributes?.humidity)
      return {
        temperature: Number.isFinite(t) ? t : null,
        humidity: Number.isFinite(h) ? h : null,
        condition: ent.state,
      }
    }
    return fallback.value
  })
}

export default useWeather
