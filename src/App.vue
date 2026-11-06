<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { useWakeLock } from '@/composables/useWakeLock'
import { unlockAudio } from '@/composables/useSound'

import HaLogin from '@/components/HaLogin.vue'
import TopStatusBar from '@/components/TopStatusBar.vue'
import SceneBar from '@/components/SceneBar.vue'
import LightTile from '@/components/LightTile.vue'
import ClimateTile from '@/components/ClimateTile.vue'
import SwitchTile from '@/components/SwitchTile.vue'
import CoverTile from '@/components/CoverTile.vue'
import LiquidGlassDock from '@/components/LiquidGlassDock.vue'

const { status } = useHomeAssistant()
const { guestInfo, rooms, dock, appearance, themeMode } = useGuestConfig()
const { t } = useI18n()
useWakeLock()

const activeRoomId = ref(rooms.value[0]?.id)

/** Dock entries resolved to rooms (max 4). Fallback: first 4 rooms. */
const dockItems = computed(() => {
  const list = rooms.value || []
  const configured = (dock.value || []).filter((d) => d?.roomId).slice(0, 4)
  if (configured.length) {
    return configured
      .map((d) => {
        const room = list.find((r) => r.id === d.roomId)
        if (!room) return null
        const label =
          d.showLabel === false ? '' : String(d.label || room.label || room.id).trim()
        return {
          id: room.id,
          label,
          showLabel: d.showLabel !== false && Boolean(label),
          icon: d.icon || room.icon || 'Home',
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

function selectRoom(id) {
  if (!id || id === activeRoomId.value) return
  unlockAudio()
  activeRoomId.value = id
}

function roomIndex() {
  return rooms.value.findIndex((r) => r.id === activeRoomId.value)
}

function goRoomDelta(delta) {
  const list = rooms.value
  if (!list.length) return
  let idx = roomIndex()
  if (idx < 0) idx = 0
  const next = Math.max(0, Math.min(list.length - 1, idx + delta))
  if (list[next]) selectRoom(list[next].id)
}

/* Horizontal swipe between room cards */
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
  // Require clear horizontal swipe (not a vertical scroll)
  if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return
  if (dx < 0) goRoomDelta(1)
  else goRoomDelta(-1)
}

function onPointerCancel() {
  swipe.value.active = false
}

watch(
  rooms,
  (list) => {
    if (!list?.length) return
    if (!list.some((r) => r.id === activeRoomId.value)) {
      activeRoomId.value = list[0].id
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

const activeRoom = computed(
  () => rooms.value.find((r) => r.id === activeRoomId.value) || rooms.value[0],
)

const showLogin = computed(() => {
  if (status.value === 'login') return true
  if (status.value === 'need_url') return true
  return false
})

const isPreview = computed(() => {
  try {
    return new URLSearchParams(window.location.search).get('preview') === '1'
  } catch {
    return false
  }
})

const showBootSplash = computed(() => {
  if (isPreview.value) return false
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
  <div
    v-if="isPreview && showLogin"
    class="dashboard-shell grid place-items-center h-full text-base-content/60 text-sm p-6 text-center"
  >
    {{ t('previewLoginHint') }}
  </div>

  <HaLogin v-else-if="showLogin" />

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
      <p class="text-[11px] uppercase tracking-[0.18em] text-base-content/40 mb-1">
        {{ guestInfo.welcomeTitle }}
      </p>

      <h1 class="text-2xl leading-tight tracking-tight mb-3">
        Smart <span class="font-bold">Guest Home</span>
        <span class="font-normal text-base-content/50"> {{ t('controllerSuffix') }}</span>
      </h1>

      <TopStatusBar
        :temperature-entity="activeRoom?.temperatureEntity"
        :humidity-entity="activeRoom?.humidityEntity"
      />

      <div class="mt-4">
        <SceneBar />
      </div>

      <div
        data-dashboard-scroll
        class="mt-4 flex-1 overflow-y-auto no-scrollbar overscroll-contain"
      >
        <div class="grid grid-cols-2 gap-3 pb-[120px]">
          <template v-for="device in activeRoom?.devices || []" :key="device.id || device.label">
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

    <LiquidGlassDock v-model="activeRoomId" :items="dockItems" />
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
