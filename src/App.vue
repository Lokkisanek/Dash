<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
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
const { guestInfo, rooms, appearance, themeMode } = useGuestConfig()
useWakeLock()

const activeRoomId = ref(rooms.value[0]?.id)

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

// Only block the UI for real auth gates — never on refresh/reconnect flicker
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

// Preview iframe: never flash reconnect splash — config panel + dashboard stay independent
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
  <!-- Preview iframe: never force full login UI (avoids OAuth loops inside HA panel) -->
  <div
    v-if="isPreview && showLogin"
    class="dashboard-shell grid place-items-center h-full text-base-content/60 text-sm p-6 text-center"
  >
    Nejdřív se přihlas v hlavním okně tabletu / PWA, pak preview ožije.
  </div>

  <HaLogin v-else-if="showLogin" />

  <div
    v-else-if="showBootSplash"
    class="dashboard-shell grid place-items-center h-full text-base-content/50 text-sm"
  >
    Připojuji k Home Assistant…
  </div>

  <div
    v-else
    class="dashboard-shell relative h-full w-full overflow-hidden text-base-content safe-pad"
    :class="{ 'is-dark': themeMode === 'dark' }"
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
        <span class="font-normal text-base-content/50"> Controller</span>
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

    <LiquidGlassDock v-model="activeRoomId" :rooms="rooms" />
  </div>
</template>

<style scoped>
.dashboard-shell {
  background: #f3f0f7;
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
