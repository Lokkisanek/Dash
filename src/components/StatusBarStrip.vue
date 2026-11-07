<script setup>
import { isStandalone } from '@/lib/guestPass'

/**
 * index.html sets apple-mobile-web-app-status-bar-style=black-translucent, so
 * iOS always draws the status bar text in white over our content. By default the
 * wallpaper runs under it. `general.statusBarStrip` (off by default) puts a solid
 * dark strip behind the white clock instead, for light wallpapers. Only in the
 * installed app (standalone), only in the light theme; StandBy covers it.
 */
defineProps({
  enabled: { type: Boolean, default: false },
  dark: { type: Boolean, default: false },
})
const standalone = isStandalone()
</script>

<template>
  <div v-if="enabled && standalone && !dark" class="status-strip" aria-hidden="true" />
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
