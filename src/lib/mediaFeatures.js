/**
 * media_player supported_features bits, copied from
 * homeassistant/components/media_player/const.py (MediaPlayerEntityFeature)
 * and checked against the installed Home Assistant 2026.10 source.
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
  PLAY: 16384,
})

/** States in which the player cannot take commands at all. */
const DEAD_STATES = new Set(['unavailable', 'unknown'])

/**
 * Does the entity support `feature`? A missing supported_features attribute
 * (older integrations, demo data) is treated as "everything", so nothing is
 * hidden that used to work; 0 means "nothing".
 */
export function mediaSupports(attrs, feature) {
  const raw = attrs?.supported_features
  if (raw === undefined || raw === null || raw === '') return true
  const bits = Number(raw)
  if (!Number.isFinite(bits)) return true
  return (bits & feature) !== 0
}

/**
 * Which controls a media tile may show. Mirrors the service registrations in
 * homeassistant/components/media_player/services.py:
 *   media_play_pause  needs PLAY or PAUSE
 *   media_next_track  needs NEXT_TRACK, media_previous_track PREVIOUS_TRACK
 *   volume_set        needs VOLUME_SET, select_source SELECT_SOURCE
 */
export function mediaControls(entity) {
  const attrs = entity?.attributes || {}
  const state = entity?.state
  const available = Boolean(entity) && !DEAD_STATES.has(state)
  const has = (f) => available && mediaSupports(attrs, f)
  const sources = Array.isArray(attrs.source_list) ? attrs.source_list.filter(Boolean) : []
  return {
    available,
    playPause: has(MEDIA_FEATURE.PLAY) || has(MEDIA_FEATURE.PAUSE),
    next: has(MEDIA_FEATURE.NEXT_TRACK),
    previous: has(MEDIA_FEATURE.PREVIOUS_TRACK),
    volume: has(MEDIA_FEATURE.VOLUME_SET),
    source: has(MEDIA_FEATURE.SELECT_SOURCE) && sources.length > 0,
    sources,
  }
}
