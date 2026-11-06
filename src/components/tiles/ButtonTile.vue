<script setup>
import { computed } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'
import { resolveIcon } from '@/lib/icons'

/** Control Center toggle: icon-only square (1x1) or icon + label (2x1). */
const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  domain: { type: String, default: 'switch' },
  icon: { type: String, default: '' },
  wide: { type: Boolean, default: false },
})

const { getEntityState, callService } = useHomeAssistant()
const { t } = useI18n()

const isOn = computed(() => getEntityState(props.entityId)?.state === 'on')
const Icon = computed(() =>
  resolveIcon(props.icon || (props.domain === 'light' ? 'Lightbulb' : 'Power'), 'Power'),
)

async function onToggle() {
  unlockAudio()
  await callService(props.domain, 'toggle', { entity_id: props.entityId })
}
</script>

<template>
  <button
    type="button"
    class="cc-button squircle"
    :class="{ 'is-on': isOn, 'is-wide': wide }"
    :aria-pressed="isOn"
    :aria-label="label"
    @click="onToggle"
  >
    <span class="cc-icon">
      <component :is="Icon" :size="wide ? 20 : 24" :stroke-width="2.2" />
    </span>
    <span v-if="wide" class="cc-text">
      <span class="cc-label">{{ label }}</span>
      <span class="cc-state">{{ isOn ? t('on') : t('off') }}</span>
    </span>
  </button>
</template>

<style scoped>
.cc-button {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
  cursor: pointer;
  user-select: none;
  transition:
    background 220ms ease,
    color 220ms ease,
    transform 160ms cubic-bezier(0.3, 1.4, 0.5, 1);
}

.cc-button:active {
  transform: scale(0.94);
}

.cc-button.is-on {
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.cc-button.is-wide {
  justify-content: flex-start;
  padding: 0 14px;
  text-align: left;
}

.cc-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.is-wide .cc-icon {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: color-mix(in srgb, currentColor 14%, transparent);
}

.cc-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.cc-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-base-content);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-on .cc-label {
  color: inherit;
}

.cc-state {
  font-size: 12px;
  opacity: 0.75;
}
</style>
