<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { useWakeLock } from '@/composables/useWakeLock'
import { unlockAudio } from '@/composables/useSound'

import HaLogin from '@/components/HaLogin.vue'
import TopStatusBar from '@/components/TopStatusBar.vue'
import LightTile from '@/components/LightTile.vue'
import ClimateTile from '@/components/ClimateTile.vue'
import SwitchTile from '@/components/SwitchTile.vue'
import CoverTile from '@/components/CoverTile.vue'
import LiquidGlassDock from '@/components/LiquidGlassDock.vue'

const { status } = useHomeAssistant()
const { pages, dock, appearance, themeMode } = useGuestConfig()
const { t } = useI18n()
useWakeLock()

const activePageId = ref(pages.value[0]?.id)

/** Dock entries resolved to pages (max 4). Fallback: first 4 pages. */
const dockItems = computed(() => {
  const list = pages.value || []
  const configured = (dock.value || []).filter((d) => d?.pageId).slice(0, 4)
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
  return list.slice(0, 4).map((r) => ({
    id: r.id,
    label: r.label || r.id,
    showLabel: true,
    icon: r.icon || 'Home',
  }))
})

/** 'page-next' slides in from the right, 'page-prev' from the left. */
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
  pageTransition.value = indexOf(id) >= indexOf(activePageId.value) ? 'page-next' : 'page-prev'
  releaseX.value = fromX
  activePageId.value = id
}

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
  const blocked = (dx < 0 && !neighbour(1)) || (dx > 0 && !neighbour(-1))
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
  const target = commit ? neighbour(dx < 0 ? 1 : -1) : null
  const offset = dragX.value
  dragX.value = 0
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

  <div
    v-else-if="showBootSplash"
    class="dashboard-shell grid place-items-center h-full text-base-content/50 text-sm"
  >
    {{ t('connecting') }}
  </div>

  <div
    v-else
    class="dashboard-shell relative h-full w-full overflow-hidden text-base-content safe-pad"
    :class="{ 'is-dark': themeMode === 'dark' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @click.capture="onClickCapture"
  >
    <div class="dashboard-orbs" aria-hidden="true">
      <span class="orb o1" />
      <span class="orb o2" />
      <span class="orb o3" />
      <span class="orb o4" />
    </div>

    <div class="relative z-10 flex flex-col h-full px-4 pt-4 max-w-lg mx-auto">
      <TopStatusBar
        :temperature-entity="activePage?.temperatureEntity"
        :humidity-entity="activePage?.humidityEntity"
      />

      <div class="pages-viewport mt-4 -mx-4" :style="{ '--release': `${releaseX}px` }">
        <Transition :name="pageTransition">
          <div
            :key="activePage?.id || 'empty'"
            data-dashboard-scroll
            class="page no-scrollbar overscroll-contain"
            :class="{ 'is-dragging': dragging }"
            :style="{ '--drag': `${dragX}px` }"
          >
            <div class="grid grid-cols-2 gap-3 pb-[120px]">
              <template v-for="device in activePage?.devices || []" :key="device.id || device.label">
            <LightTile
              v-if="device.type === 'light'"
              :entity-id="device.id"
              :label="device.label"
              :supports-brightness="device.supportsBrightness !== false"
            />
            <ClimateTile
              v-else-if="device.type === 'climate'"
              :entity-id="device.id"
              :label="device.label"
            />
            <SwitchTile
              v-else-if="device.type === 'switch'"
              :entity-id="device.id"
              :label="device.label"
              :icon="device.icon || 'Power'"
            />
            <CoverTile
              v-else-if="device.type === 'cover'"
              :entity-id="device.id"
              :label="device.label"
            />
              </template>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <LiquidGlassDock data-no-swipe :model-value="activePageId" :items="dockItems" @update:model-value="selectPage" />
  </div>
</template>

<style scoped>
.dashboard-shell {
  background: #f3f0f7;
  touch-action: pan-y;
}

.dashboard-shell.is-dark {
  background: #0e1014;
}

.pages-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
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

@media (prefers-reduced-motion: reduce) {
  .page,
  .page-next-enter-active,
  .page-next-leave-active,
  .page-prev-enter-active,
  .page-prev-leave-active {
    transition: opacity 0.2s ease;
    transform: none;
  }
}

.dashboard-orbs {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(48px);
  opacity: 0.7;
  mix-blend-mode: multiply;
}

.dashboard-shell.is-dark .orb {
  opacity: 0.45;
  mix-blend-mode: screen;
}

.o1 {
  width: 280px;
  height: 280px;
  top: -8%;
  left: -10%;
  background: #ff8ad0;
}

.o2 {
  width: 320px;
  height: 320px;
  top: 10%;
  right: -16%;
  background: #b08cff;
}

.o3 {
  width: 260px;
  height: 260px;
  bottom: 18%;
  right: 8%;
  background: #ff9a6a;
}

.o4 {
  width: 220px;
  height: 220px;
  bottom: 8%;
  left: -6%;
  background: #ff6eb5;
}
</style>
