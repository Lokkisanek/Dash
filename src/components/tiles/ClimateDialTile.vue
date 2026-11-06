<script setup>
import { computed, ref } from 'vue'
import { Flame, Power, Snowflake, Thermometer } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio, playTick } from '@/composables/useSound'

/** Semicircular thermostat dial: drag anywhere on the arc to set the target. */
const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
})

const { getEntityState, setClimateTemp, setClimatePower } = useHomeAssistant()
const { t, locale } = useI18n()

const W = 320
const H = 186
const CX = W / 2
const CY = 170
const TICKS = 56
const R_IN = 116
const R_OUT = 150
const R_DOTS = 94

const entity = computed(() => getEntityState(props.entityId))
const attrs = computed(() => entity.value?.attributes || {})
const isOff = computed(() => entity.value?.state === 'off')
const min = computed(() => Number(attrs.value.min_temp ?? 10))
const max = computed(() => Number(attrs.value.max_temp ?? 30))
const step = computed(() => Number(attrs.value.target_temp_step ?? 0.5))
const current = computed(() => {
  const c = parseFloat(attrs.value.current_temperature)
  return Number.isFinite(c) ? c : null
})
const remoteTarget = computed(() => {
  const v = parseFloat(attrs.value.temperature)
  return Number.isFinite(v) ? v : (min.value + max.value) / 2
})

const local = ref(null)
const target = computed(() => local.value ?? remoteTarget.value)
const fraction = computed(() =>
  Math.max(0, Math.min(1, (target.value - min.value) / (max.value - min.value || 1))),
)

const cooling = computed(() => {
  const a = attrs.value.hvac_action
  return a === 'cooling' || (!a && entity.value?.state === 'cool')
})
const HeaderIcon = computed(() => (cooling.value ? Snowflake : entity.value?.state === 'heat' ? Flame : Thermometer))
const actionLabel = computed(() => {
  if (isOff.value) return t('climateOff')
  const a = attrs.value.hvac_action
  if (a === 'heating') return t('climateHeating')
  if (a === 'cooling') return t('climateCooling')
  return t('climateIdle')
})

const fmt = (n, digits = 0) =>
  Number(n).toLocaleString(locale.value, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const targetDigits = computed(() => (Number.isInteger(target.value) ? 0 : 1))

function polar(r, f) {
  const a = Math.PI * (1 - f)
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) }
}

const ticks = computed(() =>
  Array.from({ length: TICKS }, (_, i) => {
    const f = i / (TICKS - 1)
    const a = polar(R_IN, f)
    const b = polar(R_OUT, f)
    const active = !isOff.value && f <= fraction.value + 1e-6
    // Darker at the cold end, lighter towards the knob
    const mix = 100 - Math.round((f / Math.max(fraction.value, 0.01)) * 55)
    return { a, b, active, mix }
  }),
)

const dots = Array.from({ length: 46 }, (_, i) => polar(R_DOTS, i / 45))

const knob = computed(() => ({ a: polar(R_IN - 6, fraction.value), b: polar(R_OUT + 8, fraction.value), c: polar(R_OUT + 14, fraction.value) }))
const minPos = polar(R_DOTS - 22, 0.02)
const maxPos = polar(R_DOTS - 22, 0.98)
const midTick = { a: polar(R_DOTS - 6, 0.5), b: polar(R_DOTS + 6, 0.5) }

const svgEl = ref(null)
let dragging = false

function valueAt(e) {
  const rect = svgEl.value.getBoundingClientRect()
  const scale = Math.min(rect.width / W, rect.height / H)
  const offX = (rect.width - W * scale) / 2
  const offY = rect.height - H * scale
  const x = (e.clientX - rect.left - offX) / scale
  const y = (e.clientY - rect.top - offY) / scale
  const angle = Math.atan2(CY - y, x - CX)
  const clamped = Math.max(0, Math.min(Math.PI, angle < -Math.PI / 2 ? Math.PI : angle < 0 ? 0 : angle))
  const f = 1 - clamped / Math.PI
  const raw = min.value + f * (max.value - min.value)
  return Math.round(raw / step.value) * step.value
}

function onDown(e) {
  if (isOff.value) return
  unlockAudio()
  dragging = true
  svgEl.value.setPointerCapture?.(e.pointerId)
  local.value = valueAt(e)
}

function onMove(e) {
  if (!dragging) return
  const v = valueAt(e)
  if (v !== local.value) {
    local.value = v
    playTick('soft')
  }
}

async function onUp() {
  if (!dragging) return
  dragging = false
  const v = local.value
  if (v != null && v !== remoteTarget.value) await setClimateTemp(props.entityId, v)
  setTimeout(() => {
    local.value = null
  }, 900)
}

async function togglePower() {
  unlockAudio()
  await setClimatePower(props.entityId, isOff.value)
}
</script>

