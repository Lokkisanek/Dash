/**
 * Messages from the HA config panel to the dashboard inside its live preview
 * iframe: `{ type: 'dash-preview', safe?: {t, r, b, l}, config?: <draft> }`.
 *
 * Honoured only when this page is embedded in a frame, the message comes from
 * the parent window AND its origin is the trusted parent origin:
 *  - production: the origin of the Home Assistant that handed us a valid
 *    access token (hassTarget.requestParentAuth checks it against hassUrl);
 *  - dev and demo (mock) builds: also the referrer's origin, so the panel
 *    harness can drive a mock dashboard without a Home Assistant.
 * A top-level page never listens. Messages that arrive before the origin is
 * known are kept (the last of each kind) and applied once it matches.
 */
import { isEmbedded } from './hassTarget'

const handlers = new Set()
let trusted = ''
let pending = []

function mockTrust() {
  if (!(import.meta.env.DEV || import.meta.env.VITE_MODE === 'mock')) return ''
  try {
    return document.referrer ? new URL(document.referrer).origin : ''
  } catch {
    return ''
  }
}

function deliver(data) {
  for (const fn of handlers) fn(data)
}

function onMessage(e) {
  if (e.source !== window.parent || e.data?.type !== 'dash-preview') return
  if (!trusted) {
    pending = [...pending.filter((m) => m.origin !== e.origin || Object.keys(m.data).join() !== Object.keys(e.data).join()), { origin: e.origin, data: e.data }].slice(-8)
    return
  }
  if (e.origin === trusted) deliver(e.data)
}

/** The parent origin was verified (parent auth); replays matching queued messages. */
export function trustParentOrigin(origin) {
  if (!isEmbedded || !origin) return
  trusted = origin
  const queued = pending
  pending = []
  for (const m of queued) if (m.origin === trusted) deliver(m.data)
}

export function trustedParentOrigin() {
  return trusted
}

/** fn(data) for every accepted preview message. Returns an unsubscribe function. */
export function onPreviewMessage(fn) {
  handlers.add(fn)
  return () => handlers.delete(fn)
}

let started = false
export function startPreviewBridge() {
  if (!isEmbedded || started) return false
  started = true
  window.addEventListener('message', onMessage)
  const mock = mockTrust()
  if (mock) trustParentOrigin(mock)
  window.parent.postMessage({ type: 'guest-ha:ready' }, '*')
  return true
}
