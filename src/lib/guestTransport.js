/**
 * Guest pass transport: websocket client for /api/guest_ha_dashboard/ws.
 *
 * The guest token is sent once, in the first message (never in a URL or
 * header). The server filters everything by the pass's profile; this client
 * only reconnects, matches replies to requests and reports why it stopped.
 * Protocol: docs/GUEST_PASSES.md.
 */

const PING_MS = 50_000
const REQUEST_TIMEOUT_MS = 15_000
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]

/** Close codes / auth codes after which reconnecting is pointless. */
const ENDED = new Set(['invalid_auth', 'expired', 'revoked'])
const CLOSE_REASON = { 4000: 'invalid_auth', 4002: 'expired', 4003: 'revoked', 4004: 'too_many_connections' }

export class GuestError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

export class GuestPassTransport {
  /**
   * @param {object} opts
   * @param {string} opts.hassUrl  https://ha.example.com
   * @param {string} opts.token    guest token
   * @param {(e: {type: string, [k: string]: any}) => void} opts.onEvent
   *   auth_ok | states | state | config | ended | pending | disconnected | error
   */
  constructor({ hassUrl, token, onEvent }) {
    this.wsUrl = `${hassUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/api/guest_ha_dashboard/ws`
    this.token = token
    this.onEvent = onEvent
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.attempt = 0
    this.closedByUs = false
    this.pingTimer = null
    this.retryTimer = null
    this.stateCallback = null
  }

  connect() {
    this.closedByUs = false
    clearTimeout(this.retryTimer)
    let ws
    try {
      ws = new WebSocket(this.wsUrl)
    } catch {
      this.scheduleRetry()
      return
    }
    this.ws = ws
    let authed = false
    let authCode = null

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', token: this.token }))
      } else if (msg.type === 'auth_ok') {
        authed = true
        this.attempt = 0
        this.startPing()
        this.onEvent({ type: 'auth_ok', pass: msg.pass, profile: msg.profile })
        this.afterAuth()
      } else if (msg.type === 'auth_invalid') {
        authCode = msg.code
      } else if (msg.type === 'result') {
        const req = this.pending.get(msg.id)
        if (!req) return
        this.pending.delete(msg.id)
        clearTimeout(req.timer)
        if (msg.success) req.resolve(msg.result)
        else req.reject(new GuestError(msg.error?.code || 'error'))
      } else if (msg.type === 'pong') {
        /* alive */
      } else if (msg.type === 'state') {
        this.onEvent({ type: 'state', entityId: msg.entity_id, state: msg.state })
      } else if (msg.type === 'library_activity') {
        this.onEvent({ type: 'library_activity', items: msg.items })
      } else if (msg.type === 'config') {
        this.onEvent({ type: 'config', config: msg.config })
      } else if (msg.type === 'closing') {
        authCode = authCode || msg.reason
      }
    }

    ws.onclose = (ev) => {
      this.stopPing()
      this.failPending('disconnected')
      if (this.closedByUs) return
      const reason = authCode || CLOSE_REASON[ev.code] || (ev.code === 4001 ? 'profile_changed' : null)
      if (reason && ENDED.has(reason)) {
        this.onEvent({ type: 'ended', reason })
        return
      }
      if (reason === 'not_yet_valid') {
        this.onEvent({ type: 'pending' })
        this.scheduleRetry(60_000)
        return
      }
      this.onEvent({ type: 'disconnected', reason: reason || (authed ? 'lost' : 'unreachable') })
      // profile changed: reconnect at once to get the new allowlist
      this.scheduleRetry(reason === 'profile_changed' ? 0 : undefined)
    }
  }

  async afterAuth() {
    try {
      const config = await this.request({ type: 'get_config' })
      this.onEvent({ type: 'config', config })
      const res = await this.request({ type: 'subscribe_states' })
      this.onEvent({ type: 'states', states: res?.states || {} })
    } catch (err) {
      this.onEvent({ type: 'error', code: err?.code || 'error' })
    }
  }

  scheduleRetry(delay) {
    if (this.closedByUs) return
    const wait = delay ?? BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
    this.attempt += 1
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.connect(), wait)
  }

  startPing() {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' })
    }, PING_MS)
  }

  stopPing() {
    clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  failPending(code) {
    for (const req of this.pending.values()) {
      clearTimeout(req.timer)
      req.reject(new GuestError(code))
    }
    this.pending.clear()
  }

  send(msg) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  request(msg) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (!this.send({ ...msg, id })) {
        reject(new GuestError('disconnected'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new GuestError('timeout'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  callService(domain, service, data = {}) {
    const { entity_id: entityId, ...rest } = data
    return this.request({ type: 'call_service', domain, service, entity_id: entityId, data: rest })
  }

  /** Library of an allowed player (needs the profile capability media_browse). */
  browseMedia(entityId, contentType, contentId) {
    const msg = { type: 'browse_media', entity_id: entityId }
    if (contentId) Object.assign(msg, { media_content_type: contentType, media_content_id: contentId })
    return this.request(msg)
  }

  searchMedia(entityId, query) {
    return this.request({ type: 'search_media', entity_id: entityId, search_query: query })
  }

  /** Artwork of an allowed media player as an object URL (or null). */
  async mediaImage(entityId) {
    try {
      const res = await this.request({ type: 'media_image', entity_id: entityId })
      return toObjectUrl(res)
    } catch {
      return null
    }
  }

  async photoList() {
    try {
      const res = await this.request({ type: 'photo_list' })
      return Array.isArray(res?.photos) ? res.photos : []
    } catch {
      return []
    }
  }

  async photoGet(id) {
    try {
      return toObjectUrl(await this.request({ type: 'photo_get', photo_id: id }))
    } catch {
      return null
    }
  }

  close() {
    this.closedByUs = true
    clearTimeout(this.retryTimer)
    this.stopPing()
    this.failPending('closed')
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
  }
}

function toObjectUrl(res) {
  if (!res?.data) return null
  const bin = atob(res.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: res.mime || 'image/jpeg' }))
}
