import { describe, expect, it } from 'vitest'
import { detectMediaBrand, formatTime, mediaPosition } from '../../src/lib/mediaBrand.js'
import { MEDIA_FEATURE, mediaControls, mediaSupports } from '../../src/lib/mediaFeatures.js'

describe('detectMediaBrand', () => {
  it('finds Spotify from the entity id', () => {
    expect(detectMediaBrand('media_player.spotify_me')?.id).toBe('spotify')
  })
  it('finds Apple Music and YouTube Music from attributes', () => {
    expect(detectMediaBrand('media_player.x', { app_name: 'Apple Music' })?.id).toBe('apple_music')
    expect(detectMediaBrand('media_player.x', { media_content_id: 'https://music.youtube.com/watch' })?.id).toBe(
      'youtube_music',
    )
  })
  it('does not see "cast" inside podcast', () => {
    expect(detectMediaBrand('media_player.x', { app_name: 'Podcasts' })).toBeNull()
  })
  it('returns null for unknown players', () => {
    expect(detectMediaBrand('media_player.tv', {})).toBeNull()
  })
})

describe('mediaPosition', () => {
  const at = '2026-11-07T10:00:00Z'
  const t0 = new Date(at).getTime()
  it('is null without a position', () => {
    expect(mediaPosition({ state: 'playing', attributes: {} }, t0)).toBeNull()
    expect(mediaPosition({ state: 'playing', attributes: { media_position: null } }, t0)).toBeNull()
    expect(mediaPosition(null, t0)).toBeNull()
  })
  it('does not move while paused', () => {
    const e = { state: 'paused', attributes: { media_position: 30, media_position_updated_at: at } }
    expect(mediaPosition(e, t0 + 60_000)).toBe(30)
  })
  it('extrapolates while playing and stops at the duration', () => {
    const e = {
      state: 'playing',
      attributes: { media_position: 30, media_position_updated_at: at, media_duration: 100 },
    }
    expect(mediaPosition(e, t0 + 10_000)).toBe(40)
    expect(mediaPosition(e, t0 + 500_000)).toBe(100)
  })
  it('never goes backwards for clocks behind the server', () => {
    const e = { state: 'playing', attributes: { media_position: 30, media_position_updated_at: at } }
    expect(mediaPosition(e, t0 - 5_000)).toBe(30)
  })
  it('falls back to the reported position for a bad timestamp', () => {
    const e = { state: 'playing', attributes: { media_position: 12, media_position_updated_at: 'nope' } }
    expect(mediaPosition(e, t0)).toBe(12)
  })
})

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(187)).toBe('3:07')
    expect(formatTime(3723)).toBe('1:02:03')
  })
  it('shows a placeholder for missing values', () => {
    expect(formatTime(null)).toBe('–:––')
    expect(formatTime(NaN)).toBe('–:––')
  })
})

describe('media features', () => {
  it('uses the Home Assistant bit values', () => {
    expect(MEDIA_FEATURE).toMatchObject({ PAUSE: 1, VOLUME_SET: 4, NEXT_TRACK: 32, SELECT_SOURCE: 2048, PLAY: 16384 })
  })
  it('treats a missing bitmask as nothing (no control because it usually exists)', () => {
    expect(mediaSupports({}, MEDIA_FEATURE.PAUSE)).toBe(false)
    expect(mediaSupports({ supported_features: '1' }, MEDIA_FEATURE.PAUSE)).toBe(false)
    expect(mediaSupports({ supported_features: 0 }, MEDIA_FEATURE.PAUSE)).toBe(false)
    expect(mediaSupports({ supported_features: 1 }, MEDIA_FEATURE.PAUSE)).toBe(true)
  })
  it('hides controls the player does not support', () => {
    // a Spotify account entity while idle only reports SELECT_SOURCE
    const c = mediaControls({
      state: 'idle',
      attributes: { supported_features: 2048, source_list: ['Phone'] },
    })
    expect(c).toMatchObject({ playPause: false, next: false, previous: false, volume: false, source: true })
  })
  it('needs a non-empty source list for the output picker', () => {
    const c = mediaControls({ state: 'playing', attributes: { supported_features: 2048, source_list: [] } })
    expect(c.source).toBe(false)
  })
  it('disables everything for unavailable and unknown players', () => {
    for (const state of ['unavailable', 'unknown']) {
      const c = mediaControls({ state, attributes: { supported_features: 0xffff } })
      expect(c.available).toBe(false)
      expect(c.playPause || c.next || c.volume).toBe(false)
    }
    expect(mediaControls(null).available).toBe(false)
  })
  it('accepts PLAY or PAUSE for play/pause', () => {
    expect(mediaControls({ state: 'off', attributes: { supported_features: 16384 } }).playPause).toBe(true)
    expect(mediaControls({ state: 'off', attributes: { supported_features: 1 } }).playPause).toBe(true)
  })
})
