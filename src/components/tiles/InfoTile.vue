<script setup>
import { ref, computed } from 'vue'
import { Wifi } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { useClock, greetingText } from '@/composables/useClock'
import { useWeather } from '@/composables/useWeather'
import { playTick } from '@/composables/useSound'
import { translateWeather } from '@/i18n/messages'
import { resolveIcon } from '@/lib/icons'
import WifiModal from '../WifiModal.vue'

/**
 * Header-family tiles: `header` (clock row, greeting, weather), `clock`,
 * `greeting` and `weather`, each in several styles (shared/tiles.json):
 *   card        the tile surface, like every other tile
 *   plain       no surface: text straight on the wallpaper (`contrast` auto | light | dark)
 *   lockscreen  small date over a very large thin time, no surface
 *   compact     one line: "21:45 · Pá 7. 11. · 12° Polojasno", no surface
 *   glass       the dock's translucent material
 * Time comes from one shared ticker, weather from one shared source.
 */
const props = defineProps({
  device: { type: Object, required: true },
  kind: { type: String, required: true },
  variant: { type: String, default: 'card' },
  cols: { type: Number, default: 4 },
  rows: { type: Number, default: 2 },
})

const { userName } = useHomeAssistant()
const { guestInfo } = useGuestConfig()
const { t, lang, locale } = useI18n()
const { now, time, date, longDate } = useClock()
const weather = useWeather(() => props.device.entity || '')
const wifiOpen = ref(false)

const opt = (key, fallback = true) => (typeof props.device[key] === 'boolean' ? props.device[key] : fallback)

const isHeader = computed(() => props.kind === 'header')
const showTime = computed(() => (isHeader.value ? opt('showTime') : props.kind === 'clock'))
const showDate = computed(() => (isHeader.value || props.kind === 'clock' ? opt('showDate') : false))
const showGreeting = computed(() => (isHeader.value ? opt('showGreeting') : props.kind === 'greeting'))
const showWeather = computed(() => (isHeader.value ? opt('showWeather') : props.kind === 'weather'))
const showTemp = computed(() => (isHeader.value ? opt('showTemperature') : true))
const showHumidity = computed(() => (isHeader.value || props.kind === 'weather' ? opt('showHumidity') : false))
const showWifi = computed(() => isHeader.value && opt('showWifi', false))

const greeting = computed(() => greetingText(t, now.value.getHours(), userName.value))

const temp = computed(() => {
  const v = weather.value?.temperature
  return v == null ? null : Number(v).toLocaleString(locale.value, { maximumFractionDigits: 1 })
})
const humidity = computed(() => {
  const v = weather.value?.humidity
  return v == null ? null : Math.round(v)
})
const condition = computed(() => (weather.value?.condition ? translateWeather(lang.value, weather.value.condition) : ''))

const WX_ICON = {
  'clear-night': 'Moon',
  cloudy: 'Cloud',
  exceptional: 'Info',
  fog: 'CloudFog',
  hail: 'CloudHail',
  lightning: 'CloudLightning',
  'lightning-rainy': 'CloudLightning',
  partlycloudy: 'CloudSun',
  pouring: 'CloudRain',
  rainy: 'CloudRain',
  snowy: 'CloudSnow',
  'snowy-rainy': 'CloudSnow',
  sunny: 'Sun',
  windy: 'Wind',
  'windy-variant': 'Wind',
}
const wxIcon = computed(() => resolveIcon(WX_ICON[weather.value?.condition] || 'CloudSun'))

/** "12° Polojasno · Vlhkost 71 %" pieces, "—" when nothing is known. */
const tempText = computed(() => (temp.value == null ? '—' : `${temp.value}°`))
const wxDetail = computed(() => {
  const parts = []
  if (condition.value) parts.push(condition.value)
  if (showHumidity.value && humidity.value != null) parts.push(`${t('humidity')} ${humidity.value} %`)
  return parts.join(' · ')
})

/**
 * Compact style: the time always leads (it is what the line is for; the
 * showTime switch applies to the other styles only), then date, greeting and
 * weather. On a narrow tile the rest is cut with an ellipsis, never the time.
 */
