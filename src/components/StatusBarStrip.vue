<script setup>
import { isStandalone } from '@/lib/guestPass'

/**
 * index.html sets apple-mobile-web-app-status-bar-style=black-translucent, so
 * iOS always draws the status bar text in white over our content. In the light
 * theme that white clock would sit on a light background; this strip gives it a
 * solid dark backdrop. Only in the installed app (standalone), only in light
 * theme; StandBy (black, z-index 90) covers it.
 */
defineProps({
  dark: { type: Boolean, default: false },
})
const standalone = isStandalone()
</script>

<template>
  <div v-if="standalone && !dark" class="status-strip" aria-hidden="true" />
</template>

<style scoped>
.status-strip {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  height: var(--safe-top, 0px);
  background: #1a1a1a;
  pointer-events: none;
}
</style>
