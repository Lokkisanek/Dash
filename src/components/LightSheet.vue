<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { X, Power } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { lightCaps, allowedCaps, kelvinPresets, SWATCHES, hsToRgb, EFFECT_OFF } from '@/lib/lightCaps'

/**
 * Long-press controls of a light or a dash light group: a bottom sheet on a
 * phone, a centred panel from 768 px. Only what the light supports (and, for
 * a guest, what the profile allows) is shown; nothing is shown disabled.
 * Closes on the backdrop, Esc, the close button and a swipe down on the handle.
 * Focus stays inside while open and returns to the tile afterwards.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  entityId: { type: String, required: true },
  label: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const { getEntityState, callService, setLightBrightness } = useHomeAssistant()
const { capabilities } = useGuestConfig()
const { t } = useI18n()

const entity = computed(() => getEntityState(props.entityId))
const attrs = computed(() => entity.value?.attributes || {})
const caps = computed(() => allowedCaps(lightCaps(entity.value), capabilities.value))
const isOn = computed(() => entity.value?.state === 'on')
const mixed = computed(() => attrs.value.dash_mixed || [])
const members = computed(() => attrs.value.dash_members || null)
const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`

const local = ref({ brightness: null, kelvin: null, hue: null })
const brightness = computed(() => {
  if (local.value.brightness != null) return local.value.brightness
  const b = attrs.value.brightness
  return isOn.value && Number.isFinite(b) ? Math.max(1, Math.round((b / 255) * 100)) : 0
})
const kelvin = computed(() => local.value.kelvin ?? attrs.value.color_temp_kelvin ?? Math.round((caps.value.minK + caps.value.maxK) / 2))
const hue = computed(() => local.value.hue ?? (Array.isArray(attrs.value.hs_color) ? Math.round(attrs.value.hs_color[0]) : 30))
const presets = computed(() => kelvinPresets(caps.value.minK, caps.value.maxK))
const effects = computed(() => caps.value.effectList.filter((e) => e !== EFFECT_OFF))
const ctTrack = computed(() => {
  // data-encoding track: warm (low kelvin) to cool (high kelvin)
  const warm = 'rgb(255, 170, 90)'
  const cool = 'rgb(200, 225, 255)'
  return `linear-gradient(to right, ${warm}, rgb(255, 245, 230), ${cool})`
})
const hueTrack = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'

const timers = {}
function debounce(key, fn, ms = 150) {
  clearTimeout(timers[key])
  timers[key] = setTimeout(fn, ms)
}
function release(key) {
  setTimeout(() => {
    local.value = { ...local.value, [key]: null }
  }, 900)
}

function turnOn(data) {
  return callService('light', 'turn_on', { entity_id: props.entityId, ...data })
}

function onPower() {
  callService('light', isOn.value ? 'turn_off' : 'turn_on', { entity_id: props.entityId })
}

function onBrightness(e, final = false) {
  const pct = Math.max(1, Math.min(100, Number(e.target.value)))
  local.value = { ...local.value, brightness: pct }
  if (final) {
    clearTimeout(timers.brightness)
    setLightBrightness(props.entityId, pct)
    release('brightness')
  } else {
    debounce('brightness', () => setLightBrightness(props.entityId, pct))
  }
}

function setKelvin(k, final = false) {
  local.value = { ...local.value, kelvin: k }
  const send = () => turnOn({ color_temp_kelvin: k })
  if (final) {
    clearTimeout(timers.kelvin)
    send()
    release('kelvin')
  } else debounce('kelvin', send)
}

function setColor(h, s, final = true) {
  local.value = { ...local.value, hue: Math.round(h) }
  const data = caps.value.colorField === 'rgb_color' ? { rgb_color: hsToRgb(h, s) } : { hs_color: [Math.round(h), Math.round(s)] }
  if (final) {
    clearTimeout(timers.hue)
    turnOn(data)
    release('hue')
  } else debounce('hue', () => turnOn(data))
}

function setEffect(effect) {
  turnOn({ effect })
}

// ── sheet behaviour ─────────────────────────────────────────────────────────
const panel = ref(null)
let returnFocus = null

function close() {
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled)
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

// swipe down on the grab handle
let drag = null
const dragY = ref(0)
function onHandleDown(e) {
  drag = { y: e.clientY }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function onHandleMove(e) {
  if (!drag) return
  dragY.value = Math.max(0, e.clientY - drag.y)
}
function onHandleUp() {
  if (!drag) return
  drag = null
  if (dragY.value > 80) close()
  dragY.value = 0
}

watch(
  () => props.open,
  async (open) => {
    document.documentElement.classList.toggle('sheet-open', open)
    if (open) {
      returnFocus = document.activeElement
      await nextTick()
      panel.value?.querySelector('button, input')?.focus()
    } else if (returnFocus?.focus) {
      returnFocus.focus()
      returnFocus = null
    }
  },
)
onUnmounted(() => {
  document.documentElement.classList.remove('sheet-open')
  Object.values(timers).forEach(clearTimeout)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="sheet-backdrop" data-no-swipe @click.self="close" @keydown="onKeydown">
        <div
          ref="panel"
          class="light-sheet squircle"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :style="dragY ? { transform: `translateY(${dragY}px)` } : null"
          data-light-sheet
        >
          <div
            class="grab"
            aria-hidden="true"
            @pointerdown="onHandleDown"
            @pointermove="onHandleMove"
            @pointerup="onHandleUp"
            @pointercancel="onHandleUp"
          />
          <header class="sheet-head">
            <button type="button" class="power" :class="{ on: isOn }" :aria-pressed="isOn" :aria-label="label" @click="onPower">
              <Power :size="20" />
            </button>
            <div class="sheet-title">
              <h2 :id="titleId">{{ label }}</h2>
              <p v-if="members">{{ t('groupMembers')(members.length) }}</p>
            </div>
            <button type="button" class="close" :aria-label="t('close')" @click="close"><X :size="20" /></button>
          </header>

          <section v-if="caps.brightness" class="ctl">
            <div class="ctl-head">
              <span>{{ t('brightness') }}</span><span class="tabular-nums">{{ brightness ? `${brightness} %` : t('offShort') }}</span>
            </div>
            <input
              class="bar"
              type="range"
              min="1"
              max="100"
              :value="brightness || 1"
              :aria-label="t('brightness')"
              data-ctl="brightness"
              @input="onBrightness($event)"
              @change="onBrightness($event, true)"
            />
          </section>

          <section v-if="caps.colorTemp" class="ctl">
            <div class="ctl-head">
              <span>{{ t('colorTemp') }}</span>
              <span class="tabular-nums">{{ mixed.includes('color_temp_kelvin') ? t('mixed') : `${kelvin} K` }}</span>
            </div>
            <input
              class="bar track"
              type="range"
              :min="caps.minK"
              :max="caps.maxK"
              step="50"
              :value="kelvin"
              :style="{ '--track': ctTrack }"
              :aria-label="t('colorTemp')"
              data-ctl="color_temp"
              @input="setKelvin(Number($event.target.value))"
              @change="setKelvin(Number($event.target.value), true)"
            />
            <div class="presets">
              <button v-for="[key, k] in presets" :key="key" type="button" class="preset" @click="setKelvin(k, true)">
                {{ t(key) }}
              </button>
            </div>
          </section>

          <section v-if="caps.color" class="ctl">
            <div class="ctl-head">
              <span>{{ t('color') }}</span><span v-if="mixed.includes('hs_color')">{{ t('mixed') }}</span>
            </div>
            <div class="swatches" data-ctl="color">
              <button
                v-for="[h, s] in SWATCHES"
                :key="`${h}-${s}`"
                type="button"
                class="swatch"
                :style="{ background: `rgb(${hsToRgb(h, s).join(',')})` }"
                :aria-label="`${t('color')} ${h}°`"
                @click="setColor(h, s)"
              />
            </div>
            <input
              class="bar track"
              type="range"
              min="0"
              max="360"
              :value="hue"
              :style="{ '--track': hueTrack }"
              :aria-label="t('hue')"
              @input="setColor(Number($event.target.value), 100, false)"
              @change="setColor(Number($event.target.value), 100)"
            />
          </section>

          <section v-if="caps.effects" class="ctl">
            <div class="ctl-head"><span>{{ t('effects') }}</span></div>
            <div class="chips" data-ctl="effects">
              <button
                v-if="caps.canClearEffect"
                type="button"
                class="chip"
                :class="{ active: !attrs.effect || attrs.effect === 'off' }"
                @click="setEffect('off')"
              >
                {{ t('effectNone') }}
              </button>
              <button
                v-for="fx in effects"
                :key="fx"
                type="button"
                class="chip"
                :class="{ active: attrs.effect === fx }"
                @click="setEffect(fx)"
              >
                {{ fx }}
              </button>
            </div>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  touch-action: none;
  overscroll-behavior: contain;
}

.light-sheet {
  width: 100%;
  max-width: 520px;
  max-height: 86vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 20px calc(20px + var(--safe-bottom, 0px));
  border-radius: 28px 28px 0 0;
  background: var(--color-base-100);
  color: var(--color-base-content);
  transition: transform 0.2s ease;
}

@media (min-width: 768px) {
  .sheet-backdrop {
    align-items: center;
  }
  .light-sheet {
    border-radius: 28px;
    padding-bottom: 20px;
  }
}

.grab {
  width: 100%;
  height: 22px;
  display: grid;
  place-items: center;
  cursor: grab;
  touch-action: none;
}

.grab::before {
  content: '';
  width: 40px;
  height: 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-base-content) 22%, transparent);
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.sheet-title {
  flex: 1;
  min-width: 0;
}

.sheet-title h2 {
  font-size: 19px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-title p {
  font-size: 13px;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

.power,
.close {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-base-content) 8%, transparent);
  color: inherit;
  cursor: pointer;
}

.power.on {
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.ctl {
  display: grid;
  gap: 8px;
  padding: 12px 0;
  border-top: 1px solid color-mix(in srgb, var(--color-base-content) 8%, transparent);
}

.ctl-head {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
}

.ctl-head span + span {
  font-weight: 500;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

/* Large flat slider; the colour-temperature and hue tracks encode data (gradient allowed). */
.bar {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 44px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-base-content) 10%, transparent);
  accent-color: var(--color-primary);
  touch-action: none;
}

