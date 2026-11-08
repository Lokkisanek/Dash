/**
 * Pure layout-mode rules (no DOM), used by composables/useLayoutMode.js and
 * tests/js/layoutMode.test.js. Docs: docs/CONFIGURATION.md, "Široké displeje".
 */
export const PAGE_MIN_WIDTH = 420
export const MAX_PAGES_PER_VIEW = 4
/** Width of the vertical dock plus its gap to the content (LiquidGlassDock). */
export const SIDE_DOCK_SPACE = 88 + 12 + 12

/** Pure classification, exported for tests. */
export function classifyViewport(width, height) {
  const short = Math.min(width, height)
  const landscape = width > height
  if (short < 500) return landscape ? 'phone-landscape' : 'phone-portrait'
  if (short <= 1024 && Math.max(width, height) <= 1440) return landscape ? 'tablet-landscape' : 'tablet-portrait'
  return 'desktop'
}

export function dockSideFor(mode, setting) {
  if (setting === 'bottom' || setting === 'left' || setting === 'right') return setting
  return mode === 'phone-landscape' ? 'right' : 'bottom'
}

/** N = clamp(floor(available / 420 px), 1, 4); "single" is always 1. */
export function pagesPerViewFor(available, layoutMode, pageCount = Infinity) {
  if (layoutMode === 'single') return 1
  const n = Math.floor(Math.max(0, available) / PAGE_MIN_WIDTH)
  return Math.max(1, Math.min(MAX_PAGES_PER_VIEW, n, Math.max(1, pageCount)))
}