const compactTime = computed(() => (isHeader.value || props.kind === 'clock' ? time.value : ''))
const compactLine = computed(() => {
  const parts = []
  if (showDate.value) parts.push(date.value)
  if (props.kind === 'greeting') parts.push(greeting.value)
  if (showWeather.value) {
    const wx = [showTemp.value ? tempText.value : '', condition.value].filter(Boolean).join(' ')
    if (wx) parts.push(wx)
    if (props.kind === 'weather' && showHumidity.value && humidity.value != null) parts.push(`${humidity.value} %`)
  }
  return parts.join(' · ')
})

const surface = computed(() => ['card', 'glass'].includes(props.variant))
const contrast = computed(() => (surface.value ? 'auto' : props.device.contrast || 'auto'))
const big = computed(() => props.rows >= 3)
const tiny = computed(() => props.cols === 1 && props.rows === 1)
const narrow = computed(() => props.cols <= 2)

function openWifi() {
  playTick('soft')
  wifiOpen.value = true
}
</script>

<template>
  <section
    class="info-tile"
    :class="[
      `v-${variant}`,
      `k-${kind}`,
      `contrast-${contrast}`,
      { squircle: surface, 'is-big': big, 'is-tiny': tiny, 'is-narrow': narrow, 'is-row': rows === 1 },
    ]"
    :data-info="kind"
    :data-variant="variant"
  >
    <!-- compact: one line, no surface -->
    <p v-if="variant === 'compact'" class="compact-line tabular-nums">
      <span v-if="compactTime" class="compact-time" data-compact-time>{{ compactTime }}</span>
      <span v-if="compactTime && compactLine" class="compact-sep" aria-hidden="true">·</span>
      <span class="compact-text">{{ compactLine }}</span>
      <button v-if="showWifi" type="button" class="wifi-btn" :aria-label="t('wifi')" :title="t('wifi')" @click="openWifi">
        <Wifi :size="18" />
      </button>
    </p>

    <!-- lockscreen: small date, very large thin time -->
    <div v-else-if="variant === 'lockscreen'" class="lock">
      <p v-if="showDate" class="lock-date">{{ longDate }}</p>
      <p v-if="showTime" class="lock-time tabular-nums">{{ time }}</p>
      <p v-if="showGreeting || showWeather" class="lock-line tabular-nums">
        <span v-if="showGreeting">{{ greeting }}</span>
        <span v-if="showGreeting && showWeather" aria-hidden="true"> · </span>
        <span v-if="showWeather">{{ [showTemp ? tempText : '', condition].filter(Boolean).join(' ') }}</span>
      </p>
      <button v-if="showWifi" type="button" class="wifi-btn lock-wifi" :aria-label="t('wifi')" :title="t('wifi')" @click="openWifi">
        <Wifi :size="18" />
      </button>
    </div>

    <!-- weather on its own -->
    <div v-else-if="kind === 'weather'" class="wx-tile">
      <component :is="wxIcon" class="wx-icon" :size="tiny ? 22 : 26" aria-hidden="true" />
      <p class="wx-temp tabular-nums">{{ tempText }}</p>
      <p v-if="!tiny && wxDetail" class="wx-detail">{{ wxDetail }}</p>
    </div>

    <!-- greeting on its own -->
    <p v-else-if="kind === 'greeting'" class="greet-only">{{ greeting }}</p>

    <!-- clock on its own -->
    <div v-else-if="kind === 'clock'" class="clock-only">
      <span class="clock-time tabular-nums">{{ time }}</span>
      <span v-if="showDate" class="clock-date">{{ date }}</span>
    </div>

    <!-- header: clock row, greeting, weather -->
    <div v-else class="header">
      <div v-if="showTime || showDate || showWifi" class="clock-row">
        <p class="clock">
          <span v-if="showTime" class="time tabular-nums">{{ time }}</span>
          <span v-if="showDate" class="date">{{ date }}</span>
        </p>
        <button v-if="showWifi" type="button" class="wifi-btn" :aria-label="t('wifi')" :title="t('wifi')" @click="openWifi">
          <Wifi :size="18" />
        </button>
      </div>
      <div v-if="showGreeting || showWeather" class="welcome">
        <p v-if="showGreeting" class="greeting">{{ greeting }}</p>
        <div v-if="showWeather" class="weather">
          <span v-if="showTemp" class="big-temp tabular-nums">{{ tempText }}</span>
          <p v-if="wxDetail" class="wx-line">{{ wxDetail }}</p>
        </div>
      </div>
    </div>

    <WifiModal
      v-if="showWifi"
      :open="wifiOpen"
      :ssid="guestInfo.wifiSsid"
      :password="guestInfo.wifiPassword"
      :security="guestInfo.wifiSecurity"
      @close="wifiOpen = false"
    />
  </section>
