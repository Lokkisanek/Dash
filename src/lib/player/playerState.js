/**
 * Player engines (docs/PLAYER_ENGINES.md): one normalized PlayerState for
 *   HaEngine       a Home Assistant media_player (fromHaEntity)
 *   BrowserEngine  this browser: radio stations, HA media files (browserEngine.js)
 *   SpotifyEngine  Spotify Connect through the integration (spotifyEngine.js)
 *
 * The UI (MediaStage, MediaTile, PlayerSheet) reads players as media_player
 * entities through mediaCaps.js, so dash's own engines are shown as virtual
 * entities (toEntity) and every style works with every engine.
 */
import { MEDIA_FEATURE, mediaCaps, mediaPhase, mediaVolume } from '@/lib/mediaCaps'

export const ENGINE_IDS = Object.freeze({
  browser: 'media_player.dash_radio',
  spotify: 'media_player.dash_spotify',
})

/** state: off | idle | buffering | playing | paused | blocked (autoplay) | error */
export const PLAYER_STATES = ['off', 'idle', 'buffering', 'playing', 'paused', 'blocked', 'error']

export const NO_CAPS = Object.freeze({
  play: false,
  pause: false,
  stop: false,
  next: false,
  previous: false,
  seek: false,
  volumeSet: false,
  browse: false,
  search: false,
  playItem: false,
})

export function emptyState(name = '') {
  return {
    name,
    state: 'idle',
    title: '',
    artist: '',
    album: '',
    artwork: '',
    position: null,
    positionAt: null,
    duration: null,
    volume: null,
    muted: false,
    capabilities: { ...NO_CAPS },
    error: '',
  }
}

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null)
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Clamp and type a raw state; unknown fields are dropped, capabilities default to false. */
export function normalizeState(raw = {}) {
  const base = emptyState(str(raw.name, 80))
  const caps = {}
  for (const key of Object.keys(NO_CAPS)) caps[key] = raw.capabilities?.[key] === true
  return {
    ...base,
    state: PLAYER_STATES.includes(raw.state) ? raw.state : 'idle',
    title: str(raw.title),
    artist: str(raw.artist),
    album: str(raw.album),
    artwork: typeof raw.artwork === 'string' && /^(https:|blob:|data:image\/)/.test(raw.artwork) ? raw.artwork : '',
    position: num(raw.position, 0, 1e7),
    positionAt: typeof raw.positionAt === 'string' ? raw.positionAt : null,
    duration: num(raw.duration, 0, 1e7),
    volume: num(raw.volume, 0, 1),
    muted: raw.muted === true,
    capabilities: caps,
    error: str(raw.error, 80),
  }
}

/** Capabilities -> MediaPlayerEntityFeature bits (only what the engine can really do). */
export function capsToFeatures(caps) {
  let bits = 0
  if (caps.play) bits |= MEDIA_FEATURE.PLAY
  if (caps.pause) bits |= MEDIA_FEATURE.PAUSE
  if (caps.stop) bits |= MEDIA_FEATURE.STOP
  if (caps.next) bits |= MEDIA_FEATURE.NEXT_TRACK
  if (caps.previous) bits |= MEDIA_FEATURE.PREVIOUS_TRACK
  if (caps.seek) bits |= MEDIA_FEATURE.SEEK
  if (caps.volumeSet) bits |= MEDIA_FEATURE.VOLUME_SET
  if (caps.browse) bits |= MEDIA_FEATURE.BROWSE_MEDIA
  if (caps.search) bits |= MEDIA_FEATURE.SEARCH_MEDIA
  if (caps.playItem) bits |= MEDIA_FEATURE.PLAY_MEDIA
  return bits
}

/** A PlayerState as a media_player entity for the existing UI. */
export function toEntity(entityId, raw, engine) {
  const s = normalizeState(raw)
  const state = s.state === 'blocked' || s.state === 'error' ? 'idle' : s.state
  return {
    entity_id: entityId,
    state,
    attributes: {
      friendly_name: s.name,
      supported_features: capsToFeatures(s.capabilities),
      media_title: s.title || undefined,
      media_artist: s.artist || undefined,
      media_album_name: s.album || undefined,
      entity_picture: s.artwork || undefined,
      volume_level: s.volume ?? undefined,
      is_volume_muted: s.muted,
      media_duration: s.duration ?? undefined,
      media_position: s.position ?? undefined,
      media_position_updated_at: s.positionAt ?? undefined,
      dash_engine: engine,
      dash_state: s.state,
      dash_error: s.error || undefined,
    },
  }
}

/** HaEngine: a Home Assistant media_player entity as a PlayerState. */
export function fromHaEntity(entity) {
  const caps = mediaCaps(entity)
  const phase = mediaPhase(entity)
  const a = entity?.attributes || {}
  return normalizeState({
    name: a.friendly_name || entity?.entity_id || '',
    state: phase === 'unavailable' ? 'error' : phase,
    title: a.media_title,
    artist: a.media_artist,
    album: a.media_album_name,
    artwork: '',
    position: a.media_position,
    positionAt: a.media_position_updated_at,
    duration: a.media_duration,
    volume: entity ? mediaVolume(entity) : null,
    muted: a.is_volume_muted === true,
    error: phase === 'unavailable' ? 'unavailable' : '',
    capabilities: {
      play: caps.play,
      pause: caps.pause,
      stop: caps.stop,
      next: caps.next,
      previous: caps.prev,
      seek: caps.seek,
      volumeSet: caps.volumeSet,
      browse: caps.browseMedia,
      search: caps.searchMedia,
      playItem: caps.playMedia,
    },
  })
}

/** Services the UI sends (media_player.*) -> engine methods. Returns false when unknown. */
export async function dispatchCommand(engine, service, data = {}) {
  switch (service) {
    case 'media_play':
      return engine.play()
    case 'media_pause':
      return engine.pause()
    case 'media_play_pause':
      return engine.state.state === 'playing' || engine.state.state === 'buffering' ? engine.pause() : engine.play()
    case 'media_stop':
    case 'turn_off':
      return engine.stop()
    case 'turn_on':
      return engine.play()
    case 'media_next_track':
      return engine.next?.()
    case 'media_previous_track':
      return engine.previous?.()
    case 'media_seek':
      return engine.seek?.(Number(data.seek_position))
    case 'volume_set':
      return engine.setVolume?.(Number(data.volume_level))
    case 'play_media':
      return engine.playItem?.({ media_content_id: data.media_content_id, media_content_type: data.media_content_type })
    default:
      return false
  }
}

/** Only one engine makes sound in this browser at a time. */
const playing = new Set()
export function claimAudio(engine) {
  for (const other of playing) if (other !== engine) other.pause?.()
  playing.clear()
  playing.add(engine)
}
export function releaseAudio(engine) {
  playing.delete(engine)
}
