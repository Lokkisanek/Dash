/**
 * What a media_player can do, from `supported_features`.
 *
 * MediaPlayerEntityFeature as read from the installed homeassistant package
 * 2026.10.4 (homeassistant/components/media_player/const.py).
 * tests/pure/test_device_classes.py compares this table with the installed enum.
 * Services and the bits they need (media_player/services.py of the same version):
 *   media_play PLAY, media_pause PAUSE, media_play_pause PLAY or PAUSE,
 *   media_stop STOP, media_next_track NEXT_TRACK, media_previous_track
 *   PREVIOUS_TRACK, media_seek SEEK, volume_set VOLUME_SET, volume_mute
 *   VOLUME_MUTE, volume_up/down VOLUME_SET or VOLUME_STEP, select_source
 *   SELECT_SOURCE, select_sound_mode SELECT_SOUND_MODE, shuffle_set SHUFFLE_SET,
 *   repeat_set REPEAT_SET, turn_on TURN_ON, turn_off TURN_OFF, play_media
 *   PLAY_MEDIA, join/unjoin GROUPING; websocket media_player/browse_media needs
 *   BROWSE_MEDIA and media_player/search_media SEARCH_MEDIA.
 */
export const MEDIA_FEATURE = Object.freeze({
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  PLAY_MEDIA: 512,
  VOLUME_STEP: 1024,
  SELECT_SOURCE: 2048,
  STOP: 4096,
  CLEAR_PLAYLIST: 8192,
  PLAY: 16384,
  SHUFFLE_SET: 32768,
  SELECT_SOUND_MODE: 65536,
  BROWSE_MEDIA: 131072,
  REPEAT_SET: 262144,
  GROUPING: 524288,
  MEDIA_ANNOUNCE: 1048576,
  MEDIA_ENQUEUE: 2097152,
  SEARCH_MEDIA: 4194304,
})

/** MediaPlayerEnqueue values (same file): add to the end, play next, play now, replace the queue. */
export const MEDIA_ENQUEUE = Object.freeze({ ADD: 'add', NEXT: 'next', PLAY: 'play', REPLACE: 'replace' })

/**
 * Display state: unavailable (greyed, "Nedostupné"), off (power button only),
 * idle (no progress, no fake position), buffering (spinner), playing, paused.
 */
export function mediaPhase(entity) {
  const s = entity?.state
  if (!entity || s === 'unavailable' || s === 'unknown') return 'unavailable'
  if (s === 'off') return 'off'
  if (s === 'buffering') return 'buffering'
  if (s === 'playing' || s === 'paused') return s
  return 'idle' // idle, standby, on
}

/** Booleans per capability; a missing or broken supported_features means nothing. */
export function mediaCaps(entity) {
  const raw = entity?.attributes?.supported_features
  const bits = Number.isInteger(raw) ? raw : 0
  const phase = mediaPhase(entity)
  const live = phase !== 'unavailable'
  const has = (f) => live && (bits & f) !== 0
  const sources = Array.isArray(entity?.attributes?.source_list)
    ? entity.attributes.source_list.filter((s) => typeof s === 'string' && s)
    : []
  return {
    phase,
    pause: has(MEDIA_FEATURE.PAUSE),
    play: has(MEDIA_FEATURE.PLAY),
    playPause: has(MEDIA_FEATURE.PLAY) || has(MEDIA_FEATURE.PAUSE),
    stop: has(MEDIA_FEATURE.STOP),
    seek: has(MEDIA_FEATURE.SEEK),
    volumeSet: has(MEDIA_FEATURE.VOLUME_SET),
    volumeStep: has(MEDIA_FEATURE.VOLUME_STEP),
    volumeMute: has(MEDIA_FEATURE.VOLUME_MUTE),
    prev: has(MEDIA_FEATURE.PREVIOUS_TRACK),
    next: has(MEDIA_FEATURE.NEXT_TRACK),
    shuffleSet: has(MEDIA_FEATURE.SHUFFLE_SET),
    repeatSet: has(MEDIA_FEATURE.REPEAT_SET),
    selectSource: has(MEDIA_FEATURE.SELECT_SOURCE) && sources.length > 0,
    selectSoundMode: has(MEDIA_FEATURE.SELECT_SOUND_MODE),
    turnOn: has(MEDIA_FEATURE.TURN_ON),
    turnOff: has(MEDIA_FEATURE.TURN_OFF),
    playMedia: has(MEDIA_FEATURE.PLAY_MEDIA),
    browseMedia: has(MEDIA_FEATURE.BROWSE_MEDIA),
    searchMedia: has(MEDIA_FEATURE.SEARCH_MEDIA),
    grouping: has(MEDIA_FEATURE.GROUPING),
    enqueue: has(MEDIA_FEATURE.MEDIA_ENQUEUE),
    announce: has(MEDIA_FEATURE.MEDIA_ANNOUNCE),
    sources,
  }
}

/** Volume as 0–1 from HA's volume_level, clamped (some players report > 1 or strings). */
export function mediaVolume(entity) {
  const v = Number(entity?.attributes?.volume_level)
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}
