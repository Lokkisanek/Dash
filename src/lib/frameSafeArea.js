/**
 * env(safe-area-inset-*) is always 0 inside an iframe, so the HA config panel's
 * device preview posts the simulated insets and we expose them as CSS vars
 * (--frame-safe-top etc.), which the layout combines with env() via max().
 */
const SIDES = ['top', 'right', 'bottom', 'left']

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
