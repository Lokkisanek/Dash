<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useIdle } from '@/composables/useIdle'
import StandbyScreen from '@/components/StandbyScreen.vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { useWakeLock } from '@/composables/useWakeLock'
import { unlockAudio } from '@/composables/useSound'
import { onPreviewMessage } from '@/lib/previewBridge'
import { useLayoutMode, SIDE_DOCK_SPACE } from '@/composables/useLayoutMode'

import HaLogin from '@/components/HaLogin.vue'
import PairingScreen from '@/components/PairingScreen.vue'
import GuestPassStatus from '@/components/GuestPassStatus.vue'
import GuestToast from '@/components/GuestToast.vue'
import ConnectionBadge from '@/components/ConnectionBadge.vue'
import StatusBarStrip from '@/components/StatusBarStrip.vue'
import PageGrid from '@/components/PageGrid.vue'
import LiquidGlassDock from '@/components/LiquidGlassDock.vue'
import BackgroundOrbs from '@/components/BackgroundOrbs.vue'

const { status } = useHomeAssistant()

const { pages, dock, appearance, themeMode, general, standby } = useGuestConfig()
const { t } = useI18n()
useWakeLock()
const { mode: layoutMode, dockSide, pagesPerView } = useLayoutMode()
/** Wide modes: N pages side by side on a track that moves by one page. */
const wide = computed(() => pagesPerView.value > 1)
const single = computed(() => general.value.layoutMode === 'single')

const forceStandby = new URLSearchParams(window.location.search).get('standby') === '1'
const { idle, wake, sleep } = useIdle(
  () => standby.value.idleMinutes,
  () => standby.value.enabled || forceStandby,
)
if (forceStandby) onMounted(sleep)

/** The HA config panel can show the standby screen in its preview (lib/previewBridge.js). */
const stopPreview = onPreviewMessage((data) => {
  if (typeof data?.standby === 'boolean') data.standby ? sleep() : wake()
})
onUnmounted(stopPreview)

const DOCK_MAX = 6
const activePageId = ref(pages.value[0]?.id)

/** Dock entries resolved to pages (max 6). Fallback: first 6 pages. */
const dockItems = computed(() => {
  const list = pages.value || []
  const configured = (dock.value || []).filter((d) => d?.pageId).slice(0, DOCK_MAX)
  if (configured.length) {
    return configured
      .map((d) => {
        const page = list.find((r) => r.id === d.pageId)
        if (!page) return null
        const label =
          d.showLabel === false ? '' : String(d.label || page.label || page.id).trim()
        return {
          id: page.id,
          label,
          showLabel: d.showLabel !== false && Boolean(label),
          icon: d.icon || page.icon || 'Home',
        }
      })
      .filter(Boolean)
  }
  return list.slice(0, DOCK_MAX).map((r) => ({
    id: r.id,
    label: r.label || r.id,
    showLabel: true,
    icon: r.icon || 'Home',
  }))
})

/**
 * Swiping right moves to the next page, so following pages sit to the left:
 * a higher index slides in from the left ('page-prev'), a lower one from the right.
 */
const pageTransition = ref('page-next')
/** Finger offset of the current page while dragging (px). */
const dragX = ref(0)
const dragging = ref(false)
/** Offset at release, so the incoming page starts right next to the outgoing one. */
const releaseX = ref(0)

function indexOf(id) {
  return pages.value.findIndex((r) => r.id === id)
}

function selectPage(id, fromX = 0) {
  if (!id || id === activePageId.value) return
  unlockAudio()
  pageTransition.value = indexOf(id) >= indexOf(activePageId.value) ? 'page-prev' : 'page-next'
  releaseX.value = fromX
  activePageId.value = id
}

/** First page shown on the wide track; the active page is always inside the visible range. */
const startIdx = ref(0)
const maxStart = computed(() => Math.max(0, pages.value.length - pagesPerView.value))
watch(
  [activePageId, pagesPerView, () => pages.value.length],
  () => {
    const idx = Math.max(0, indexOf(activePageId.value))
    let start = Math.min(startIdx.value, maxStart.value)
    if (idx < start) start = idx
    if (idx >= start + pagesPerView.value) start = idx - pagesPerView.value + 1
    startIdx.value = Math.max(0, Math.min(maxStart.value, start))
  },
  { immediate: true },
)
const visibleIds = computed(() =>
  wide.value ? pages.value.slice(startIdx.value, startIdx.value + pagesPerView.value).map((p) => p.id) : [activePageId.value],
)

