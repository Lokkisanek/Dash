/**
 * Videotéka helpers without DOM: status badges, release sorting and filtering,
 * the activity list (tests/js/library.test.js).
 */
export const STATUSES = ['available', 'downloading', 'monitored', 'requested', 'unrequested', 'unavailable']

/** Badge for a status: i18n key and a flat tone (no gradients). */
export function statusBadge(item) {
  const s = STATUSES.includes(item?.status) ? item.status : 'unrequested'
  const tone = { available: 'success', downloading: 'info', monitored: 'warning', requested: 'accent', unrequested: 'none', unavailable: 'muted' }[s]
  return { status: s, key: `libStatus_${s}`, tone, percent: s === 'downloading' ? Math.max(0, Math.min(100, Math.round(item.percent || 0))) : null }
}

export const SORTS = ['seeders', 'size', 'score']

/** Sort (desc) and filter by text; rejected releases only when asked. */
export function viewReleases(list, { sort = 'seeders', filter = '', showRejected = false } = {}) {
  const q = String(filter || '').trim().toLowerCase()
  const key = { seeders: (r) => r.seeders ?? -1, size: (r) => r.size ?? 0, score: (r) => r.customFormatScore ?? 0 }[SORTS.includes(sort) ? sort : 'seeders']
  return (Array.isArray(list) ? list : [])
    .filter((r) => showRejected || !r.rejected)
    .filter((r) => !q || `${r.title} ${r.indexer} ${r.quality} ${(r.languages || []).join(' ')}`.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => key(b) - key(a) || String(a.title).localeCompare(String(b.title)))
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '–'
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

export function formatSpeed(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return ''
  return `${(bps / 1e6).toFixed(1)} MB/s`
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds >= 8640000) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

/** Activity: active downloads first, then by progress. */
export function sortActivity(items) {
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => (b.speed || 0) - (a.speed || 0) || (a.progress || 0) - (b.progress || 0))
}
