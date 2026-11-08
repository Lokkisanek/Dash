import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useGuestConfig } from './useGuestConfig'
import {
  PAGE_MIN_WIDTH,
  MAX_PAGES_PER_VIEW,
  SIDE_DOCK_SPACE,
  classifyViewport,
  dockSideFor,
  pagesPerViewFor,
} from '@/lib/layoutMode'

/**
 * Layout mode from the viewport, the one place that decides it:
 *   phone-portrait, phone-landscape, tablet-portrait, tablet-landscape, desktop
 * and how many pages are shown side by side (`pagesPerView`). The data model
 * does not change: every page stays a 4-column grid packed by packTiles().
 *
 * Settings (general): layoutMode "auto" | "single" (one centred column),
 * dockPosition "auto" | "bottom" | "right" | "left" (auto = right on a phone
 * in landscape, bottom elsewhere).
 */
export { PAGE_MIN_WIDTH, MAX_PAGES_PER_VIEW, SIDE_DOCK_SPACE, classifyViewport, dockSideFor, pagesPerViewFor }

const size = ref({ width: typeof window === 'undefined' ? 390 : window.innerWidth, height: typeof window === 'undefined' ? 844 : window.innerHeight })
const insets = ref({ left: 0, right: 0 })
let users = 0
let probe = null

/** Resolved --safe-left/--safe-right (env() or the preview/dev override) in px. */
function readInsets() {
  if (typeof document === 'undefined') return
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding-left:var(--safe-left,0px);padding-right:var(--safe-right,0px)'
    document.body.appendChild(probe)
  }
  const cs = getComputedStyle(probe)
  insets.value = { left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0 }
}

function onResize() {
  size.value = { width: window.innerWidth, height: window.innerHeight }
  readInsets()
}

export function useLayoutMode() {
  const { general, pages } = useGuestConfig()
  onMounted(() => {
    users += 1
    if (users === 1) {
      window.addEventListener('resize', onResize)
      // the HA preview sends simulated insets after load (lib/frameSafeArea.js)
      window.addEventListener('dash-insets', readInsets)
    }
    onResize()
  })
  onUnmounted(() => {
    users -= 1
    if (users === 0) {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('dash-insets', readInsets)
    }
  })

  const mode = computed(() => classifyViewport(size.value.width, size.value.height))
  const dockSide = computed(() => dockSideFor(mode.value, general.value.dockPosition))
  const layoutMode = computed(() => (general.value.layoutMode === 'single' ? 'single' : 'auto'))
  const available = computed(() => {
    const side = dockSide.value === 'bottom' ? 0 : SIDE_DOCK_SPACE
    return size.value.width - insets.value.left - insets.value.right - side - 16
  })
  const pagesPerView = computed(() => pagesPerViewFor(available.value, layoutMode.value, pages.value.length))
  return { mode, dockSide, layoutMode, pagesPerView, size, insets }
}