/** Move the view by one page (wide: the track; single: the next page). */
function stepPage(delta) {
  if (wide.value) {
    const next = Math.max(0, Math.min(maxStart.value, startIdx.value + delta))
    if (next === startIdx.value) return false
    unlockAudio()
    startIdx.value = next
    activePageId.value = pages.value[delta > 0 ? next + pagesPerView.value - 1 : next]?.id || activePageId.value
    return true
  }
  const target = neighbour(delta)
  if (target) selectPage(target.id)
  return Boolean(target)
}

function onKeydown(e) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  if (e.target?.closest?.('input, select, textarea, dialog, [role="dialog"], [contenteditable="true"]')) return
  if (e.key === 'ArrowRight' && stepPage(1)) e.preventDefault()
  if (e.key === 'ArrowLeft' && stepPage(-1)) e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

/** Space the content keeps free for the dock (bottom or side). */
const dockSpace = computed(() => ({
  '--dock-space-bottom': dockSide.value === 'bottom' ? 'calc(var(--dock-h) + var(--dock-gap) + 16px)' : '16px',
  '--dock-space-left': dockSide.value === 'left' ? `${SIDE_DOCK_SPACE}px` : '0px',
  '--dock-space-right': dockSide.value === 'right' ? `${SIDE_DOCK_SPACE}px` : '0px',
}))

function neighbour(delta) {
  const list = pages.value
  let idx = indexOf(activePageId.value)
  if (idx < 0) idx = 0
  return list[idx + delta] || null
}

const swipe = { x: 0, y: 0, t: 0, active: false, axis: null, width: 1 }
let suppressClick = false

function onPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (e.target.closest?.('input, select, textarea, dialog, [data-no-swipe]')) return
  swipe.x = e.clientX
  swipe.y = e.clientY
  swipe.t = performance.now()
  swipe.active = true
  swipe.axis = null
  swipe.width = e.currentTarget.clientWidth || window.innerWidth
}

function onPointerMove(e) {
  if (!swipe.active) return
  const dx = e.clientX - swipe.x
  const dy = e.clientY - swipe.y
  if (!swipe.axis) {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swipe.axis = 'x'
      dragging.value = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } else if (Math.abs(dy) > 10) {
      swipe.active = false
      return
    } else {
      return
    }
  }
  // wide: natural direction (next page is to the right); single: swipe right = next
  const blocked = wide.value
    ? (dx < 0 && startIdx.value >= maxStart.value) || (dx > 0 && startIdx.value <= 0)
    : (dx > 0 && !neighbour(1)) || (dx < 0 && !neighbour(-1))
  dragX.value = blocked ? dx / 3 : dx
}

function onPointerUp(e) {
  if (!swipe.active) return
  swipe.active = false
  if (swipe.axis !== 'x') return
  // The click that follows a drag is dispatched in the same task as pointerup.
  suppressClick = true
  setTimeout(() => {
    suppressClick = false
  }, 0)
  dragging.value = false
  const dx = e.clientX - swipe.x
  const velocity = dx / Math.max(1, performance.now() - swipe.t)
  const commit = Math.abs(dx) > swipe.width * 0.22 || Math.abs(velocity) > 0.45
  const target = commit ? neighbour(dx > 0 ? 1 : -1) : null
  const offset = dragX.value
  dragX.value = 0
  if (wide.value) {
    if (commit) stepPage(dx < 0 ? 1 : -1)
    return
  }
  if (target) selectPage(target.id, offset)
}

function onPointerCancel() {
  swipe.active = false
  dragging.value = false
  dragX.value = 0
}

function onClickCapture(e) {
  if (!suppressClick) return
  suppressClick = false
  e.stopPropagation()
  e.preventDefault()
}

watch(
  pages,
  (list) => {
    if (!list?.length) return
    if (!list.some((r) => r.id === activePageId.value)) {
      activePageId.value = list[0].id
    }
  },
  { immediate: true, deep: true },
)

