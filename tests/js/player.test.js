import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizeState, toEntity, fromHaEntity, capsToFeatures, dispatchCommand, ENGINE_IDS } from '../../src/lib/player/playerState.js'
import { createBrowserEngine, detectVolume, isHttpsUrl, RETRY_DELAYS_MS } from '../../src/lib/player/browserEngine.js'
import { createTokenCache, createSpotifyEngine } from '../../src/lib/player/spotifyEngine.js'
import { mediaCaps, MEDIA_FEATURE } from '../../src/lib/mediaCaps.js'

/** Minimal HTMLAudioElement: events, play() outcome under test control. */
class FakeAudio {
  constructor({ volumeWorks = true } = {}) {
    this.listeners = {}
    this.volumeWorks = volumeWorks
    this._volume = 1
    this.src = ''
    this.paused = true
    this.duration = NaN
    this.currentTime = 0
    this.muted = false
    this.nextPlay = 'ok' // ok | blocked | fail
  }
  get volume() {
    return this._volume
  }
  set volume(v) {
    if (this.volumeWorks) this._volume = v
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
  }
  emit(type) {
    for (const fn of this.listeners[type] || []) fn()
  }
  play() {
    if (this.nextPlay === 'blocked') return Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    if (this.nextPlay === 'fail') return Promise.reject(Object.assign(new Error('x'), { name: 'NotSupportedError' }))
    this.paused = false
    queueMicrotask(() => this.emit('playing'))
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.emit('pause')
  }
  removeAttribute() {
    this.src = ''
  }
  load() {}
}

const STATIONS = [
  { id: 'a', name: 'Rádio A', url: 'https://a.example.com/live' },
  { id: 'b', name: 'Rádio B', url: 'https://b.example.com/live' },
]
/** Let queued promise callbacks run (timers are fake in these tests). */
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

describe('PlayerState', () => {
  it('normalizes and clamps, unknown capabilities are off', () => {
    const s = normalizeState({ state: 'weird', volume: 3, title: 7, artwork: 'http://x/y.jpg', capabilities: { play: true, evil: true } })
    expect(s.state).toBe('idle')
    expect(s.volume).toBe(1)
    expect(s.title).toBe('')
    expect(s.artwork).toBe('')
    expect(s.capabilities).toMatchObject({ play: true, pause: false, next: false })
    expect('evil' in s.capabilities).toBe(false)
  })

  it('maps capabilities to the media_player feature bits the UI gates on', () => {
    const entity = toEntity(ENGINE_IDS.browser, { state: 'playing', capabilities: { play: true, pause: true, volumeSet: false, browse: true } }, 'browser')
    const caps = mediaCaps(entity)
    expect(caps.playPause).toBe(true)
    expect(caps.volumeSet).toBe(false)
    expect(caps.next).toBe(false)
    expect(caps.browseMedia).toBe(true)
    expect(capsToFeatures({ next: true, seek: true })).toBe(MEDIA_FEATURE.NEXT_TRACK | MEDIA_FEATURE.SEEK)
  })

  it('reads a Home Assistant player (HaEngine) without changing behaviour', () => {
    const s = fromHaEntity({
      entity_id: 'media_player.tv',
      state: 'paused',
      attributes: { friendly_name: 'TV', media_title: 'Song', supported_features: MEDIA_FEATURE.PAUSE | MEDIA_FEATURE.PLAY, volume_level: 0.3 },
    })
    expect(s).toMatchObject({ name: 'TV', state: 'paused', title: 'Song', volume: 0.3 })
    expect(s.capabilities).toMatchObject({ play: true, pause: true, next: false, volumeSet: false })
    expect(fromHaEntity({ entity_id: 'x', state: 'unavailable', attributes: {} }).state).toBe('error')
  })

  it('blocked and error show as idle to the UI but keep the real state', () => {
    const e = toEntity('media_player.dash_radio', { state: 'blocked' }, 'browser')
    expect(e.state).toBe('idle')
    expect(e.attributes.dash_state).toBe('blocked')
  })
})

