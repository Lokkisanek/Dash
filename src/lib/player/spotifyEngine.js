import { reactive } from 'vue'
import { emptyState, claimAudio, releaseAudio } from './playerState'

/**
 * SpotifyEngine (opt-in, docs/SPOTIFY.md): Spotify Connect through the
 * integration. The browser never holds a refresh token; the owner's browser
 * may ask for a short-lived access token only to run the Web Playback SDK.
 * Guests use the same calls through their guest socket (spotify_state,
 * spotify_control, spotify_search) and never see a token.
 *
 * `api` is { state(), control(action, args), search(q), browse(kind),
 * devices?(), token?() } (useHomeAssistant wires owner, guest or mock).
 */
export const POLL_MS = 5000
export const SDK_URL = 'https://sdk.scdn.co/spotify-player.js'
const PREFIX = 'spotify:'

/** Access-token cache for the SDK: refreshed through the owner channel a minute before it ends. */
export function createTokenCache(fetchToken, now = () => Date.now()) {
  let token = ''
  let until = 0
  let inflight = null
  return async function get() {
    if (token && until - now() > 60_000) return token
    if (!inflight) {
      inflight = fetchToken()
        .then((res) => {
          if (!res?.access_token || !Number.isFinite(res.expires_in)) throw new Error('no_token')
          token = res.access_token
          until = now() + res.expires_in * 1000
          return token
        })
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }
}

function toBrowse(items) {
  return (items || []).map((i) => ({
    title: [i.name, i.artists?.join(', ')].filter(Boolean).join(' – '),
    media_class: i.kind === 'playlist' ? 'playlist' : i.kind === 'album' ? 'album' : 'track',
    media_content_type: 'spotify',
    media_content_id: i.uri,
    can_play: true,
    can_expand: false,
  }))
}

export function createSpotifyEngine(o) {
  const state = reactive(emptyState(o.name || 'Spotify'))
  const labels = { playlists: 'Moje playlisty', saved: 'Uložené skladby', ...(o.labels || {}) }
  const timers = o.timers || globalThis
  let pollTimer = 0
  let users = 0
  let sdk = null

  state.capabilities = {
    play: true,
    pause: true,
    stop: false,
    next: true,
    previous: true,
    seek: true,
    volumeSet: true,
    browse: o.canBrowse !== false,
    search: o.canSearch !== false,
    playItem: true,
  }

  async function refresh() {
    try {
      const s = await o.api.state()
      const item = s?.item
      state.state = s?.is_playing ? 'playing' : item ? 'paused' : 'idle'
      state.title = item?.name || ''
      state.artist = (item?.artists || []).join(', ')
      state.album = item?.album || ''
      state.artwork = item?.image || ''
      state.duration = item?.duration_ms ? item.duration_ms / 1000 : null
      state.position = Number.isFinite(s?.progress_ms) ? s.progress_ms / 1000 : null
      state.positionAt = new Date().toISOString()
      state.volume = Number.isFinite(s?.device?.volume_percent) ? s.device.volume_percent / 100 : state.volume
      state.name = s?.device?.name ? `Spotify · ${s.device.name}` : o.name || 'Spotify'
      state.error = ''
    } catch (err) {
      state.state = 'error'
      state.error = err?.code || 'unavailable'
    }
  }

  async function control(action, args = {}) {
    try {
      await o.api.control(action, args)
    } catch (err) {
      state.error = err?.code || 'failed'
    }
    timers.setTimeout(refresh, 600)
  }

  const engine = {
    id: 'spotify',
    state,
    /** Poll while at least one tile or sheet shows this engine. */
    attach() {
      users += 1
      if (users === 1) {
        refresh()
        pollTimer = timers.setInterval(() => {
          if (typeof document === 'undefined' || !document.hidden) refresh()
        }, POLL_MS)
      }
      return () => {
        users -= 1
        if (users === 0) timers.clearInterval(pollTimer)
      }
    },
    refresh,
    play: () => control('play'),
    pause: () => control('pause'),
    stop: () => control('pause'),
    next: () => control('next'),
    previous: () => control('previous'),
    seek: (s) => control('seek', { value: Math.round(s * 1000) }),
    setVolume: (v) => control('volume', { value: Math.round(v * 100) }),
    playItem: (item) =>
      item?.media_content_id?.startsWith(PREFIX) ? control('play', { uri: item.media_content_id }) : false,
    async browse(_type, id) {
      if (id === 'spotify:playlists' || id === 'spotify:saved') {
        const items = await o.api.browse(id === 'spotify:playlists' ? 'playlists' : 'saved')
        return { title: id === 'spotify:playlists' ? labels.playlists : labels.saved, children: toBrowse(items) }
      }
      return {
        title: 'Spotify',
        children: [
          { title: labels.playlists, media_class: 'directory', media_content_type: 'spotify', media_content_id: 'spotify:playlists', can_expand: true, can_play: false },
          { title: labels.saved, media_class: 'directory', media_content_type: 'spotify', media_content_id: 'spotify:saved', can_expand: true, can_play: false },
        ],
      }
    },
    async search(query) {
      const items = await o.api.search(query)
      return { result: toBrowse(items) }
    },
    devices: () => (o.api.devices ? o.api.devices() : Promise.resolve([])),
    transfer: (deviceId) => control('transfer', { device_id: deviceId, value: true }),
    /**
     * Owner only (spotify.webPlayer): load the Web Playback SDK on a tap
     * ("Spustit přehrávání zde") and move playback to this browser.
     */
    async playHere(deviceName) {
      if (!o.api.token) throw new Error('not_allowed')
      if (sdk) {
        await sdk.player.activateElement?.()
        return engine.transfer(sdk.deviceId)
      }
      const getToken = createTokenCache(o.api.token)
      await new Promise((resolve, reject) => {
        window.onSpotifyWebPlaybackSDKReady = resolve
        const script = document.createElement('script')
        script.src = SDK_URL
        script.async = true
        script.onerror = () => reject(new Error('sdk_load_failed'))
        document.head.appendChild(script)
      })
      const player = new window.Spotify.Player({
        name: `Dash – ${deviceName}`,
        getOAuthToken: (cb) => getToken().then(cb, () => cb('')),
        volume: 0.6,
      })
      const deviceId = await new Promise((resolve, reject) => {
        player.addListener('ready', ({ device_id: id }) => resolve(id))
        player.addListener('initialization_error', ({ message }) => reject(new Error(message)))
        player.addListener('authentication_error', () => reject(new Error('auth_failed')))
        player.addListener('account_error', () => reject(new Error('premium_required')))
        player.connect()
      })
      // iOS: the tap that called playHere is the gesture the SDK needs
      await player.activateElement?.()
      sdk = { player, deviceId }
      player.addListener('player_state_changed', (s) => {
        if (s && !s.paused) claimAudio(engine)
        else releaseAudio(engine)
        refresh()
      })
      return engine.transfer(deviceId)
    },
    destroy() {
      timers.clearInterval(pollTimer)
      sdk?.player.disconnect?.()
    },
  }
  return engine
}
