/**
 * Photo cache for the StandBy photo frame (no Vue, unit tested in tests/js).
 *
 * Lives for the whole page, so the frame does not download every photo again
 * each time the screen goes idle:
 *  - sync() lists the ids (cheap), drops photos that were deleted, then loads
 *    only the missing ones, `concurrency` at a time, starting at `start` and
 *    wrapping around, and reports each one as soon as it is decoded.
 *  - A photo that cannot be decoded is remembered as broken and skipped from
 *    then on. A download error is retried on the next sync, never in a loop.
 *  - Object URLs are revoked only when a photo leaves the list, on clear(),
 *    or when a download finishes after clear() / for a broken image.
 */

export const PHOTO_CONCURRENCY = 2

/**
 * @param {object} io
 * @param {() => Promise<string[]>} io.list        ids, throws on failure
 * @param {(id: string) => Promise<string|null>} io.fetch  object URL, throws or null on failure
 * @param {(url: string) => Promise<void>} io.decode       rejects if the image is broken
 * @param {(url: string) => void} io.revoke
 */
export function createPhotoCache({ list, fetch, decode, revoke }) {
  /** id -> { state: 'loading' | 'ready' | 'failed' | 'broken', url, error } */
  const entries = new Map()
  let order = []
  let generation = 0

  function drop(id) {
    const entry = entries.get(id)
    if (entry?.url) revoke(entry.url)
    entries.delete(id)
  }

  function readyIds() {
    return order.filter((id) => entries.get(id)?.state === 'ready')
  }

  /**
   * @returns {Promise<{ status: 'ready'|'empty'|'error'|'aborted', reason?: string, failed?: string[] }>}
   */
  async function sync({ signal, start = 0, concurrency = PHOTO_CONCURRENCY, onReady } = {}) {
    const gen = generation
    let ids
    try {
      ids = await list()
    } catch (err) {
      return { status: 'error', reason: `photo_list failed: ${describe(err)}` }
    }
    if (!Array.isArray(ids)) return { status: 'error', reason: 'photo_list returned no list' }
    if (gen !== generation) return { status: 'aborted' }

    const keep = new Set(ids)
    for (const id of [...entries.keys()]) if (!keep.has(id)) drop(id)
    order = ids.slice()
    if (!ids.length) return { status: 'empty' }

    const first = ((Number(start) % ids.length) + ids.length) % ids.length
    const rotated = [...ids.slice(first), ...ids.slice(0, first)]
    const queue = rotated.filter((id) => {
      const state = entries.get(id)?.state
      return state !== 'ready' && state !== 'broken' && state !== 'loading'
    })
    const failed = []

    async function loadOne(id) {
      entries.set(id, { state: 'loading', url: null })
      let url = null
      try {
        url = await fetch(id)
        if (!url) throw new Error('no data')
      } catch (err) {
        if (gen === generation) entries.set(id, { state: 'failed', url: null, error: describe(err) })
        failed.push(id)
        return
      }
      if (gen !== generation || !keep.has(id) || !order.includes(id)) {
        // cleared or deleted while downloading: nobody will ever use this URL
        revoke(url)
        return
      }
      try {
        await decode(url)
      } catch (err) {
        revoke(url)
        entries.set(id, { state: 'broken', url: null, error: describe(err) })
        failed.push(id)
        return
      }
      if (gen !== generation) {
        revoke(url)
        return
      }
      entries.set(id, { state: 'ready', url })
      onReady?.(id, url)
    }

    async function worker() {
      while (queue.length) {
        if (signal?.aborted || gen !== generation) return
        await loadOne(queue.shift())
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))

    if (gen !== generation || signal?.aborted) {
      return readyIds().length ? { status: 'ready', failed } : { status: 'aborted' }
    }
    if (readyIds().length) return { status: 'ready', failed }
    const reasons = failed.map((id) => `${id}: ${entries.get(id)?.error || 'failed'}`)
    return { status: 'error', reason: `no photo could be loaded (${reasons.join('; ')})`, failed }
  }

  /** Forget everything (logout, other home): revoke every URL. */
  function clear() {
    generation += 1
    for (const id of [...entries.keys()]) drop(id)
    order = []
  }

  return {
    sync,
    clear,
    readyIds,
    urlOf: (id) => (entries.get(id)?.state === 'ready' ? entries.get(id).url : null),
    stateOf: (id) => entries.get(id)?.state || null,
    get order() {
      return order.slice()
    },
    get size() {
      return entries.size
    },
  }
}

function describe(err) {
  if (!err) return 'unknown error'
  if (typeof err === 'string') return err
  return err.message || err.code || (() => {
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  })()
}

/** Resolve once the browser has decoded the image, so swapping it in never flashes. */
export function decodeImage(url) {
  const img = new Image()
  img.src = url
  if (typeof img.decode === 'function') return img.decode()
  return new Promise((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('image failed to load'))
  })
}