.bar.track {
  background: var(--track);
}

.bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 36px;
  border-radius: 6px;
  background: #fff;
  border: 2px solid rgba(0, 0, 0, 0.25);
}

.bar::-moz-range-thumb {
  width: 10px;
  height: 36px;
  border-radius: 6px;
  background: #fff;
  border: 2px solid rgba(0, 0, 0, 0.25);
}

.presets,
.chips {
  display: flex;
  gap: 6px;
}

.chips {
  overflow-x: auto;
  scrollbar-width: none;
  touch-action: pan-x;
}

.preset,
.chip {
  flex-shrink: 0;
  padding: 7px 12px;
  border: 1px solid color-mix(in srgb, var(--color-base-content) 14%, transparent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}

.chip.active {
  background: var(--color-primary);
  border-color: transparent;
  color: var(--color-primary-content);
}

.swatches {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
}

.swatch {
  aspect-ratio: 1;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s ease;
}
.sheet-enter-active .light-sheet,
.sheet-leave-active .light-sheet {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .light-sheet,
.sheet-leave-to .light-sheet {
  transform: translateY(40px);
}

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active .light-sheet,
  .sheet-leave-active .light-sheet,
  .light-sheet {
    transition: none;
  }
  .sheet-enter-from .light-sheet,
  .sheet-leave-to .light-sheet {
    transform: none;
  }
}
</style>
