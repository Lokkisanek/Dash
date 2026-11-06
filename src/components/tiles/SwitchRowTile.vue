<script setup>
import { computed } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'
import { resolveIcon } from '@/lib/icons'

/** List row: round icon, name + state, iOS-style toggle on the right. */
const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  domain: { type: String, default: 'switch' },
  icon: { type: String, default: 'Power' },
})

const { getEntityState, callService } = useHomeAssistant()
const { t } = useI18n()

const entity = computed(() => getEntityState(props.entityId))
const isOn = computed(() => entity.value?.state === 'on')
const Icon = computed(() => resolveIcon(props.icon, 'Power'))

/** Optional live power reading if the entity exposes one (smart plugs). */
const power = computed(() => {
  const a = entity.value?.attributes || {}
  const w = a.current_power_w ?? a.power ?? null
  const n = parseFloat(w)
  return Number.isFinite(n) ? `${Math.round(n)} W` : ''
})

async function onToggle() {
  unlockAudio()
  await callService(props.domain, 'toggle', { entity_id: props.entityId })
}
</script>

<template>
  <button type="button" class="row-tile squircle" :aria-pressed="isOn" @click="onToggle">
    <span class="row-icon">
      <component :is="Icon" :size="20" :stroke-width="2" />
    </span>
    <span class="row-text">
      <span class="row-label">{{ label }}</span>
      <span class="row-state">{{ isOn ? t('on') : t('off') }}<template v-if="isOn && power"> · {{ power }}</template></span>
    </span>
    <span class="ios-toggle" :class="{ 'is-on': isOn }" aria-hidden="true" />
  </button>
</template>

<style scoped>
.row-tile {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px 0 14px;
  border: 0;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-base-content);
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: transform 160ms ease;
}

.row-tile:active {
  transform: scale(0.985);
}

.row-icon {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--color-base-content) 12%, transparent);
}

.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.row-label {
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-state {
  font-size: 13px;
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
}

.ios-toggle {
  position: relative;
  width: 52px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-base-content) 16%, transparent);
  transition: background 240ms ease;
}

.ios-toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
  transition: transform 300ms cubic-bezier(0.3, 1.3, 0.5, 1);
}

.ios-toggle.is-on {
  background: color-mix(in srgb, var(--color-primary) 85%, black);
}

.ios-toggle.is-on::after {
  transform: translateX(20px);
}
</style>
