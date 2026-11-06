/**
 * Which Home Assistant this dashboard talks to, and how it authenticates.
 *
 * Hosted mode: https://dash.example.com/<ha-host>[:port] — the HA address lives
 * in the path, so one static deployment serves everybody and stores nothing.
 * Tokens stay in this browser (localStorage, keyed per HA) and every request
 * goes straight from the browser to that HA.
 */

const HOST_RE = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/i

export const isEmbedded = (() => {
  try {
    return window.parent !== window
  } catch {
    return true
  }
})()

/** First path segment if it looks like a host ("ha.example.com", "10.0.0.5:8123"). */
export function hostFromPath(pathname = window.location.pathname) {
  const seg = decodeURIComponent(pathname.split('/').filter(Boolean)[0] || '')
  if (!HOST_RE.test(seg)) return ''
  if (!seg.includes('.') && !seg.includes(':')) return ''
  return seg.toLowerCase()
}

/** HA URL encoded in the path; same scheme as this page (https page → https HA). */
export function hassUrlFromPath() {
  const host = hostFromPath()
  if (!host) return ''
  const scheme = window.location.protocol === 'http:' ? 'http' : 'https'
  return `${scheme}://${host}`
}

/** Path that represents a given HA URL, e.g. https://ha.example.com → /ha.example.com */
export function pathForHassUrl(hassUrl) {
  try {
    return `/${new URL(hassUrl).host}`
  } catch {
    return '/'
  }
}

export function storageKey(base, hassUrl) {
  try {
    return hassUrl ? `${base}:${new URL(hassUrl).host}` : base
  } catch {
    return base
  }
}

/**
 * Live preview inside the HA config panel: the panel already holds a valid
 * session, so it hands the iframe a short-lived access token instead of making
 * the preview log in (third-party iframes get partitioned storage anyway).
 * Only accepted when the message comes from the very HA the token is for.
 */
export function requestParentAuth(timeout = 2500) {
  if (!isEmbedded) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (value) => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(value)
    }
    const onMessage = (e) => {
      if (e.source !== window.parent || e.data?.type !== 'guest-ha:auth') return
      const { hassUrl, access_token: accessToken, expires } = e.data
      try {
        if (!accessToken || new URL(hassUrl).origin !== e.origin) return
      } catch {
        return
      }
      done({ hassUrl: hassUrl.replace(/\/$/, ''), accessToken, expires: Number(expires) || Date.now() + 60_000 })
    }
    const timer = setTimeout(() => done(null), timeout)
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: 'guest-ha:auth-request' }, '*')
  })
}

/** Auth object compatible with home-assistant-js-websocket, fed by the parent panel. */
export function createParentAuth(initial) {
  const data = { ...initial }
  return {
    data: { hassUrl: data.hassUrl },
    get wsUrl() {
      return `ws${data.hassUrl.slice(4)}/api/websocket`
    },
    get accessToken() {
      return data.accessToken
    },
    get expired() {
      return Date.now() > data.expires - 15_000
    },
    async refreshAccessToken() {
      const next = await requestParentAuth()
      if (!next) throw new Error('Preview token refresh failed')
      Object.assign(data, next)
    },
  }
}
