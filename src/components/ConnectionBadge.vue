<script setup>
import { computed } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'

/**
 * System status, not a tile: a small badge under the status bar that appears
 * only when the connection is not healthy (demo/mock, connecting, offline).
 * App.vue moves the pages down a little while it is shown, so it covers no tile.
 */
const { status } = useHomeAssistant()
const { t } = useI18n()

const meta = computed(() => {
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
</script>

<template>
  <div v-if="meta" class="conn-badge" role="status" data-connection-badge>
    <span class="badge badge-soft badge-sm gap-1.5" :class="meta.badge">
      <span class="status status-sm" :class="meta.color" />
      {{ meta.label }}
    </span>
  </div>
</template>

<style scoped>
.conn-badge {
  position: fixed;
  top: calc(var(--safe-top, 0px) + 6px);
  right: calc(var(--safe-right, 0px) + 16px);
  z-index: 35;
  pointer-events: none;
}
</style>
