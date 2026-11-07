/**
 * Media tile controls, built on mediaCaps.js (the full MediaPlayerEntityFeature
 * table of the installed Home Assistant). Since stage 3 a missing
 * supported_features attribute means "nothing": no control is shown because it
 * usually exists.
 */
import { MEDIA_FEATURE, mediaCaps } from './mediaCaps.js'

export { MEDIA_FEATURE }

/** Does the entity's supported_features include `feature`? Missing = no. */
export function mediaSupports(attrs, feature) {
  const bits = attrs?.supported_features
  return Number.isInteger(bits) && (bits & feature) !== 0
}

/** Which controls a media tile may show (see mediaCaps for the service ↔ bit map). */
export function mediaControls(entity) {
  const c = mediaCaps(entity)
  return {
    available: c.phase !== 'unavailable',
    phase: c.phase,
    playPause: c.playPause,
    next: c.next,
    previous: c.prev,
    volume: c.volumeSet,
    source: c.selectSource,
    sources: c.sources,
    turnOn: c.turnOn,
    turnOff: c.turnOff,
  }
}