</template>

<style scoped>
.info-tile {
  --ink: var(--color-base-content);
  --ink-soft: color-mix(in srgb, var(--ink) 58%, transparent);
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  color: var(--ink);
  overflow: hidden;
}

/* Text straight on the wallpaper: the owner can force white or dark text over a photo. */
.contrast-light {
  --ink: #ffffff;
}
.contrast-dark {
  --ink: #141414;
}

.v-card {
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  padding: 16px 18px;
}

/* Same material as the dock (tokens in style.css). */
.v-glass {
  border-radius: var(--radius-box);
  background: var(--glass-bg);
  border: var(--glass-border);
  box-shadow: var(--glass-shadow);
  backdrop-filter: var(--glass-filter);
  -webkit-backdrop-filter: var(--glass-filter);
  padding: 16px 18px;
}

.v-plain,
.v-lockscreen,
.v-compact {
  padding: 4px 4px;
}

.is-tiny.v-card,
.is-tiny.v-glass {
  padding: 10px;
}

/* ── header ─────────────────────────────────────────── */
.header {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  height: 100%;
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

.date,
.clock-date {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  text-transform: capitalize;
  color: var(--ink-soft);
}

.greeting,
.greet-only {
  font-size: 19px;
  letter-spacing: -0.01em;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.greet-only {
  font-size: 20px;
  color: var(--ink);
  font-weight: 550;
}

.weather {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  column-gap: 14px;
  row-gap: 2px;
  margin-top: 2px;
}

.big-temp {
  font-size: 48px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.045em;
}

.is-big .big-temp {
  font-size: 64px;
}

.wx-line {
  min-width: 0;
  font-size: 15px;
  color: var(--ink-soft);
}

/* ── clock ──────────────────────────────────────────── */
.clock-only {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.clock-time {
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1;
}

.is-narrow .clock-only {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.is-narrow .clock-time {
  font-size: 1.6rem;
}

.k-clock:not(.is-row) .clock-only {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.k-clock:not(.is-row):not(.is-narrow) .clock-time {
  font-size: 56px;
  font-weight: 300;
  letter-spacing: -0.04em;
}

/* ── lockscreen ─────────────────────────────────────── */
.lock {
  display: grid;
  justify-items: center;
  align-content: center;
  text-align: center;
  height: 100%;
  gap: 2px;
}

.lock-date {
  font-size: 17px;
  font-weight: 550;
}

/* "Sobota 7. listopadu": only the first letter, Czech month names stay lower case */
.lock-date::first-letter {
  text-transform: uppercase;
}

.lock-time {
  font-size: 76px;
  font-weight: 250;
  line-height: 0.95;
  letter-spacing: -0.03em;
}

.is-big .lock-time {
  font-size: 96px;
}

.lock-line {
  margin-top: 6px;
  font-size: 15px;
  color: var(--ink-soft);
}

.lock-wifi {
  position: absolute;
  bottom: 2px;
  right: 2px;
}

/* ── compact ────────────────────────────────────────── */
.compact-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 17px;
  font-weight: 550;
}

.compact-line {
  gap: 0;
}

.compact-time {
  flex: none;
}

.compact-sep {
  flex: none;
  padding: 0 0.4em;
}

.compact-line .wifi-btn {
  margin-left: 10px;
}

.compact-text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── weather ────────────────────────────────────────── */
.wx-tile {
  display: grid;
  align-content: center;
  gap: 4px;
  min-width: 0;
}

.wx-icon {
  color: var(--ink-soft);
}

.wx-temp {
  font-size: 40px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.04em;
}

.is-row .wx-tile {
  grid-auto-flow: column;
  justify-content: start;
  align-items: center;
  gap: 10px;
}

.is-row .wx-temp {
  font-size: 28px;
}

.is-tiny .wx-tile {
  justify-items: center;
}

.is-tiny .wx-temp {
  font-size: 24px;
}

.wx-detail {
  font-size: 14px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Wi-Fi button inside the header ─────────────────── */
.wifi-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-left: auto;
  flex-shrink: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
}

.contrast-light .wifi-btn,
.contrast-dark .wifi-btn {
  color: var(--ink);
}
</style>