describe('BrowserEngine', () => {
  let audio
  let engine
  beforeEach(() => {
    vi.useFakeTimers()
    audio = new FakeAudio()
    engine = createBrowserEngine({ name: 'Rádio', stations: () => STATIONS, audio: () => audio })
  })
  afterEach(() => vi.useRealTimers())

  it('plays a station, pauses at once, stops', async () => {
    await engine.playItem({ media_content_id: 'dash-radio:b' })
    await vi.runAllTicks()
    await Promise.resolve()
    expect(audio.src).toBe('https://b.example.com/live')
    expect(engine.state.state).toBe('playing')
    expect(engine.state.title).toBe('Rádio B')
    engine.pause()
    expect(engine.state.state).toBe('paused')
    engine.stop()
    expect(engine.state.state).toBe('idle')
    expect(audio.src).toBe('')
  })

  it('a stream has no next, previous or seek', () => {
    expect(engine.state.capabilities).toMatchObject({ next: false, previous: false, seek: false, play: true })
  })

  it('retries a failing stream with growing delays, then reports it', async () => {
    await engine.playItem({ media_content_id: 'dash-radio:a' })
    for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
      audio.emit('error')
      expect(engine.state.state).toBe('buffering')
      vi.advanceTimersByTime(RETRY_DELAYS_MS[i])
    }
    audio.emit('error')
    expect(engine.state.state).toBe('error')
    expect(engine.state.error).toBe('stream_unavailable')
  })

  it('autoplay refusal becomes "blocked" until a tap', async () => {
    audio.nextPlay = 'blocked'
    await engine.playItem({ media_content_id: 'dash-radio:a' })
    expect(engine.state.state).toBe('blocked')
    audio.nextPlay = 'ok'
    await engine.unlock()
    await flush()
    expect(engine.state.state).toBe('playing')
  })

  it('offers volume only when the browser applies it (iOS ignores it)', () => {
    expect(detectVolume(new FakeAudio())).toBe(true)
    const ios = new FakeAudio({ volumeWorks: false })
    expect(detectVolume(ios)).toBe(false)
    const e = createBrowserEngine({ stations: () => STATIONS, audio: () => ios })
    expect(e.state.capabilities.volumeSet).toBe(false)
    expect(mediaCaps(toEntity('x', e.state, 'browser')).volumeSet).toBe(false)
  })

  it('accepts only https stream addresses', async () => {
    expect(isHttpsUrl('https://s.example.com/a')).toBe(true)
    for (const bad of ['http://s.example.com/a', 'https://u:p@s.example.com/', 'javascript:alert(1)', 'nope']) {
      expect(isHttpsUrl(bad)).toBe(false)
    }
    await expect(engine.playUrl('http://s.example.com/a')).rejects.toThrow('https_only')
  })

  it('lists stations and, when enabled, the HA media folder', async () => {
    const lib = { enabled: () => true, browse: vi.fn(async () => ({ children: [{ title: 'x', thumbnail: '/api/x?token=1' }] })), resolve: vi.fn() }
    const e = createBrowserEngine({ stations: () => STATIONS, audio: () => new FakeAudio(), library: lib })
    const root = await e.browse()
    expect(root.children.map((c) => c.media_content_id)).toEqual(['dash-radio:a', 'dash-radio:b', 'media-source://'])
    const folder = await e.browse('directory', 'media-source://')
    expect(lib.browse).toHaveBeenCalledWith('')
    expect(folder.children[0].thumbnail).toBeUndefined()
  })

  it('maps UI commands', async () => {
    await dispatchCommand(engine, 'media_play')
    await flush()
    expect(engine.state.title).toBe('Rádio A')
    await dispatchCommand(engine, 'media_play_pause')
    expect(engine.state.state).toBe('paused')
    expect(await dispatchCommand(engine, 'join')).toBe(false)
  })
})

describe('Spotify token cache', () => {
  it('fetches once, reuses, refreshes a minute before expiry', async () => {
    let now = 0
    const fetchToken = vi.fn(async () => ({ access_token: `t${fetchToken.mock.calls.length}`, expires_in: 3600 }))
    const get = createTokenCache(fetchToken, () => now)
    expect(await Promise.all([get(), get()])).toEqual(['t1', 't1'])
    expect(fetchToken).toHaveBeenCalledTimes(1)
    now = 3600_000 - 61_000
    expect(await get()).toBe('t1')
    now = 3600_000 - 59_000
    expect(await get()).toBe('t2')
  })

  it('rejects a response without a token', async () => {
    const get = createTokenCache(async () => ({ expires_in: 10 }))
    await expect(get()).rejects.toThrow('no_token')
  })
})

describe('SpotifyEngine', () => {
  it('turns API state into PlayerState and sends controls', async () => {
    const api = {
      state: vi.fn(async () => ({ is_playing: true, progress_ms: 5000, device: { name: 'Obývák', volume_percent: 40 }, item: { name: 'Song', artists: ['A', 'B'], duration_ms: 200000 } })),
      control: vi.fn(async () => {}),
      search: vi.fn(async () => [{ uri: 'spotify:track:x', name: 'Found', artists: ['A'], kind: 'track' }]),
      browse: vi.fn(async () => []),
    }
    const e = createSpotifyEngine({ api, timers: { setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {} } })
    await e.refresh()
    expect(e.state).toMatchObject({ state: 'playing', title: 'Song', artist: 'A, B', volume: 0.4, position: 5, duration: 200 })
    await e.setVolume(0.55)
    expect(api.control).toHaveBeenCalledWith('volume', { value: 55 })
    const found = await e.search('fo')
    expect(found.result[0]).toMatchObject({ media_content_id: 'spotify:track:x', can_play: true })
    expect(await e.playItem({ media_content_id: 'https://evil.example/' })).toBe(false)
  })
})