<template>
  <div class="dial-tile squircle" :class="{ 'is-cool': cooling, 'is-off': isOff }">
    <div class="dial-head">
      <component :is="HeaderIcon" :size="30" :stroke-width="1.6" class="shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="dial-name truncate">{{ label }}</p>
        <p class="dial-sub truncate">
          {{ actionLabel }}<template v-if="current != null"> · {{ t('climateNow') }} {{ fmt(current, 1) }}°</template>
        </p>
      </div>
      <button type="button" class="power-pill" :aria-pressed="!isOff" @click="togglePower">
        <span class="power-text">{{ isOff ? t('offShort') : t('onShort') }}</span>
        <span class="power-dot" />
        <span class="power-btn"><Power :size="18" :stroke-width="2.4" /></span>
      </button>
    </div>

    <svg
      ref="svgEl"
      data-no-swipe
      class="dial-svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMidYMax meet"
      role="slider"
      :aria-label="`${t('temperature')} ${label}`"
      :aria-valuenow="target"
      :aria-valuemin="min"
      :aria-valuemax="max"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <line
        v-for="(tk, i) in ticks"
        :key="i"
        :x1="tk.a.x"
        :y1="tk.a.y"
        :x2="tk.b.x"
        :y2="tk.b.y"
        stroke-width="3.2"
        stroke-linecap="round"
        :style="{
          stroke: tk.active
            ? `color-mix(in srgb, var(--dial-color) ${tk.mix}%, white)`
            : 'color-mix(in srgb, var(--color-base-content) 16%, transparent)',
        }"
      />
      <circle v-for="(d, i) in dots" :key="`d${i}`" :cx="d.x" :cy="d.y" r="1.5" class="dial-dot" />
      <line :x1="midTick.a.x" :y1="midTick.a.y" :x2="midTick.b.x" :y2="midTick.b.y" class="dial-mark" />

      <g v-if="!isOff" class="dial-knob">
        <line :x1="knob.a.x" :y1="knob.a.y" :x2="knob.b.x" :y2="knob.b.y" stroke-width="4" stroke-linecap="round" />
        <circle :cx="knob.c.x" :cy="knob.c.y" r="7" stroke-width="3.5" />
      </g>

      <text :x="minPos.x + 6" :y="CY - 2" class="dial-minmax" text-anchor="start">{{ fmt(min) }}°</text>
      <text :x="maxPos.x - 6" :y="CY - 2" class="dial-minmax" text-anchor="end">{{ fmt(max) }}°</text>
      <text :x="CX" :y="CY - R_DOTS + 22" class="dial-minmax" text-anchor="middle">{{ fmt((min + max) / 2) }}°</text>

      <text :x="CX" :y="CY - 24" class="dial-temp" text-anchor="middle">{{ fmt(target, targetDigits) }}°</text>
      <text :x="CX" :y="CY - 2" class="dial-caption" text-anchor="middle">{{ t('temperature') }}</text>
    </svg>
  </div>
</template>

<style scoped>
.dial-tile {
  --dial-color: var(--color-primary);
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 18px 10px 20px;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-base-content);
  user-select: none;
}

.dial-tile.is-cool {
  --dial-color: #4f5bd5;
}

.dial-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dial-name {
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.dial-sub {
  font-size: 13px;
  color: color-mix(in srgb, var(--color-base-content) 48%, transparent);
}

.power-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 4px 4px 12px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-base-content) 7%, transparent);
  color: var(--color-base-content);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 160ms ease;
}

.power-pill:active {
  transform: scale(0.95);
}

.power-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}

.power-btn {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--color-base-content);
  color: var(--color-base-100);
  transition: background 220ms ease, color 220ms ease;
}

.is-off .power-btn {
  background: var(--color-base-100);
  color: var(--color-base-content);
}

.dial-svg {
  flex: 1;
  min-height: 0;
  width: 100%;
  touch-action: none;
  cursor: pointer;
  overflow: visible;
}

.dial-svg line {
  transition: stroke 200ms ease;
}

.dial-dot {
  fill: color-mix(in srgb, var(--dial-color) 70%, transparent);
}

.is-off .dial-dot {
  fill: color-mix(in srgb, var(--color-base-content) 20%, transparent);
}

.dial-mark {
  stroke: var(--dial-color);
  stroke-width: 2;
}

.dial-knob line {
  stroke: var(--dial-color);
}

.dial-knob circle {
  fill: var(--color-base-100);
  stroke: var(--dial-color);
}

.dial-minmax {
  font-size: 13px;
  font-weight: 500;
  fill: var(--color-base-content);
}

.dial-temp {
  font-size: 56px;
  font-weight: 500;
  letter-spacing: -0.04em;
  fill: var(--color-base-content);
}

.dial-caption {
  font-size: 13px;
  fill: color-mix(in srgb, var(--color-base-content) 45%, transparent);
}
</style>
