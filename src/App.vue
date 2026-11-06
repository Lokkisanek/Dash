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

function selectPage(id) {
  if (!id || id === activePageId.value) return
  unlockAudio()
  activePageId.value = id
}

function pageIndex() {
  return pages.value.findIndex((r) => r.id === activePageId.value)
}

function goPageDelta(delta) {
  const list = pages.value
  if (!list.length) return
  let idx = pageIndex()
  if (idx < 0) idx = 0
  const next = Math.max(0, Math.min(list.length - 1, idx + delta))
  if (list[next]) selectPage(list[next].id)
}

const swipe = ref({ x: 0, y: 0, active: false })

function onPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  swipe.value = { x: e.clientX, y: e.clientY, active: true }
}

function onPointerUp(e) {
  if (!swipe.value.active) return
  const dx = e.clientX - swipe.value.x
  const dy = e.clientY - swipe.value.y
  swipe.value.active = false
  if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return
  if (dx < 0) goPageDelta(1)
  else goPageDelta(-1)
}

function onPointerCancel() {
  swipe.value.active = false
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
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <div class="dashboard-orbs" aria-hidden="true">
      <span class="orb o1" />
      <span class="orb o2" />
      <span class="orb o3" />
      <span class="orb o4" />
    </div>

    <div class="relative z-10 flex flex-col h-full px-4 pt-3 max-w-lg mx-auto">
      <TopStatusBar
        :temperature-entity="activePage?.temperatureEntity"
        :humidity-entity="activePage?.humidityEntity"
      />

      <div
        data-dashboard-scroll
        class="mt-4 flex-1 overflow-y-auto no-scrollbar overscroll-contain"
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
    </div>

    <LiquidGlassDock v-model="activePageId" :items="dockItems" />
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
