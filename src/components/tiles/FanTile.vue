<script setup>
import { ref, computed } from 'vue'
import { RotateCw } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'
import { resolveIcon } from '@/lib/icons'

/**
 * Fan. `toggle` (1×1): a tap switches it on or off. `slider`: name, a speed
 * slider when the fan supports SET_SPEED, an oscillate button for OSCILLATE,
 * preset chips for PRESET_MODE with a preset list (in a one-row tile only when
 * there is no speed slider, so nothing is cut off). Bits from the installed
 * homeassistant 2026.10.4 (fan/const.py FanEntityFeature).
 */
const FAN_FEATURE = { SET_SPEED: 1, OSCILLATE: 2, DIRECTION: 4, PRESET_MODE: 8, TURN_OFF: 16, TURN_ON: 32 }

const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  icon: { type: String, default: '' },
  slider: { type: Boolean, default: false },
})

const { getEntityState, callService } = useHomeAssistant()
const { t } = useI18n()
const entity = computed(() => getEntityState(props.entityId))
const attrs = computed(() => entity.value?.attributes || {})
const features = computed(() => (Number.isInteger(attrs.value.supported_features) ? attrs.value.supported_features : 0))
const has = (bit) => Boolean(features.value & bit)
const unavailable = computed(() => !entity.value || entity.value.state === 'unavailable')
const isOn = computed(() => entity.value?.state === 'on')
const canSpeed = computed(() => has(FAN_FEATURE.SET_SPEED))
const canOscillate = computed(() => has(FAN_FEATURE.OSCILLATE))
const presets = computed(() =>
  has(FAN_FEATURE.PRESET_MODE) && Array.isArray(attrs.value.preset_modes) ? attrs.value.preset_modes.slice(0, 8) : [],
)
const Icon = computed(() => resolveIcon(props.icon || 'Fan', 'Fan'))

const local = ref(null)
const percentage = computed(() => local.value ?? (isOn.value ? Number(attrs.value.percentage ?? 0) : 0))
let timer = null

async function toggle() {
  if (unavailable.value) return
  unlockAudio()
  await callService('fan', isOn.value ? 'turn_off' : 'turn_on', { entity_id: props.entityId })
}

function onSpeed(e) {
  local.value = Number(e.target.value)
  clearTimeout(timer)
  timer = setTimeout(commitSpeed, 150)
}

async function commitSpeed() {
  clearTimeout(timer)
  if (local.value == null) return
  const value = local.value
  await callService('fan', 'set_percentage', { entity_id: props.entityId, percentage: value })
  setTimeout(() => {
    local.value = null
  }, 600)
}

async function oscillate() {
  await callService('fan', 'oscillate', { entity_id: props.entityId, oscillating: attrs.value.oscillating !== true })
}

async function preset(mode) {
  await callService('fan', 'set_preset_mode', { entity_id: props.entityId, preset_mode: mode })
}
</script>

<template>
  <button
    v-if="!slider"
    type="button"
    class="fan-toggle squircle"
    :class="{ 'is-on': isOn, 'is-off': unavailable }"
    :aria-pressed="isOn"
    :aria-label="label"
    :disabled="unavailable"
    data-fan
    @click="toggle"
  >
    <component :is="Icon" :size="24" :class="{ spin: isOn }" />
  </button>

  <div v-else class="fan-card squircle" :class="{ 'is-on': isOn, 'is-off': unavailable }" data-fan>
    <div class="fan-head">
      <button type="button" class="fan-power" :aria-pressed="isOn" :aria-label="label" :disabled="unavailable" @click="toggle">
        <component :is="Icon" :size="20" :class="{ spin: isOn }" />
      </button>
      <span class="fan-name">{{ label }}</span>
      <span class="fan-value tabular-nums">{{ unavailable ? t('unavailable') : isOn ? (canSpeed ? `${percentage} %` : t('on')) : t('off') }}</span>
      <button
        v-if="canOscillate"
        type="button"
        class="fan-osc"
        :class="{ active: attrs.oscillating === true }"
        :aria-pressed="attrs.oscillating === true"
        :aria-label="t('oscillate')"
        :title="t('oscillate')"
        :disabled="unavailable"
        @click="oscillate"
      >
        <RotateCw :size="16" />
      </button>
    </div>
    <input
      v-if="canSpeed"
      class="fan-range"
      type="range"
      min="0"
      max="100"
      :step="attrs.percentage_step || 1"
      :value="percentage"
      :aria-label="`${label}: ${t('speed')}`"
      :disabled="unavailable"
      data-no-swipe
      @input="onSpeed"
      @change="commitSpeed"
    />
    <div v-if="presets.length && !canSpeed" class="fan-presets" data-no-swipe>
      <button
        v-for="mode in presets"
        :key="mode"
        type="button"
        class="fan-chip"
        :class="{ active: attrs.preset_mode === mode }"
        :aria-pressed="attrs.preset_mode === mode"
        :disabled="unavailable"
        @click="preset(mode)"
      >
        {{ mode }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.fan-toggle,
.fan-card {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-base-content);
}

.fan-toggle {
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
  cursor: pointer;
}

.fan-toggle.is-on {
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.fan-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  min-width: 0;
}

.fan-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.fan-power,
.fan-osc {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, currentColor 10%, transparent);
  color: inherit;
  cursor: pointer;
}

.is-on .fan-power,
.fan-osc.active {
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.fan-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.fan-value {
  flex-shrink: 0;
  font-size: 12px;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

.fan-range {
  width: 100%;
  accent-color: var(--color-primary);
}

.fan-presets {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.fan-chip {
  flex-shrink: 0;
  padding: 2px 9px;
  border: 1px solid color-mix(in srgb, var(--color-base-content) 15%, transparent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.fan-chip.active {
  background: var(--color-primary);
  border-color: transparent;
  color: var(--color-primary-content);
}

.spin {
  animation: fan-spin 2.4s linear infinite;
}

@keyframes fan-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
