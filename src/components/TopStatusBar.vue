<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Wifi } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { playTick } from '@/composables/useSound'
import WifiModal from './WifiModal.vue'

const props = defineProps({
  temperatureEntity: { type: String, default: null },
  humidityEntity: { type: String, default: null },
})

const { status, getEntityState } = useHomeAssistant()
const { guestInfo } = useGuestConfig()
const wifiOpen = ref(false)

const now = ref(new Date())
let clockTimer = null

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})

const timeStr = computed(() =>
  now.value.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
)

const dateStr = computed(() =>
  now.value.toLocaleDateString('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }),
)

const temp = computed(() => {
  const e = props.temperatureEntity ? getEntityState(props.temperatureEntity) : null
  if (!e) return null
  const n = parseFloat(e.state)
  return Number.isFinite(n) ? n.toFixed(1) : null
})

const humidity = computed(() => {
  const e = props.humidityEntity ? getEntityState(props.humidityEntity) : null
  if (!e) return null
  const n = parseFloat(e.state)
  return Number.isFinite(n) ? Math.round(n) : null
})

const statusMeta = computed(() => {
  const s = status.value
  if (s === 'connected') return { color: 'status-success', label: 'Live', badge: 'badge-success' }
  if (s === 'mock') return { color: 'status-warning', label: 'Mock', badge: 'badge-warning' }
  if (s === 'connecting') return { color: 'status-info', label: '…', badge: 'badge-info' }
  return { color: 'status-error', label: 'Offline', badge: 'badge-error' }
})

function openWifi() {
  playTick('soft')
  wifiOpen.value = true
}
</script>

<template>
  <div class="navbar bg-base-100 rounded-box shadow-none px-3 min-h-0 py-2">
    <div class="navbar-start min-w-0 flex-1">
      <div class="min-w-0">
        <div class="flex items-baseline gap-2">
          <span class="text-3xl font-semibold tracking-tight tabular-nums leading-none">{{ timeStr }}</span>
          <span class="text-sm text-base-content/40 capitalize truncate">{{ dateStr }}</span>
        </div>
        <div class="mt-1.5 flex items-center gap-2 text-xs">
          <span class="badge badge-soft badge-sm gap-1.5" :class="statusMeta.badge">
            <span class="status status-sm" :class="statusMeta.color" />
            {{ statusMeta.label }}
          </span>
          <span v-if="temp != null" class="tabular-nums text-base-content/70">{{ temp }}°</span>
          <span v-if="humidity != null" class="tabular-nums text-base-content/40">{{ humidity }}%</span>
        </div>
      </div>
    </div>

    <div class="navbar-end shrink-0">
      <button type="button" class="btn btn-sm gap-2 shadow-none bg-base-100 border-0" @click="openWifi">
        <Wifi :size="16" class="text-primary" />
        Wi-Fi
      </button>
    </div>

    <WifiModal
      :open="wifiOpen"
      :ssid="guestInfo.wifiSsid"
      :password="guestInfo.wifiPassword"
      :security="guestInfo.wifiSecurity"
      @close="wifiOpen = false"
    />
  </div>
</template>
