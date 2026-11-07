<script setup>
import { computed } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { translateState } from '@/i18n/messages'
import { resolveIcon } from '@/lib/icons'
import deviceClasses from '../../../shared/device-classes.json'

/**
 * Read-only tiles: `sensor` (value + unit), `binary_sensor` (wording per device
 * class) and `entity` (any other entity: state, optionally one attribute).
 * Never any control, also for guests. Unavailable or unknown shows "—".
 */
const props = defineProps({
  kind: { type: String, required: true }, // sensor | binary_sensor | entity
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  icon: { type: String, default: '' },
  attribute: { type: String, default: '' },
  row: { type: Boolean, default: false },
  /** 4 columns: name left, value right; 2 columns: value over the name */
  wide: { type: Boolean, default: false },
})

const { getEntityState } = useHomeAssistant()
const { t, lang, locale } = useI18n()
const entity = computed(() => getEntityState(props.entityId))
const attrs = computed(() => entity.value?.attributes || {})
const deviceClass = computed(() => attrs.value.device_class || '')
const missing = computed(() => !entity.value || ['unavailable', 'unknown', ''].includes(entity.value.state))

function formatValue(raw) {
  const n = Number(raw)
  if (raw !== '' && raw != null && Number.isFinite(n)) {
    const digits = props.row ? 2 : 1 // 1×1 tiles have room for one decimal
    return { text: n.toLocaleString(locale.value, { maximumFractionDigits: digits }), numeric: true }
  }
  return { text: String(raw ?? ''), numeric: false }
}

const binary = computed(() => deviceClasses.binary_sensor[deviceClass.value] || null)

const display = computed(() => {
  if (missing.value) return { text: '—', unit: '', numeric: false }
  const st = entity.value.state
  if (props.kind === 'binary_sensor') {
    const words = binary.value?.[lang.value === 'en' ? 'en' : 'cs']
    const on = st === 'on'
    return { text: words ? words[on ? 0 : 1] : t(on ? 'on' : 'off'), unit: '', numeric: false }
  }
  if (props.kind === 'entity' && props.attribute) {
    const v = attrs.value[props.attribute]
    if (v == null) return { text: '—', unit: '', numeric: false }
    return { ...formatValue(typeof v === 'object' ? JSON.stringify(v) : v), unit: '' }
  }
  const f = formatValue(st)
  const unit = attrs.value.unit_of_measurement || ''
  if (!f.numeric && props.kind === 'entity') return { text: translateState(lang.value, st), unit: '', numeric: false }
  return { ...f, unit }
})

const isActive = computed(() => props.kind === 'binary_sensor' && entity.value?.state === 'on')

const Icon = computed(() => {
  if (props.icon) return resolveIcon(props.icon, 'Info')
  if (props.kind === 'binary_sensor') return resolveIcon(binary.value?.icon || 'Activity', 'Activity')
  if (props.kind === 'sensor') return resolveIcon(deviceClasses.sensor[deviceClass.value] || 'Gauge', 'Gauge')
  return resolveIcon('Info')
})

const title = computed(() => `${props.label}: ${display.value.text}${display.value.unit ? ` ${display.value.unit}` : ''}`)
</script>

<template>
  <div
    class="read-tile squircle"
    :class="{ 'is-row': row, 'is-wide': wide, 'is-active': isActive, 'is-missing': missing }"
    :data-read="kind"
    :title="title"
    role="group"
    :aria-label="title"
  >
    <span class="read-icon"><component :is="Icon" :size="row ? 20 : 18" /></span>
    <template v-if="row && wide">
      <span class="read-name">{{ label }}</span>
      <span class="read-value tabular-nums">{{ display.text }}<small v-if="display.unit">{{ display.unit }}</small></span>
    </template>
    <span v-else-if="row" class="read-stack">
      <span class="read-value tabular-nums">{{ display.text }}<small v-if="display.unit">{{ display.unit }}</small></span>
      <span class="read-label">{{ label }}</span>
    </span>
    <template v-else>
      <span class="read-big tabular-nums" :class="{ 'is-text': !display.numeric }">{{ display.text }}<small v-if="display.unit">{{ display.unit }}</small></span>
      <span class="read-label">{{ label }}</span>
    </template>
  </div>
</template>

<style scoped>
.read-tile {
  width: 100%;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-base-content);
  overflow: hidden;
}

.read-tile.is-row {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 0 16px;
}

.read-tile:not(.is-row) {
  padding: 10px;
}

.read-icon {
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
}

/* Active binary sensor: accent on the icon only */
.is-active .read-icon {
  color: var(--color-primary);
}

.read-stack {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.read-stack .read-value {
  max-width: 100%;
}

.read-big {
  font-size: 20px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.read-big.is-text {
  font-size: 15px;
  font-weight: 600;
}

.read-big small,
.read-value small {
  margin-left: 2px;
  font-size: 0.55em;
  font-weight: 500;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

.read-label,
.read-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: color-mix(in srgb, var(--color-base-content) 60%, transparent);
}

.read-name {
  flex: 1;
  font-size: 14px;
  color: var(--color-base-content);
}

.read-value {
  flex-shrink: 0;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 17px;
  font-weight: 600;
}

.is-missing .read-big,
.is-missing .read-value {
  color: color-mix(in srgb, var(--color-base-content) 40%, transparent);
}
</style>
