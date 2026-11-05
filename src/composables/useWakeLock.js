import { onMounted, onUnmounted, ref } from 'vue'

/**
 * Keeps the screen awake on MagSafe kiosk via Screen Wake Lock API.
 * Automatically re-acquires the lock when the page becomes visible again.
 */
export function useWakeLock() {
  const isActive = ref(false)
  const isSupported = ref(false)
  let wakeLock = null

  async function requestLock() {
    if (!('wakeLock' in navigator)) return
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      isActive.value = true
      wakeLock.addEventListener('release', () => {
        isActive.value = false
      })
    } catch {
      isActive.value = false
    }
  }

  async function releaseLock() {
    if (wakeLock) {
      try {
        await wakeLock.release()
      } catch {
        /* ignore */
      }
      wakeLock = null
      isActive.value = false
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      requestLock()
    }
  }

  onMounted(() => {
    isSupported.value = 'wakeLock' in navigator
    if (isSupported.value) {
      requestLock()
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    releaseLock()
  })

  return { isActive, isSupported, requestLock, releaseLock }
}
