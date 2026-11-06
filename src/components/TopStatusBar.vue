<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Wifi } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { playTick } from '@/composables/useSound'
import { useWeather } from '@/composables/useWeather'
import WifiModal from './WifiModal.vue'

const { status } = useHomeAssistant()
const weather = useWeather()
const { guestInfo, general } = useGuestConfig()
const { t, locale } = useI18n()
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
  now.value.toLocaleTimeString(locale.value, {
    hour: general.value.use24h ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !general.value.use24h,
  }),
)

const dateStr = computed(() =>
  now.value.toLocaleDateString(locale.value, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }),
)

const temp = computed(() => {
  const n = weather.value?.temperature
  return n == null ? null : Number(n).toLocaleString(locale.value, { maximumFractionDigits: 1 })
})

const humidity = computed(() => {
  const n = weather.value?.humidity
  return n == null ? null : Math.round(n)
})

/** Only shown when something is wrong — a healthy connection needs no badge. */
const statusMeta = computed(() => {
  const s = status.value
  if (s === 'connected') return null
  if (s === 'mock') return { color: 'status-warning', label: t('mock'), badge: 'badge-warning' }
  if (s === 'connecting') return { color: 'status-info', label: '…', badge: 'badge-info' }
  return { color: 'status-error', label: t('offline'), badge: 'badge-error' }
})

const showTemp = computed(() => general.value.showTemperature && temp.value != null)
const showHumidity = computed(() => general.value.showHumidity && humidity.value != null)
const hasMetaRow = computed(() => statusMeta.value || showTemp.value || showHumidity.value)
const hasClockRow = computed(() => general.value.showTime || general.value.showDate)

function openWifi() {
  playTick('soft')
  wifiOpen.value = true
}
</script>

<template>
  <div class="top-bar squircle flex items-center gap-3 bg-base-100 shadow-none">
    <div class="min-w-0 flex-1">
      <div v-if="hasClockRow" class="flex items-baseline gap-2">
        <span
          v-if="general.showTime"
          class="text-[2rem] font-semibold tracking-tight tabular-nums leading-none"
        >{{ timeStr }}</span>
        <span
          v-if="general.showDate"
          class="text-sm text-base-content/40 capitalize truncate"
        >{{ dateStr }}</span>
      </div>
      <div
        v-if="hasMetaRow"
        class="flex items-center gap-2 text-xs"
        :class="{ 'mt-2': hasClockRow }"
      >
        <span v-if="statusMeta" class="badge badge-soft badge-sm gap-1.5" :class="statusMeta.badge">
          <span class="status status-sm" :class="statusMeta.color" />
          {{ statusMeta.label }}
        </span>
        <span v-if="showTemp" class="tabular-nums text-base-content/70">{{ temp }}°</span>
        <span v-if="showHumidity" class="tabular-nums text-base-content/40">{{ humidity }}%</span>
      </div>
    </div>

    <div v-if="general.showWifi" class="shrink-0">
      <button type="button" class="btn btn-sm gap-2 shadow-none bg-base-100 border-0" @click="openWifi">
        <Wifi :size="16" class="text-primary" />
        {{ t('wifi') }}
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

<style scoped>
/*
 * Concentric layout: the bar sits 16px from the screen edge, so its corner
 * radius is smaller than the display's, and the content padding is at least
 * ~0.6 × the radius so text never crowds the curve.
 */
.top-bar {
  --bar-radius: 30px;
  min-height: 0;
  border-radius: var(--bar-radius);
  padding: 18px 16px 18px 22px;
}
</style>
