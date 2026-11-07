import { describe, expect, it } from 'vitest'
import { MEDIA_FEATURE, mediaCaps, mediaPhase, mediaVolume } from '../../src/lib/mediaCaps.js'

// The table itself is compared with the installed homeassistant package by
// tests/pure/test_device_classes.py (Python can import MediaPlayerEntityFeature).
const player = (state, features, attrs = {}) => ({ state, attributes: { supported_features: features, ...attrs } })

describe('mediaCaps', () => {
  it('has the 22 MediaPlayerEntityFeature bits of HA 2026.10.4', () => {
    expect(Object.keys(MEDIA_FEATURE)).toHaveLength(22)
    expect(MEDIA_FEATURE).toMatchObject({ BROWSE_MEDIA: 131072, GROUPING: 524288, MEDIA_ENQUEUE: 2097152, SEARCH_MEDIA: 4194304 })
  })

  it('every capability comes from its bit, nothing because it usually exists', () => {
    for (const [key, bit] of [
      ['pause', 'PAUSE'], ['play', 'PLAY'], ['stop', 'STOP'], ['seek', 'SEEK'], ['volumeSet', 'VOLUME_SET'],
      ['volumeMute', 'VOLUME_MUTE'], ['prev', 'PREVIOUS_TRACK'], ['next', 'NEXT_TRACK'], ['turnOn', 'TURN_ON'],
      ['turnOff', 'TURN_OFF'], ['playMedia', 'PLAY_MEDIA'], ['browseMedia', 'BROWSE_MEDIA'], ['searchMedia', 'SEARCH_MEDIA'],
      ['grouping', 'GROUPING'], ['enqueue', 'MEDIA_ENQUEUE'], ['shuffleSet', 'SHUFFLE_SET'], ['repeatSet', 'REPEAT_SET'],
    ]) {
      expect(mediaCaps(player('idle', MEDIA_FEATURE[bit]))[key]).toBe(true)
      expect(mediaCaps(player('idle', 0x7fffff & ~MEDIA_FEATURE[bit]))[key]).toBe(false)
    }
    expect(mediaCaps({ state: 'playing', attributes: {} }).playPause).toBe(false)
  })

  it('select_source needs a non-empty source list', () => {
    expect(mediaCaps(player('idle', 2048, { source_list: [] })).selectSource).toBe(false)
    expect(mediaCaps(player('idle', 2048, { source_list: ['A'] })).selectSource).toBe(true)
  })

  it('phases', () => {
    expect(mediaPhase(null)).toBe('unavailable')
    expect(mediaPhase({ state: 'unknown' })).toBe('unavailable')
    expect(mediaPhase({ state: 'off' })).toBe('off')
    expect(mediaPhase({ state: 'standby' })).toBe('idle')
    expect(mediaPhase({ state: 'on' })).toBe('idle')
    expect(mediaPhase({ state: 'buffering' })).toBe('buffering')
    expect(mediaCaps(player('unavailable', 0x7fffff)).playPause).toBe(false)
  })

  it('volume is clamped to 0–1', () => {
    expect(mediaVolume(player('idle', 4, { volume_level: 1.4 }))).toBe(1)
    expect(mediaVolume(player('idle', 4, { volume_level: 'x' }))).toBe(0)
    expect(mediaVolume(player('idle', 4, { volume_level: 0.35 }))).toBe(0.35)
  })
})
