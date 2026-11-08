import { reactive } from 'vue'
import { emptyState, claimAudio, releaseAudio } from './playerState'

/**
 * BrowserEngine: sound from this browser, no account.
 *   - the owner's radio stations (config `radio.stations`, https only)
 *   - files from Home Assistant's media folder (signed URLs, `radio.mediaLibrary`)
 *   - a direct https URL
 * One audio element for the whole page. Streams have no next/previous/seek;
 * files with a duration can seek. Volume is offered only when the browser
 * really applies it (iOS Safari ignores programmatic volume, so it is
 * detected, never assumed). Stalls and errors retry with a bounded backoff,
 * then show "Stream nedostupný". When the browser blocks autoplay the state
 * is `blocked` and the UI shows "Klepnutím povolíš zvuk".
 */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]
export const STATION_PREFIX = 'dash-radio:'
export const URL_PREFIX = 'dash-url:'

let sharedAudio = null
function defaultAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio()
    sharedAudio.preload = 'none'
  }
  return sharedAudio
}

/** Set and read back: true only if the element applies programmatic volume. */
export function detectVolume(audio) {
  try {
    const before = audio.volume
    audio.volume = before > 0.5 ? 0.25 : 0.75
    const ok = Math.abs(audio.volume - (before > 0.5 ? 0.25 : 0.75)) < 0.01
    audio.volume = before
    return ok
  } catch {
    return false
  }
}

export function isHttpsUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}

/**
 * @param {object} o
 * @param {string} o.name             display name ("Rádio")
 * @param {() => Array<{id,name,url}>} o.stations
 * @param {{enabled: () => boolean, browse: (id) => Promise<object>, resolve: (id) => Promise<{url}>}} [o.library]
 * @param {() => HTMLAudioElement} [o.audio]
 * @param {{ setTimeout, clearTimeout }} [o.timers]
 * @param {object} [o.labels]         { stations, library }
 */
