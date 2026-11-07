<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Wifi } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { playTick } from '@/composables/useSound'
import { useWeather } from '@/composables/useWeather'
import { translateWeather } from '@/i18n/messages'
import WifiModal from './WifiModal.vue'

/**
 * One header surface:
 *   row 1 (general.showTopBar)   time + date, on the right the Wi-Fi button and,
 *                                only when the connection is not healthy, a status badge
 *   block 2 (general.showWelcome) greeting with the HA user's first name, the big
 *                                outside temperature, condition and humidity on one line
 * Switched-off parts leave no gap; with everything off nothing is rendered.
 */
const { status, userName } = useHomeAssistant()
const weather = useWeather()
const { guestInfo, general } = useGuestConfig()
const { t, lang, locale } = useI18n()
const wifiOpen = ref(false)

const now = ref(new Date())
let clockTimer = null
onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})
onUnmounted(() => clearInterval(clockTimer))

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

/** Only shown when something is wrong — a healthy connection needs no badge. */
const statusMeta = computed(() => {
  const s = status.value
  if (s === 'connected') return null
  if (s === 'mock') {
    // Public demo build (VITE_MODE=mock) says "Demo"; local mock runs keep "Mock".
    const label = import.meta.env.VITE_MODE === 'mock' ? t('demo') : t('mock')
    return { color: 'status-warning', label, badge: 'badge-warning' }
  }
  if (s === 'connecting') return { color: 'status-info', label: '…', badge: 'badge-info' }
  return { color: 'status-error', label: t('offline'), badge: 'badge-error' }
})

const greeting = computed(() => {
  const h = now.value.getHours()
  const key =
    h >= 5 && h < 11 ? 'greetMorning' : h < 18 && h >= 11 ? 'greetDay' : h >= 18 && h < 22 ? 'greetEvening' : 'greetNight'
  const name = String(userName.value || '').trim().split(/\s+/)[0]
  return name ? `${t(key)}, ${name}` : t(key)
})

const temp = computed(() => {
  const v = weather.value?.temperature
  return v == null ? null : Number(v).toLocaleString(locale.value, { maximumFractionDigits: 1 })
})
const humidity = computed(() => {
  const v = weather.value?.humidity
  return v == null ? null : Math.round(v)
})
const condition = computed(() => (weather.value?.condition ? translateWeather(lang.value, weather.value.condition) : ''))

const showTime = computed(() => general.value.showTime)
const showDate = computed(() => general.value.showDate)
const showWifi = computed(() => general.value.showWifi)
const clockRow = computed(
  () => general.value.showTopBar && (showTime.value || showDate.value || showWifi.value || statusMeta.value),
)

const showTemp = computed(() => general.value.showTemperature && temp.value != null)
const showHumidity = computed(() => general.value.showHumidity && humidity.value != null)
const weatherLine = computed(() => Boolean(condition.value) || showHumidity.value)
const welcome = computed(() => general.value.showWelcome)

function openWifi() {
  playTick('soft')
  wifiOpen.value = true
}
</script>

<template>
  <header v-if="clockRow || welcome" class="header-card squircle bg-base-100" :class="{ 'has-welcome': welcome }">
    <div v-if="clockRow" class="clock-row">
      <p v-if="showTime || showDate" class="clock">
        <span v-if="showTime" class="time tabular-nums">{{ timeStr }}</span>
        <span v-if="showDate" class="date">{{ dateStr }}</span>
      </p>
      <div class="clock-side">
        <span v-if="statusMeta" class="badge badge-soft badge-sm gap-1.5" :class="statusMeta.badge">
          <span class="status status-sm" :class="statusMeta.color" />
          {{ statusMeta.label }}
        </span>
        <button
          v-if="showWifi"
          type="button"
          class="wifi-btn btn btn-ghost btn-circle btn-sm"
          :aria-label="t('wifi')"
          :title="t('wifi')"
          @click="openWifi"
        >
          <Wifi :size="18" class="text-primary" />
        </button>
      </div>
    </div>

    <div v-if="welcome" class="welcome" :class="{ 'mt-4': clockRow }">
      <p class="greeting">{{ greeting }}</p>
      <div v-if="showTemp || weatherLine" class="weather">
        <span v-if="showTemp" class="big-temp tabular-nums">{{ temp }}°</span>
        <p v-if="weatherLine" class="wx-line">
          <span v-if="condition" class="wx-cond">{{ condition }}</span>
          <span v-if="condition && showHumidity" aria-hidden="true">·</span>
          <span v-if="showHumidity" class="tabular-nums">{{ t('humidity') }} {{ humidity }} %</span>
        </p>
      </div>
    </div>

    <WifiModal
      :open="wifiOpen"
      :ssid="guestInfo.wifiSsid"
      :password="guestInfo.wifiPassword"
      :security="guestInfo.wifiSecurity"
      @close="wifiOpen = false"
    />
  </header>
</template>

<style scoped>
/*
 * Concentric layout: the surface sits 16px from the screen edge, so its corner
 * radius is smaller than the display's, and the padding is at least ~0.6 × the
 * radius so text never crowds the curve.
 */
.header-card {
  --bar-radius: 30px;
  border-radius: var(--bar-radius);
  padding: 18px 14px 18px 22px;
  color: var(--color-base-content);
}

.header-card.has-welcome {
  padding-bottom: 20px;
}

.clock-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}

.clock {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.time {
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1;
}

.date {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  text-transform: capitalize;
  color: color-mix(in srgb, var(--color-base-content) 45%, transparent);
}

.clock-side {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

.wifi-btn {
  box-shadow: none;
}

.welcome {
  animation: welcome-in 0.6s cubic-bezier(0.2, 0.9, 0.25, 1) both;
}

.greeting {
  font-size: 19px;
  letter-spacing: -0.01em;
  color: color-mix(in srgb, var(--color-base-content) 62%, transparent);
}

.weather {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 4px;
  margin-top: 4px;
}

.big-temp {
  font-size: 64px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.045em;
}

.wx-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 15px;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

.wx-cond {
  font-weight: 550;
  color: var(--color-base-content);
}

@keyframes welcome-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome {
    animation: none;
  }
}
</style>
