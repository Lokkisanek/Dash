import { ref, watch, onMounted, onUnmounted } from 'vue'

const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']

/**
 * `idle` turns true after `minutes` without any interaction while `enabled`.
 * Both arguments are refs/getters so config changes apply live.
 */
export function useIdle(minutes, enabled) {
  const idle = ref(false)
  let timer = 0
  let lastMove = 0

  function arm() {
    clearTimeout(timer)
    if (!enabled()) return
    timer = setTimeout(() => (idle.value = true), Math.max(1, Number(minutes()) || 1) * 60_000)
  }

  function activity(e) {
    // pointermove fires constantly on desktop; only count it every few seconds
    if (e?.type === 'pointermove') {
      const now = performance.now()
      if (now - lastMove < 3000) return
      lastMove = now
    }
    if (idle.value) return
    arm()
  }

  function wake() {
    idle.value = false
    arm()
  }

  function sleep() {
    clearTimeout(timer)
    idle.value = true
  }

  watch([minutes, enabled], () => {
    if (!enabled()) idle.value = false
    arm()
  })

  onMounted(() => {
    EVENTS.forEach((ev) => window.addEventListener(ev, activity, { passive: true }))
    arm()
  })
  onUnmounted(() => {
    clearTimeout(timer)
    EVENTS.forEach((ev) => window.removeEventListener(ev, activity))
  })

  return { idle, wake, sleep }
}
