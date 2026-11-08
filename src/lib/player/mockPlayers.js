/**
 * Demo data for the player engines (mock mode only): a silent test tone
 * generated in the page (WAV data URL, no network), a station that cannot be
 * reached (to show "Stream nedostupný"), a tiny media library and an idle
 * Spotify that never contacts Spotify.
 */
let silent = ''

/** 8 kHz, 8-bit mono WAV of silence as a data URL. */
export function silentWavDataUrl(seconds = 20) {
  if (silent) return silent
  const rate = 8000
  const samples = rate * seconds
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44) // 8-bit silence
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
  silent = `data:audio/wav;base64,${btoa(bin)}`
  return silent
}

export function mockStations() {
  return [
    { id: 'demo-tone', name: 'Testovací tón (ticho)', url: silentWavDataUrl() },
    { id: 'demo-down', name: 'Nedostupná stanice', url: 'https://stream.invalid/live.mp3' },
  ]
}

const LIBRARY = {
  '': {
    title: 'Média Home Assistantu',
    media_class: 'directory',
    children: [
      { title: 'Hudba', media_class: 'directory', media_content_type: 'directory', media_content_id: 'media-source://media_source/local/Hudba', can_expand: true, can_play: false },
    ],
  },
  'media-source://media_source/local/Hudba': {
    title: 'Hudba',
    media_class: 'directory',
    children: [
      { title: 'Ticho.wav', media_class: 'music', media_content_type: 'audio/wav', media_content_id: 'media-source://media_source/local/Hudba/Ticho.wav', can_expand: false, can_play: true },
    ],
  },
}

export const mockLibrary = {
  async browse(id) {
    const node = LIBRARY[id || '']
    if (!node) throw new Error('demo: unknown media id')
    return node
  },
  async resolve() {
    return { url: silentWavDataUrl() }
  },
}

export const mockSpotifyApi = {
  state: async () => ({ is_playing: false, device: null, item: null, progress_ms: null }),
  control: async () => {
    throw Object.assign(new Error('demo'), { code: 'spotify_disabled' })
  },
  search: async () => [],
  browse: async () => [],
  devices: async () => [],
}
