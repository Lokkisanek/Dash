<script setup>
import { computed, ref, inject } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio, playTick } from '@/composables/useSound'
import { resolveIcon } from '@/lib/icons'

/**
 * Light brightness / cover position slider. Like Control Center, dragging
 * changes the value relative to where it was; a tap without movement toggles.
 */
const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  kind: { type: String, default: 'light' }, // light | cover
  icon: { type: String, default: '' },
  vertical: { type: Boolean, default: false },
})

const { getEntityState, setLightBrightness, callService, setCoverPosition } = useHomeAssistant()
/** Long-press controls (DeviceTile): after a long press this pointer does nothing. */
const longPress = inject('dashLongPress', null)
const { t } = useI18n()

const entity = computed(() => getEntityState(props.entityId))
const isOn = computed(() =>
  props.kind === 'light' ? entity.value?.state === 'on' : (position.value ?? 0) > 0,
)
const position = computed(() => {
  const p = entity.value?.attributes?.current_position
  if (p != null) return Number(p)
  return entity.value?.state === 'open' ? 100 : entity.value?.state === 'closed' ? 0 : null
})
const remoteValue = computed(() => {
  if (props.kind === 'cover') return position.value ?? 0
  const b = entity.value?.attributes?.brightness
  if (!isOn.value) return 0
  return b == null ? 100 : Math.round((b / 255) * 100)
})

const local = ref(null)
const value = computed(() => local.value ?? remoteValue.value)
const Icon = computed(() =>
  resolveIcon(props.icon || (props.kind === 'cover' ? 'Blinds' : 'Lightbulb'), 'Lightbulb'),
)
const valueLabel = computed(() => {
  if (props.kind === 'light' && value.value === 0) return t('offShort')
  return `${value.value}%`
})

const el = ref(null)
let drag = null
let releaseTimer = null

function onDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  unlockAudio()
  clearTimeout(releaseTimer)
  const rect = el.value.getBoundingClientRect()
  drag = { x: e.clientX, y: e.clientY, start: value.value, size: props.vertical ? rect.height : rect.width, moved: false }
  el.value.setPointerCapture?.(e.pointerId)
}

function onMove(e) {
  if (!drag) return
  if (longPress?.isFired()) return
  const delta = props.vertical ? drag.y - e.clientY : e.clientX - drag.x
  if (!drag.moved && Math.abs(delta) < 6) return
  drag.moved = true
  const next = Math.round(Math.max(0, Math.min(100, drag.start + (delta / drag.size) * 100)))
  if (next === local.value) return
  local.value = next
  if (props.kind === 'light' && next > 0) setLightBrightness(props.entityId, next)
}

function onCancel() {
  // the browser took the pointer (scroll, swipe): reset, never toggle
  drag = null
  local.value = null
}

async function onUp() {
  if (!drag) return
  const { moved } = drag
  drag = null
  if (longPress?.consume()) {
    local.value = null
    return
  }
  if (!moved) {
    local.value = null
    if (props.kind === 'light') await callService('light', 'toggle', { entity_id: props.entityId })
    else await callService('cover', (position.value ?? 0) > 50 ? 'close_cover' : 'open_cover', { entity_id: props.entityId })
    return
  }
  const final = local.value ?? value.value
  if (props.kind === 'light' && final === 0) {
    await callService('light', 'turn_off', { entity_id: props.entityId })
  } else if (props.kind === 'cover') {
    playTick('snap')
    await setCoverPosition(props.entityId, final)
  }
  // Hold the local value until HA reports the new state
  releaseTimer = setTimeout(() => {
    local.value = null
  }, 900)
}
</script>

<template>
  <div
    ref="el"
    data-no-swipe
    role="slider"
    :aria-label="label"
    :aria-valuenow="value"
    aria-valuemin="0"
    aria-valuemax="100"
    class="slider-tile squircle"
    :class="[vertical ? 'is-vertical' : 'is-horizontal', { 'is-on': isOn }]"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onCancel"
  >
    <div class="fill" :style="vertical ? { height: `${value}%` } : { width: `${value}%` }">
      <span v-if="!vertical && value > 0 && value < 100" class="handle" />
    </div>

    <template v-if="vertical">
      <span class="v-value tabular-nums" :class="{ 'on-fill': value >= 88 }">{{ valueLabel }}</span>
      <div class="v-bottom" :class="{ 'on-fill': value >= 32 }">
        <component :is="Icon" :size="22" :stroke-width="2.2" />
        <span class="v-label">{{ label }}</span>
      </div>
    </template>
    <template v-else>
      <div class="h-content">
        <span class="h-label truncate">{{ label }}</span>
        <span class="h-value tabular-nums">{{ valueLabel }}</span>
      </div>
      <div class="ticks" aria-hidden="true">
        <span style="left: 25%" />
        <span style="left: 50%" />
        <span style="left: 75%" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.slider-tile {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: var(--radius-box);
  background: color-mix(in srgb, var(--color-base-content) 7%, var(--color-base-100));
  color: var(--color-base-content);
  touch-action: none;
  user-select: none;
  cursor: pointer;
  transition: transform 160ms ease;
}

.slider-tile:active {
  transform: scale(0.985);
}

.fill {
  position: absolute;
  left: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--color-primary) 26%, var(--color-base-100));
  transition:
    width 220ms cubic-bezier(0.32, 0.72, 0, 1),
    height 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.is-horizontal .fill {
  top: 0;
}

.is-vertical .fill {
  right: 0;
  background: color-mix(in srgb, var(--color-primary) 85%, white);
}

.handle {
  position: absolute;
  right: 0;
  top: 50%;
  width: 4px;
  height: 46%;
  transform: translate(50%, -50%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 80%, black);
}

.h-content {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 22px;
  font-size: 15px;
}

.h-label {
  font-weight: 500;
}

.h-value {
  font-size: 20px;
  font-weight: 500;
  letter-spacing: -0.02em;
}

.ticks {
  position: absolute;
  inset: auto 0 0 0;
  height: 7px;
  pointer-events: none;
}

.ticks span {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 7px;
  background: color-mix(in srgb, var(--color-base-content) 22%, transparent);
}

.v-value {
  position: absolute;
  top: 14px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
}

.on-fill {
  color: white;
  transition: color 180ms ease;
}

.v-bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
}

.v-label {
  max-width: 100%;
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
