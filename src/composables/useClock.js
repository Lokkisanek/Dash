import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useGuestConfig } from './useGuestConfig'
import { useI18n } from './useI18n'

/**
 * One shared ticker for every clock, greeting and header tile: a single
 * interval runs while at least one component uses it.
 */
const now = ref(new Date())
let timer = null
let users = 0

function start() {
  users += 1
  if (timer) return
  now.value = new Date()
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
}

function stop() {
  users = Math.max(0, users - 1)
  if (users === 0 && timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Time-of-day greeting key: morning 5–11, day 11–18, evening 18–22, night otherwise. */
export function greetingKey(hours) {
  if (hours >= 5 && hours < 11) return 'greetMorning'
  if (hours >= 11 && hours < 18) return 'greetDay'
  if (hours >= 18 && hours < 22) return 'greetEvening'
  return 'greetNight'
}

/** "Dobrý večer, Matyáš": first word of the HA user's name, if any. */
export function greetingText(t, hours, userName) {
  const name = String(userName || '').trim().split(/\s+/)[0]
  return name ? `${t(greetingKey(hours))}, ${name}` : t(greetingKey(hours))
}

export function useClock() {
  const { general } = useGuestConfig()
  const { locale } = useI18n()
  onMounted(start)
  onUnmounted(stop)

  const use24h = computed(() => general.value.use24h !== false)
  const time = computed(() =>
    now.value.toLocaleTimeString(locale.value, {
      hour: use24h.value ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !use24h.value,
    }),
  )
  const date = computed(() =>
    now.value.toLocaleDateString(locale.value, { weekday: 'short', day: 'numeric', month: 'short' }),
  )
  /** Lock-screen date: "pátek 7. listopadu". */
  const longDate = computed(() =>
    now.value.toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }),
  )
  return { now, time, date, longDate }
}
