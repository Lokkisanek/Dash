<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { Check, X } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'
import { resolveIcon } from '@/lib/icons'

/**
 * Scene: no on/off state (its HA state is the time it was last activated).
 * A tap calls scene.turn_on; the icon turns into a check for ~1.2 s, or a
 * cross when the call failed. Screen readers hear "Scéna aktivována".
 */
const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  icon: { type: String, default: '' },
  row: { type: Boolean, default: false },
})

const { getEntityState, activateScene, lastError } = useHomeAssistant()
const { t } = useI18n()
const entity = computed(() => getEntityState(props.entityId))
const unavailable = computed(() => !entity.value || entity.value.state === 'unavailable')
const Icon = computed(() => resolveIcon(props.icon || 'Clapperboard', 'Clapperboard'))
const feedback = ref('') // '' | 'done' | 'failed'
const announce = ref('')
let timer = null

async function activate() {
  if (unavailable.value || feedback.value) return
  unlockAudio()
  const before = lastError.value
  try {
    await activateScene(props.entityId)
    // owner calls report failures through lastError, guest refusals through a toast
    feedback.value = lastError.value && lastError.value !== before ? 'failed' : 'done'
  } catch {
    feedback.value = 'failed'
  }
  announce.value = feedback.value === 'done' ? t('sceneDone') : t('sceneFailed')
  clearTimeout(timer)
  timer = setTimeout(() => {
    feedback.value = ''
  }, 1200)
}
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <button
    type="button"
    class="scene-tile squircle"
    :class="{ 'is-row': row, 'is-done': feedback === 'done', 'is-failed': feedback === 'failed', 'is-off': unavailable }"
    :aria-label="`${label}: ${t('sceneActivate')}`"
    :disabled="unavailable"
    data-scene
    @click="activate"
  >
    <span class="scene-icon">
      <Check v-if="feedback === 'done'" :size="22" />
      <X v-else-if="feedback === 'failed'" :size="22" />
      <component :is="Icon" v-else :size="22" />
    </span>
    <span v-if="row" class="scene-name">{{ label }}</span>
    <span v-if="row" class="scene-action">{{ unavailable ? t('unavailable') : t('sceneActivate') }}</span>
    <span v-else class="scene-label">{{ label }}</span>
    <span class="sr-only" aria-live="polite">{{ announce }}</span>
  </button>
</template>

<style scoped>
.scene-tile {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  border: 0;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-base-content);
  cursor: pointer;
  transition: transform 160ms cubic-bezier(0.3, 1.4, 0.5, 1);
}

.scene-tile:active {
  transform: scale(0.95);
}

.scene-tile.is-row {
  flex-direction: row;
  justify-content: flex-start;
  gap: 12px;
  padding: 0 16px;
}

.scene-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 50%;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  transition: background 200ms ease, color 200ms ease;
}

.is-done .scene-icon {
  background: var(--color-primary);
  color: var(--color-primary-content);
}

.is-failed .scene-icon {
  background: color-mix(in srgb, var(--color-error) 18%, transparent);
  color: var(--color-error);
}

.scene-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}

.scene-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-weight: 600;
}

.scene-action {
  flex-shrink: 0;
  font-size: 13px;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

.is-off {
  opacity: 0.5;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .scene-tile,
  .scene-icon {
    transition: none;
  }
}
</style>
