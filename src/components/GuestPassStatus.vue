<script setup>
import { computed } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'

const { status, openPairing } = useHomeAssistant()
const { t } = useI18n()

const pending = computed(() => status.value === 'guest_pending')
</script>

<template>
  <main class="guest-status min-h-full bg-base-200 text-base-content">
    <div class="w-full max-w-sm">
      <p class="text-xs uppercase tracking-[0.16em] text-base-content/45 mb-2">dash</p>
      <h1 class="text-2xl font-semibold tracking-tight mb-3">
        {{ pending ? t('pendingTitle') : t('endedTitle') }}
      </h1>
      <p class="text-base-content/75 leading-relaxed" data-testid="guest-status-text">
        {{ pending ? t('pendingText') : t('endedText') }}
      </p>
      <button v-if="!pending" type="button" class="btn btn-ghost mt-6 -ml-4" @click="openPairing()">
        {{ t('endedNewCode') }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.guest-status {
  display: grid;
  place-items: center;
  padding: max(40px, env(safe-area-inset-top)) 24px max(40px, env(safe-area-inset-bottom));
}
</style>
