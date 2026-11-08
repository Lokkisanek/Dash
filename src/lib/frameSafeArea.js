/**
 * env(safe-area-inset-*) is always 0 inside an iframe, so the HA config panel's
 * device preview sends the simulated insets (previewBridge: `safe: {t,r,b,l}`)
 * and we expose them as CSS vars (--frame-safe-top etc.), which the layout
 * combines with env() via max().
 */
import { onPreviewMessage, startPreviewBridge } from './previewBridge'

const SIDES = ['top', 'right', 'bottom', 'left']

function setInsets(values) {
  const root = document.documentElement
  for (const side of SIDES) {
    const px = Number(values?.[side])
    root.style.setProperty(`--frame-safe-${side}`, `${Number.isFinite(px) ? Math.max(0, px) : 0}px`)
  }
  window.dispatchEvent(new Event('dash-insets'))
}

/**
 * `?safe=` value -> insets. CSS order for four values (`t,r,b,l`); the older
 * forms stay valid: one value = top, two = top,bottom, three = top,bottom,right.
 */
export function parseSafeParam(raw) {
  if (!raw) return null
  const v = String(raw).split(',').map((x) => Math.max(0, Number(x) || 0))
  if (v.length >= 4) return { top: v[0], right: v[1], bottom: v[2], left: v[3] }
  return { top: v[0] || 0, bottom: v[1] || 0, right: v[2] || 0, left: 0 }
}

/**
 * Dev and demo builds only (main.js guards the call): `?safe=59,34` or
 * `?safe=0,59,21,59` simulates a notch phone for Playwright and desktop
 * browsers. Never used by production builds.
 */
export function applySafeAreaOverride(search = window.location.search) {
  const insets = parseSafeParam(new URLSearchParams(search).get('safe'))
  if (!insets) return false
  setInsets(insets)
  return true
}

export function listenForFrameSafeArea() {
  if (!startPreviewBridge()) return
  onPreviewMessage((data) => {
    const s = data?.safe
    if (s && typeof s === 'object') setInsets({ top: s.t, right: s.r, bottom: s.b, left: s.l })
  })
}
