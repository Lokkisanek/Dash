/**
 * env(safe-area-inset-*) is always 0 inside an iframe, so the HA config panel's
 * device preview posts the simulated insets and we expose them as CSS vars
 * (--frame-safe-top etc.), which the layout combines with env() via max().
 */
const SIDES = ['top', 'right', 'bottom', 'left']

/**
 * Dev and demo builds only (main.js guards the call): `?safe=59,34` sets the top
 * and bottom insets (optionally `,right,left`), so Playwright and desktop browsers
 * can show a notch phone. Never used by production builds.
 */
export function applySafeAreaOverride(search = window.location.search) {
  const raw = new URLSearchParams(search).get('safe')
  if (!raw) return false
  const [top, bottom, right = 0, left = 0] = raw.split(',').map((v) => Math.max(0, Number(v) || 0))
  const root = document.documentElement
  const values = { top, bottom, right, left }
  for (const side of SIDES) root.style.setProperty(`--frame-safe-${side}`, `${values[side] || 0}px`)
  return true
}

export function listenForFrameSafeArea() {
  if (window.parent === window) return
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.data?.type !== 'guest-ha:safe-area') return
    const root = document.documentElement
    for (const side of SIDES) {
      const px = Number(e.data.insets?.[side])
      root.style.setProperty(`--frame-safe-${side}`, `${Number.isFinite(px) ? Math.max(0, px) : 0}px`)
    }
  })
  window.parent.postMessage({ type: 'guest-ha:ready' }, '*')
}