export function createBrowserEngine(o) {
  const audio = (o.audio || defaultAudio)()
  const timers = o.timers || globalThis
  const delays = o.retryDelays || RETRY_DELAYS_MS
  const labels = { stations: 'Rádio', library: 'Média Home Assistantu', ...(o.labels || {}) }
  const state = reactive(emptyState(o.name || 'Rádio'))
  const canVolume = detectVolume(audio)
  let current = null // { kind: 'station'|'file'|'url', name, url, id }
  let retry = 0
  let retryTimer = 0
  let stopped = true

  function caps() {
    const file = current?.kind === 'file' && Number.isFinite(audio.duration) && audio.duration > 0
    state.capabilities = {
      play: true,
      pause: true,
      stop: true,
      next: false,
      previous: false,
      seek: file,
      volumeSet: canVolume,
      browse: true,
      search: false,
      playItem: true,
    }
  }
  caps()
  state.volume = canVolume ? audio.volume : null

  function mediaSession() {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null
    if (!ms || typeof MediaMetadata === 'undefined') return
    try {
      ms.metadata = new MediaMetadata({ title: current?.name || '', artist: labels.stations })
      ms.setActionHandler('play', () => engine.play())
      ms.setActionHandler('pause', () => engine.pause())
      ms.setActionHandler('stop', () => engine.stop())
    } catch {
      /* some actions are not supported: keep what worked */
    }
  }

  function clearRetry() {
    if (retryTimer) timers.clearTimeout(retryTimer)
    retryTimer = 0
  }

  function fail() {
    if (stopped || !current) return
    clearRetry()
    if (retry >= delays.length) {
      state.state = 'error'
      state.error = 'stream_unavailable'
      releaseAudio(engine)
      return
    }
    state.state = 'buffering'
    const delay = delays[retry]
    retry += 1
    retryTimer = timers.setTimeout(() => {
      retryTimer = 0
      if (stopped || !current) return
      audio.src = current.url
      start()
    }, delay)
  }

  function start() {
    let p
    try {
      p = audio.play()
    } catch (err) {
      p = Promise.reject(err)
    }
    return Promise.resolve(p).then(
      () => {
        claimAudio(engine)
      },
      (err) => {
        if (err?.name === 'NotAllowedError') {
          state.state = 'blocked'
          return
        }
        if (err?.name !== 'AbortError') fail()
      },
    )
  }

  const on = (type, fn) => audio.addEventListener?.(type, fn)
  on('playing', () => {
    if (stopped) return
    retry = 0
    state.state = 'playing'
    state.error = ''
    caps()
  })
  on('pause', () => {
    if (!stopped && state.state !== 'error' && state.state !== 'buffering') state.state = 'paused'
  })
  on('waiting', () => {
    if (!stopped) state.state = 'buffering'
  })
  on('error', fail)
  on('stalled', () => {
    if (!stopped && state.state === 'buffering') fail()
  })
  on('ended', () => {
    if (current?.kind === 'station') fail()
    else {
      state.state = 'idle'
      releaseAudio(engine)
    }
  })
  on('timeupdate', () => {
    if (current?.kind === 'file') {
      state.position = audio.currentTime
      state.positionAt = new Date().toISOString()
    }
  })
  on('durationchange', () => {
    state.duration = Number.isFinite(audio.duration) ? audio.duration : null
    caps()
  })
  on('volumechange', () => {
    if (canVolume) state.volume = audio.volume
    state.muted = audio.muted
  })

  function load(item) {
    clearRetry()
    retry = 0
    stopped = false
    current = item
    state.title = item.name
    state.artist = item.kind === 'station' ? labels.stations : ''
    state.album = ''
    state.position = null
    state.duration = null
    state.error = ''
    state.state = 'buffering'
    audio.src = item.url
    mediaSession()
    caps()
    return start()
  }

  const engine = {
    id: 'browser',
    state,
    async play() {
      if (current && !stopped && state.state !== 'error') {
        state.state = 'buffering'
        return start()
      }
      if (current) return load(current)
      const first = o.stations()[0]
      if (first) return load({ kind: 'station', id: first.id, name: first.name, url: first.url })
      return false
    },
    pause() {
      clearRetry()
      audio.pause()
      if (!stopped) state.state = 'paused'
      releaseAudio(engine)
    },
    stop() {
      clearRetry()
      stopped = true
      audio.pause()
      audio.removeAttribute?.('src')
      audio.load?.()
      state.state = 'idle'
      state.position = null
      releaseAudio(engine)
    },
    setVolume(v) {
      if (!canVolume || !Number.isFinite(v)) return
      audio.volume = Math.min(1, Math.max(0, v))
      state.volume = audio.volume
    },
    seek(seconds) {
      if (!state.capabilities.seek || !Number.isFinite(seconds)) return
      audio.currentTime = Math.max(0, seconds)
    },
    /** A tap after "Klepnutím povolíš zvuk": the gesture lets the browser start audio. */
    unlock() {
      if (state.state === 'blocked') {
        state.state = 'buffering'
        return start()
      }
      return engine.play()
    },
    async playUrl(url, name = '') {
      if (!isHttpsUrl(url)) throw new Error('https_only')
      return load({ kind: 'url', id: url, name: name || new URL(url).hostname, url })
    },
    async playItem(item) {
      const id = item?.media_content_id || ''
      if (id.startsWith(STATION_PREFIX)) {
        const st = o.stations().find((s) => s.id === id.slice(STATION_PREFIX.length))
        if (!st) return false
        return load({ kind: 'station', id: st.id, name: st.name, url: st.url })
      }
      if (id.startsWith('media-source://') && o.library?.enabled()) {
        const res = await o.library.resolve(id)
        if (!res?.url) throw new Error('not_playable')
        return load({ kind: 'file', id, name: item.title || id.split('/').pop(), url: res.url })
      }
      return false
    },
    /** BrowseMedia-shaped results, so the sheet's browse tab works unchanged. */
    async browse(_type, id) {
      if (id && id.startsWith('media-source://') && o.library?.enabled()) {
        const res = await o.library.browse(id === 'media-source://' ? '' : id)
        return {
          ...res,
          children: (res?.children || []).map((c) => ({ ...c, thumbnail: undefined })),
        }
      }
      const children = o.stations().map((s) => ({
        title: s.name,
        media_class: 'channel',
        media_content_type: 'music',
        media_content_id: `${STATION_PREFIX}${s.id}`,
        can_play: true,
        can_expand: false,
      }))
      if (o.library?.enabled()) {
        children.push({
          title: labels.library,
          media_class: 'directory',
          media_content_type: 'directory',
          media_content_id: 'media-source://',
          can_play: false,
          can_expand: true,
        })
      }
      return { title: labels.stations, media_class: 'directory', children }
    },
    current: () => current,
    destroy() {
      engine.stop()
    },
  }
  return engine
}
