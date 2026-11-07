/**
 * Guest passes on the device: pairing code in the URL fragment, the guest token
 * per Home Assistant host, and the pairing request itself.
 *
 * The code only ever lives in the fragment (#pair=…), which browsers never send
 * to a server, and is removed from the address bar as soon as it is read.
 * See docs/GUEST_PASSES.md.
 */

import { storageKey } from '@/lib/hassTarget'

const GUEST_KEY = 'dash_guest'
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LEN = 12

/** XXXX-XXXX-XXXX → XXXXXXXXXXXX, or '' if it cannot be a code. */
export function normalizeCode(raw) {
  const code = String(raw || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
  if (code.length !== CODE_LEN) return ''
  for (const ch of code) if (!ALPHABET.includes(ch)) return ''
  return code
}

/** Group as XXXX-XXXX-XXXX while typing (keeps partial input). */
export function formatCode(raw) {
  const clean = String(raw || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, CODE_LEN)
  return clean.match(/.{1,4}/g)?.join('-') || ''
}

/** Read #pair=CODE and remove it from the address bar. */
export function takePairCodeFromUrl() {
  try {
    const hash = window.location.hash || ''
    const match = hash.match(/(?:^#|&)pair=([^&]+)/)
    if (!match) return ''
    const rest = hash
      .replace(/^#/, '')
      .split('&')
      .filter((part) => !part.startsWith('pair='))
      .join('&')
    const url = `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`
    window.history.replaceState({}, document.title, url)
    return normalizeCode(decodeURIComponent(match[1])) ? formatCode(decodeURIComponent(match[1])) : ''
  } catch {
    return ''
  }
}

/** Running as an installed app (Home Screen / standalone window)? */
export function isStandalone() {
  try {
    if (window.navigator.standalone === true) return true
    return window.matchMedia?.('(display-mode: standalone)').matches === true
  } catch {
    return false
  }
}

/** iPhone / iPad (also iPadOS, which reports as Mac with touch). */
export function isIos() {
  try {
    const ua = navigator.userAgent || ''
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  } catch {
    return false
  }
}

function key(hassUrl) {
  return storageKey(GUEST_KEY, hassUrl)
}

/** Stored guest credentials for this HA host: { token, pass } or null. */
export function loadGuest(hassUrl) {
  if (!hassUrl) return null
  try {
    const raw = localStorage.getItem(key(hassUrl))
    const data = raw ? JSON.parse(raw) : null
    return data && typeof data.token === 'string' ? data : null
  } catch {
    return null
  }
}

export function saveGuest(hassUrl, data) {
  try {
    if (data) localStorage.setItem(key(hassUrl), JSON.stringify({ ...data, hassUrl }))
    else localStorage.removeItem(key(hassUrl))
  } catch {
    /* storage blocked (private mode): the pass works until the tab closes */
  }
}

/**
 * Any stored guest pass on this device: { hassUrl, data } or null. Used when
 * an installed app opens at "/" without the HA host in the path.
 */
export function findAnyGuest() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(`${GUEST_KEY}:`)) continue
      const data = JSON.parse(localStorage.getItem(k) || 'null')
      if (data?.token && data?.hassUrl) return { hassUrl: data.hassUrl, data }
    }
  } catch {
    /* storage blocked */
  }
  return null
}

/** Error with a code the pairing screen can explain in plain language. */
export class PairError extends Error {
  constructor(code, extra = {}) {
    super(code)
    this.code = code
    Object.assign(this, extra)
  }
}

/** Short device name so the owner can tell paired devices apart. */
function deviceName() {
  try {
    const ua = navigator.userAgent || ''
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
    if (/iPhone/.test(ua)) return 'iPhone'
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
    return 'Browser'
  } catch {
    return 'Browser'
  }
}

/**
 * Exchange a pairing code for a guest token, straight with Home Assistant.
 * Throws PairError: invalid_code, rate_limited, not_installed, unavailable,
 * cors (HA reachable but the browser was not allowed to read the answer),
 * unreachable, bad_url.
 */
export async function pairWithCode(hassUrl, rawCode) {
  const code = normalizeCode(rawCode)
  if (!code) throw new PairError('invalid_code')
  let base
  try {
    base = new URL(hassUrl).origin
  } catch {
    throw new PairError('bad_url')
  }

  let resp
  try {
    resp = await fetch(`${base}/api/guest_ha_dashboard/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device_name: deviceName() }),
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    // Network error: either HA is unreachable or a proxy blocked the
    // cross-origin request. An opaque request tells the two apart.
    const reachable = await fetch(`${base}/manifest.json`, { mode: 'no-cors', cache: 'no-store' })
      .then(() => true)
      .catch(() => false)
    throw new PairError(reachable ? 'cors' : 'unreachable')
  }

  let body = null
  try {
    body = await resp.json()
  } catch {
    /* non-JSON answer */
  }
  if (resp.ok && body?.token) return body
  if (resp.status === 429) throw new PairError('rate_limited', { retryAfter: Number(body?.retry_after) || 60 })
  if (resp.status === 404) throw new PairError('not_installed')
  if (resp.status === 503) throw new PairError('unavailable')
  throw new PairError('invalid_code')
}
