import { describe, expect, it, vi } from 'vitest'
import { createPhotoCache } from '../../src/lib/photoCache.js'

/** Fake transport: ids, per-id behaviour ('ok' | 'fail' | 'broken'), call log. */
function setup({ ids = ['a', 'b', 'c'], behaviour = {}, listError = null } = {}) {
  const calls = { list: 0, fetch: [], revoked: [] }
  let current = ids.slice()
  let n = 0
  const cache = createPhotoCache({
    list: async () => {
      calls.list += 1
      if (listError) throw listError
      return current.slice()
    },
    fetch: async (id) => {
      calls.fetch.push(id)
      await Promise.resolve()
      if (behaviour[id] === 'fail') throw new Error(`fetch ${id} failed`)
      n += 1
      return `blob:${id}#${n}`
    },
    decode: async (url) => {
      const id = url.slice(5).split('#')[0]
      if (behaviour[id] === 'broken') throw new Error('EncodingError')
    },
    revoke: (url) => calls.revoked.push(url),
  })
  return {
    cache,
    calls,
    setIds: (next) => {
      current = next.slice()
    },
    setListError: (err) => {
      listError = err
    },
  }
}

describe('photo cache', () => {
  it('loads every photo once and reuses them on the next sync', async () => {
    const { cache, calls } = setup()
    expect(await cache.sync()).toMatchObject({ status: 'ready' })
    expect(cache.readyIds()).toEqual(['a', 'b', 'c'])
    expect(calls.fetch).toEqual(['a', 'b', 'c'])

    expect(await cache.sync()).toMatchObject({ status: 'ready' })
    expect(calls.list).toBe(2)
    expect(calls.fetch).toEqual(['a', 'b', 'c']) // nothing downloaded again
    expect(calls.revoked).toEqual([])
  })

  it('fetches only photos that are new', async () => {
    const { cache, calls, setIds } = setup({ ids: ['a'] })
    await cache.sync()
    setIds(['a', 'b'])
    await cache.sync()
    expect(calls.fetch).toEqual(['a', 'b'])
    expect(cache.readyIds()).toEqual(['a', 'b'])
  })

  it('revokes only photos that left the list', async () => {
    const { cache, calls, setIds } = setup()
    await cache.sync()
    const urlB = cache.urlOf('b')
    setIds(['a', 'c'])
    await cache.sync()
    expect(calls.revoked).toEqual([urlB])
    expect(cache.readyIds()).toEqual(['a', 'c'])
    expect(cache.urlOf('b')).toBeNull()
  })

  it('reports photos in the order they become ready, starting at `start`', async () => {
    const { cache } = setup({ ids: ['a', 'b', 'c', 'd'] })
    const seen = []
    await cache.sync({ start: 2, concurrency: 1, onReady: (id) => seen.push(id) })
    expect(seen).toEqual(['c', 'd', 'a', 'b'])
    // playlist order stays the list order
    expect(cache.readyIds()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('shows the first photo before the others have loaded', async () => {
    const { cache } = setup({ ids: ['a', 'b', 'c'] })
    const readyWhenFirstArrived = []
    await cache.sync({
      concurrency: 1,
      onReady: () => readyWhenFirstArrived.push(cache.readyIds().length),
    })
    expect(readyWhenFirstArrived).toEqual([1, 2, 3])
  })

  it('downloads at most `concurrency` photos at a time', async () => {
    let inFlight = 0
    let peak = 0
    const cache = createPhotoCache({
      list: async () => ['a', 'b', 'c', 'd', 'e'],
      fetch: async (id) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight -= 1
        return `blob:${id}`
      },
      decode: async () => {},
      revoke: () => {},
    })
    await cache.sync({ concurrency: 2 })
    expect(peak).toBe(2)
    expect(cache.readyIds()).toHaveLength(5)
  })

  it('reports an empty list', async () => {
    const { cache } = setup({ ids: [] })
    expect(await cache.sync()).toEqual({ status: 'empty' })
  })

  it('reports a failing list with the reason', async () => {
    const { cache } = setup({ listError: { code: 'unknown_command', message: 'Unknown command.' } })
    const res = await cache.sync()
    expect(res.status).toBe('error')
    expect(res.reason).toContain('Unknown command.')
  })

  it('keeps cached photos when a later list fails', async () => {
    const { cache, setListError } = setup()
    await cache.sync()
    setListError(new Error('offline'))
    const res = await cache.sync()
    expect(res.status).toBe('error')
    expect(cache.readyIds()).toEqual(['a', 'b', 'c'])
  })

  it('skips a broken image for good and revokes its URL', async () => {
    const { cache, calls } = setup({ behaviour: { b: 'broken' } })
    const res = await cache.sync()
    expect(res.status).toBe('ready')
    expect(res.failed).toEqual(['b'])
    expect(cache.readyIds()).toEqual(['a', 'c'])
    expect(calls.revoked).toHaveLength(1)
    expect(calls.revoked[0]).toMatch(/^blob:b#/)

    await cache.sync()
    expect(calls.fetch.filter((id) => id === 'b')).toHaveLength(1) // never retried
  })

  it('retries a failed download on the next sync only', async () => {
    const behaviour = { b: 'fail' }
    const { cache, calls } = setup({ behaviour })
    await cache.sync()
    expect(calls.fetch.filter((id) => id === 'b')).toHaveLength(1)
    delete behaviour.b
    await cache.sync()
    expect(calls.fetch.filter((id) => id === 'b')).toHaveLength(2)
    expect(cache.readyIds()).toEqual(['a', 'b', 'c'])
  })

  it('is an error when no photo can be loaded', async () => {
    const { cache } = setup({ ids: ['a', 'b'], behaviour: { a: 'fail', b: 'broken' } })
    const res = await cache.sync()
    expect(res.status).toBe('error')
    expect(res.reason).toContain('a: fetch a failed')
    expect(res.reason).toContain('b: EncodingError')
  })

  it('stops taking new photos when aborted and keeps what finished', async () => {
    const { cache, calls } = setup({ ids: ['a', 'b', 'c', 'd'] })
    const controller = new AbortController()
    const res = await cache.sync({
      signal: controller.signal,
      concurrency: 1,
      onReady: () => controller.abort(),
    })
    expect(res.status).toBe('ready')
    expect(calls.fetch).toEqual(['a'])
    expect(cache.readyIds()).toEqual(['a'])
  })

  it('revokes everything on clear and drops downloads that finish afterwards', async () => {
    const revoked = []
    let release
    const gate = new Promise((r) => (release = r))
    const cache = createPhotoCache({
      list: async () => ['a', 'b'],
      fetch: async (id) => {
        if (id === 'b') await gate
        return `blob:${id}`
      },
      decode: async () => {},
      revoke: (url) => revoked.push(url),
    })
    const pending = cache.sync({ concurrency: 2 })
    await vi.waitFor(() => expect(cache.readyIds()).toEqual(['a']))
    cache.clear()
    expect(revoked).toEqual(['blob:a'])
    release()
    expect((await pending).status).toBe('aborted')
    expect(revoked).toEqual(['blob:a', 'blob:b']) // the late download is not leaked
    expect(cache.size).toBe(0)
  })

  it('handles one and two photos', async () => {
    for (const ids of [['only'], ['x', 'y']]) {
      const { cache } = setup({ ids })
      expect((await cache.sync({ start: 7 })).status).toBe('ready')
      expect(cache.readyIds()).toEqual(ids)
    }
  })
})
