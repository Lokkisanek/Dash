import { computed, effectScope, ref, shallowRef, watch } from 'vue'
import { createPhotoCache, decodeImage } from '@/lib/photoCache'
import { photoApi, useHomeAssistant } from '@/composables/useHomeAssistant'

/**
 * StandBy photo frame data, shared by every StandbyScreen mount.
 *
 * photoStatus: idle | loading | ready | empty | error
 * playlist:    ready photos ({ id, url }) in list order, starting at a random
 *              photo for this standby session; grows while photos arrive.
 */
const RETRY_MS = 30_000
const RELIST_MS = 10 * 60_000
/** A photo that leaves the list may still be on screen for one cross-fade. */
const REVOKE_DELAY_MS = 3_000

const cache = createPhotoCache({
  list: () => photoApi.list(),
  fetch: (id) => photoApi.get(id),
  decode: decodeImage,
  revoke: (url) => setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS),
})

const photoStatus = ref('idle')
const readyIds = shallowRef([])
const startId = ref(null)
let active = 0
let controller = null
let retryTimer = 0
let relistTimer = 0
let running = null

function report(status, reason) {
  if (status === 'error' || status === 'empty') {
    console.groupCollapsed(`[dash] StandBy photos: ${status}`)
    console.info(reason || (status === 'empty' ? 'photo_list returned no photos' : 'unknown reason'))
    console.info('Photos are uploaded in the dash panel (StandBy tab) and stored under /config/dash_photos.')
    console.groupEnd()
  }
}

function refreshReady() {
  readyIds.value = cache.readyIds()
}

async function run() {
  if (running) {
    // reopened while an aborted sync is still finishing its last download
    return controller?.signal.aborted ? running.then(() => active && run()) : running
  }
  clearTimeout(retryTimer)
  controller = new AbortController()
  const { signal } = controller
  // Random first photo for this standby session; the order stays the list order.
  const start = Math.floor(Math.random() * 1_000_000)
  const known = cache.readyIds()
  startId.value = known.length ? known[start % known.length] : null
  refreshReady()
  if (!known.length) photoStatus.value = 'loading'

  running = (async () => {
    const result = await cache.sync({
      signal,
      start,
      onReady: (id) => {
        if (!startId.value) startId.value = id
        refreshReady()
        photoStatus.value = 'ready'
      },
    })
    refreshReady()
    if (result.status === 'aborted') return
    photoStatus.value = result.status
    if (result.status === 'error' || result.status === 'empty') report(result.status, result.reason)
    if (result.failed?.length && result.status === 'ready') {
      console.info(`[dash] StandBy photos: ${result.failed.length} photo(s) skipped`, result.failed)
    }
    if (result.status === 'error' && active) retryTimer = setTimeout(run, RETRY_MS)
  })().finally(() => {
    running = null
  })
  return running
}

let scope = null
function ensureWatchers() {
  if (scope) return
  scope = effectScope(true)
  scope.run(() => {
    const { status } = useHomeAssistant()
    watch(status, (now, before) => {
      if (['login', 'need_url', 'pairing', 'guest_ended'].includes(now)) {
        cache.clear()
        refreshReady()
        photoStatus.value = 'idle'
        return
      }
      const back = (now === 'connected' || now === 'mock') && before !== now
      if (back && active && photoStatus.value === 'error') run()
    })
  })
}

/** Start loading for a visible photo frame. Pair every open() with close(). */
function open() {
  ensureWatchers()
  active += 1
  if (active > 1) return
  run()
  clearInterval(relistTimer)
  relistTimer = setInterval(() => active && run(), RELIST_MS)
}

/** The frame was hidden or switched to the clock: stop loading, keep the cache. */
function close() {
  active = Math.max(0, active - 1)
  if (active) return
  controller?.abort()
  clearTimeout(retryTimer)
  clearInterval(relistTimer)
}

export function usePhotoCache() {
  const playlist = computed(() => {
    const ids = readyIds.value
    if (!ids.length) return []
    const at = Math.max(0, ids.indexOf(startId.value))
    return [...ids.slice(at), ...ids.slice(0, at)].map((id) => ({ id, url: cache.urlOf(id) })).filter((p) => p.url)
  })
  return { photoStatus, playlist, open, close }
}

/** Test hook: forget everything (also used on logout). */
export function clearPhotoCache() {
  cache.clear()
  refreshReady()
  photoStatus.value = 'idle'
}