watch(
  [themeMode, appearance],
  () => {
    const mode = themeMode.value
    const theme = mode === 'dark' ? 'heliogrid-dark' : 'heliogrid'
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.setProperty('--guest-accent', appearance.value.accent || '#ff6b00')
    document.documentElement.classList.toggle('dark', mode === 'dark')
    // The wallpaper colour also sits on <html>, so no other colour can show at an
    // edge (status bar, home indicator, overscroll). theme-color matches it.
    const shellBg = mode === 'dark' ? '#0e1014' : '#f3f0f7'
    document.documentElement.style.setProperty('--app-bg', shellBg)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', shellBg)
  },
  { immediate: true, deep: true },
)

const activePage = computed(
  () => pages.value.find((r) => r.id === activePageId.value) || pages.value[0],
)

const showLogin = computed(() => {
  if (status.value === 'login') return true
  if (status.value === 'need_url') return true
  return false
})

const showBootSplash = computed(() => {
  return status.value === 'idle' || status.value === 'connecting'
})

onMounted(() => {
  const unlock = () => {
    unlockAudio()
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { once: true })
})
</script>

<template>
  <HaLogin v-if="showLogin" />

  <PairingScreen v-else-if="status === 'pairing'" />

  <GuestPassStatus v-else-if="status === 'guest_ended' || status === 'guest_pending'" />

  <div
    v-else-if="showBootSplash"
    class="dashboard-shell grid place-items-center h-full text-base-content/50 text-sm"
  >
    {{ t('connecting') }}
  </div>

  <div
    v-else
    class="dashboard-shell relative h-full w-full overflow-hidden text-base-content"
    :class="[{ 'is-dark': themeMode === 'dark', 'is-wide': wide }, `dock-${dockSide}`]"
    :style="dockSpace"
    :data-layout-mode="layoutMode"
    :data-pages-per-view="pagesPerView"
    :data-dock-side="dockSide"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @click.capture="onClickCapture"
  >
    <!-- Full-bleed wallpaper: fixed to the large viewport, so it runs under the
         iOS status bar, the home indicator and rubber-band overscroll. -->
    <div class="wallpaper" aria-hidden="true">
      <BackgroundOrbs :dark="themeMode === 'dark'" />
    </div>
    <StatusBarStrip :enabled="general.statusBarStrip === true" :dark="themeMode === 'dark'" />
    <ConnectionBadge />

    <div
      class="content-column relative z-10 flex flex-col h-full px-4 mx-auto"
      :class="[status === 'connected' ? 'pt-4' : 'pt-9', wide ? 'is-wide' : 'max-w-lg', { 'is-single': single }]"
    >
      <!-- wide: every page on one track, N visible, moved by one page -->
      <div v-if="wide" class="pages-viewport -mx-4" data-pages-track>
        <div
          class="pages-track"
          :class="{ 'is-dragging': dragging }"
          :style="{ '--n': pagesPerView, '--start': startIdx, '--drag': `${dragX}px` }"
        >
          <div
            v-for="(p, i) in pages"
            :key="p.id"
            data-dashboard-scroll
            :data-page-id="p.id"
            class="page wide-page no-scrollbar overscroll-contain"
            :class="{ 'is-visible': i >= startIdx && i < startIdx + pagesPerView }"
            :aria-hidden="i >= startIdx && i < startIdx + pagesPerView ? undefined : 'true'"
            :inert="i >= startIdx && i < startIdx + pagesPerView ? undefined : true"
          >
            <div class="page-content">
              <PageGrid :page="p" />
            </div>
          </div>
        </div>
        <p class="sr-only" aria-live="polite" data-page-range>
          {{ startIdx + 1 }}–{{ Math.min(pages.length, startIdx + pagesPerView) }} / {{ pages.length }}
        </p>
      </div>
      <div v-else class="pages-viewport -mx-4" :style="{ '--release': `${releaseX}px` }">
        <Transition :name="pageTransition">
          <div
            :key="activePage?.id || 'empty'"
            data-dashboard-scroll
            class="page no-scrollbar overscroll-contain"
            :class="{ 'is-dragging': dragging }"
            :style="{ '--drag': `${dragX}px` }"
          >
            <div class="page-content">
              <PageGrid :page="activePage" />
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <LiquidGlassDock
      data-no-swipe
      :model-value="activePageId"
      :active-ids="visibleIds"
      :items="dockItems"
      :dark="themeMode === 'dark'"
      :side="dockSide"
      @update:model-value="selectPage"
    />

    <GuestToast />

    <Transition name="standby">
      <StandbyScreen v-if="idle" :settings="standby" :use24h="general.use24h" @wake="wake" />
    </Transition>
  </div>
