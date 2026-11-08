/**
 * Demo Videotéka (mock mode only): a small fake catalogue, fake releases and a
 * fake queue whose progress moves. Nothing is contacted; posters are flat
 * tonal squares drawn in the page (no image host).
 */
const CATALOG = [
  { tmdbId: 101, mediaType: 'movie', title: 'Tichá hora', year: 2025, overview: 'Horský vůdce a jedna dlouhá zimní noc.' },
  { tmdbId: 102, mediaType: 'movie', title: 'Severní linka', year: 2024, overview: 'Poslední vlak před uzavřením trati.' },
  { tmdbId: 103, mediaType: 'tv', title: 'Dům u jezera', year: 2023, overview: 'Tři generace jedné rodiny, jedno léto.' },
  { tmdbId: 104, mediaType: 'movie', title: 'Papírové lodě', year: 2022, overview: 'Dva bratři a závod na řece.' },
  { tmdbId: 105, mediaType: 'tv', title: 'Noční směna', year: 2025, overview: 'Pohotovost v malém městě.' },
  { tmdbId: 106, mediaType: 'movie', title: 'Sklo', year: 2021, overview: 'Sklář, který nikdy nedokončil svou mozaiku.' },
]
const HUES = [24, 200, 140, 280, 340, 50]

const status = new Map([
  ['movie:102', { status: 'available' }],
  ['tv:105', { status: 'monitored' }],
])
let queue = [{ id: 'Q1', tmdbId: 104, mediaType: 'movie', title: 'Papírové lodě', release: 'Paper.Boats.2022.1080p.WEB-DL-GRP', progress: 34 }]
const requests = []
let seq = 1

// demo only: ?mockRequest=1 starts with one pending guest request (owner inbox tests)
try {
  if (new URLSearchParams(globalThis.location?.search || '').get('mockRequest') === '1') {
    requests.push({ id: 'r0', tmdbId: 101, mediaType: 'movie', title: 'Tichá hora', year: 2025, poster: 'demo-101', requester: 'Pokoj 3', created: '2026-11-08T12:00:00', status: 'pending', note: '' })
  }
} catch {
  /* no location (tests) */
}

function withStatus(item) {
  const q = queue.find((x) => x.tmdbId === item.tmdbId && x.mediaType === item.mediaType)
  const s = q ? { status: 'downloading', percent: Math.round(q.progress) } : status.get(`${item.mediaType}:${item.tmdbId}`) || { status: 'unrequested' }
  if (s.status === 'unrequested' && requests.some((r) => r.tmdbId === item.tmdbId && r.status === 'pending')) return { ...item, poster: `demo-${item.tmdbId}`, status: 'requested' }
  return { ...item, poster: `demo-${item.tmdbId}`, ...s }
}

/** A flat tonal poster (SVG data URL): no external image, no gradient. */
export function demoPoster(token) {
  const id = Number(String(token).replace('demo-', '')) || 0
  const hue = HUES[id % HUES.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"><rect width="2" height="3" fill="hsl(${hue} 32% 46%)"/><rect y="2.2" width="2" height="0.8" fill="hsl(${hue} 28% 38%)"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function releasesFor(item) {
  return [
    { guid: `g-${item.tmdbId}-1`, indexerId: 1, title: `${item.title.replace(/ /g, '.')}.${item.year}.2160p.WEB-DL.DV.HDR`, indexer: 'Demo', size: 18_400_000_000, seeders: 112, leechers: 9, quality: 'WEBDL-2160p', languages: ['Czech', 'English'], customFormatScore: 250, rejections: [], rejected: false, releaseGroup: 'DEMO' },
    { guid: `g-${item.tmdbId}-2`, indexerId: 1, title: `${item.title.replace(/ /g, '.')}.${item.year}.1080p.BluRay.x264`, indexer: 'Demo', size: 9_100_000_000, seeders: 340, leechers: 21, quality: 'Bluray-1080p', languages: ['English'], customFormatScore: 120, rejections: [], rejected: false, releaseGroup: 'DEMO' },
    { guid: `g-${item.tmdbId}-3`, indexerId: 2, title: `${item.title.replace(/ /g, '.')}.${item.year}.720p.HDTV`, indexer: 'Demo 2', size: 1_400_000_000, seeders: 12, leechers: 3, quality: 'HDTV-720p', languages: ['English'], customFormatScore: -50, rejections: ['Kvalita není v profilu'], rejected: true, releaseGroup: '' },
  ]
}

const find = (mt, id) => CATALOG.find((c) => c.mediaType === mt && c.tmdbId === id)

export const mockLibraryApi = {
  async discover() {
    return CATALOG.map(withStatus)
  },
  async search(q) {
    const s = String(q || '').toLowerCase()
    return CATALOG.filter((c) => c.title.toLowerCase().includes(s)).map(withStatus)
  },
  async detail(mt, id) {
    const item = find(mt, id)
    if (!item) throw Object.assign(new Error('not_found'), { code: 'not_found' })
    return withStatus(item)
  },
  async request(mt, id, { guest = false } = {}) {
    const item = find(mt, id)
    if (guest) {
      const rec = { id: `r${seq++}`, tmdbId: id, mediaType: mt, title: item.title, year: item.year, poster: `demo-${id}`, requester: 'Pokoj 3', created: new Date().toISOString(), status: 'pending', note: '' }
      requests.unshift(rec)
      return rec
    }
    status.set(`${mt}:${id}`, { status: 'monitored' })
    return withStatus(item)
  },
  async releases(mt, id) {
    return { releases: releasesFor(find(mt, id)) }
  },
  async grab(mt, id, guid) {
    const item = find(mt, id)
    const rel = releasesFor(item).find((r) => r.guid === guid)
    queue = [{ id: `Q${seq++}`, tmdbId: id, mediaType: mt, title: item.title, release: rel?.title || '', progress: 1 }, ...queue]
    return withStatus(item)
  },
  async closePicker() {},
  async options() {
    return { qualityProfiles: [{ id: 4, name: 'HD-1080p' }, { id: 6, name: 'Ultra-HD' }], rootFolders: [{ path: '/media/filmy', accessible: true }] }
  },
  activity(cb) {
    const tick = () => {
      queue = queue.map((q) => ({ ...q, progress: Math.min(100, q.progress + 3 + Math.random() * 4) }))
      cb(queue.map((q) => ({ ...q, poster: `demo-${q.tmdbId}`, speed: q.progress < 100 ? 4_200_000 : 0, eta: Math.round((100 - q.progress) * 6), state: q.progress < 100 ? 'downloading' : 'uploading', hash: q.id })))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  },
  async torrent() {},
  async requests() {
    return { items: requests.slice(), pending: requests.filter((r) => r.status === 'pending').length }
  },
  async requestUpdate(id, action, note = '') {
    const r = requests.find((x) => x.id === id)
    if (!r) throw Object.assign(new Error('not_found'), { code: 'not_found' })
    r.status = action === 'approve' ? 'approved' : 'declined'
    r.note = note
    if (action === 'approve') status.set(`${r.mediaType}:${r.tmdbId}`, { status: 'monitored' })
    return r
  },
  async poster(token) {
    return demoPoster(token)
  },
}
