/**
 * Recognise the music service behind a media_player entity.
 * Spotify comes from the official HA Spotify integration (source_list = Spotify
 * Connect devices: phones, TVs, speakers). Apple Music and YouTube Music usually
 * arrive through Music Assistant; Chromecast through the Cast integration.
 */
const BRANDS = [
  { id: 'spotify', name: 'Spotify', color: '#1DB954', test: /spotify/ },
  { id: 'apple_music', name: 'Apple Music', color: '#FA2D48', test: /apple[ _-]?music|music\.apple|itunes/ },
  { id: 'youtube_music', name: 'YouTube Music', color: '#FF0033', test: /youtube[ _-]?music|music\.youtube|ytmusic/ },
  { id: 'cast', name: 'Chromecast', color: '#4285F4', test: /chromecast|google cast|\bcast\b/ },
]

export function detectMediaBrand(entityId, attrs = {}) {
  const hay = [
    entityId,
    attrs.app_name,
    attrs.app_id,
    attrs.source,
    attrs.media_content_id,
    attrs.entity_picture,
    attrs.friendly_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return BRANDS.find((b) => b.test.test(hay)) || null
}

/** Current playback position in seconds, extrapolated while playing. */
export function mediaPosition(entity, now = Date.now()) {
  const a = entity?.attributes || {}
  const pos = Number(a.media_position)
  if (!Number.isFinite(pos)) return null
  if (entity.state !== 'playing' || !a.media_position_updated_at) return pos
  const since = (now - new Date(a.media_position_updated_at).getTime()) / 1000
  const duration = Number(a.media_duration) || Infinity
  return Math.min(duration, pos + Math.max(0, since))
}

export function formatTime(sec) {
  if (!Number.isFinite(sec)) return '–:––'
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