</template>

<style scoped>
/*
 * The shell pads only the top and the sides: the pages run to the bottom edge
 * (behind the dock and the home indicator) and pad their own content instead.
 */
.dashboard-shell {
  --shell-bg: #f3f0f7;
  background: transparent;
  touch-action: pan-y;
  padding: var(--safe-top, 0px) var(--safe-right, 0px) 0 var(--safe-left, 0px);
}

.wallpaper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 100vh;
  height: 100lvh;
  min-height: 100%;
  z-index: 0;
  background: var(--shell-bg);
  pointer-events: none;
}

/* Last row of tiles clears the dock (bottom dock: its height + gap) and the home indicator. */
.page-content {
  padding-bottom: calc(var(--dock-space-bottom, calc(var(--dock-h) + var(--dock-gap) + 16px)) + var(--safe-bottom, 0px));
}

/* Side dock: the content column keeps the dock's width free on that side. */
.content-column {
  padding-left: calc(1rem + var(--dock-space-left, 0px));
  padding-right: calc(1rem + var(--dock-space-right, 0px));
  box-sizing: border-box;
}

.content-column.max-w-lg {
  max-width: calc(32rem + var(--dock-space-left, 0px) + var(--dock-space-right, 0px));
}

.content-column.is-wide {
  max-width: none;
  width: 100%;
}

/* layoutMode "single": one centred column of at most ~520 px */
.content-column.is-single {
  max-width: calc(520px + var(--dock-space-left, 0px) + var(--dock-space-right, 0px));
}

.pages-track {
  --page-ease: cubic-bezier(0.32, 0.72, 0, 1);
  display: flex;
  height: 100%;
  transform: translate3d(calc(var(--start) * -100% / var(--n) + var(--drag, 0px)), 0, 0);
  transition: transform 0.45s var(--page-ease);
  will-change: transform;
}

.pages-track.is-dragging {
  transition: none;
}

/* .page.wide-page: must beat the absolutely positioned single .page below */
.page.wide-page {
  position: relative;
  inset: auto;
  flex: 0 0 calc(100% / var(--n));
  height: 100%;
  transform: none;
  transition: none;
}

.dashboard-shell.is-dark {
  --shell-bg: #0e1014;
}

.pages-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* The tile grid (PageGrid.vue) sizes its square cells from this container. */
.page {
  container-type: inline-size;
}

.page {
  --page-ease: cubic-bezier(0.32, 0.72, 0, 1);
  position: absolute;
  inset: 0;
  padding: 0 1rem;
  overflow-y: auto;
  transform: translate3d(var(--drag, 0px), 0, 0);
  transition: transform 0.45s var(--page-ease);
  will-change: transform;
}

.page.is-dragging {
  transition: none;
}

.page.page-next-enter-active,
.page.page-next-leave-active,
.page.page-prev-enter-active,
.page.page-prev-leave-active {
  transition:
    transform 0.5s var(--page-ease),
    opacity 0.5s var(--page-ease);
}

.page-next-enter-from {
  transform: translate3d(calc(100% + var(--release, 0px)), 0, 0);
}
.page-next-leave-to {
  transform: translate3d(-100%, 0, 0);
  opacity: 0.4;
}
.page-prev-enter-from {
  transform: translate3d(calc(-100% + var(--release, 0px)), 0, 0);
}
.page-prev-leave-to {
  transform: translate3d(100%, 0, 0);
  opacity: 0.4;
}

.standby-enter-active {
  transition: opacity 1.2s ease;
}
.standby-leave-active {
  transition: opacity 0.45s ease;
}
.standby-enter-from,
.standby-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .pages-track {
    transition: none;
  }
  .page,
  .page-next-enter-active,
  .page-next-leave-active,
  .page-prev-enter-active,
  .page-prev-leave-active {
    transition: opacity 0.2s ease;
    transform: none;
  }
}

</style>
