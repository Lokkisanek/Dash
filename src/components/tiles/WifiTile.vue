<script setup>
import { ref } from 'vue'
import { Wifi } from 'lucide-vue-next'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { playTick } from '@/composables/useSound'
import WifiModal from '../WifiModal.vue'

/** 1×1 button that opens the guest Wi-Fi card (network name, password, QR code). */
const { guestInfo } = useGuestConfig()
const { t } = useI18n()
const open = ref(false)

function openWifi() {
  playTick('soft')
  open.value = true
}
</script>

<template>
  <button type="button" class="wifi-tile squircle" data-info="wifi" :aria-label="t('wifi')" :title="t('wifi')" @click="openWifi">
    <Wifi :size="26" />
  </button>
  <WifiModal
    :open="open"
    :ssid="guestInfo.wifiSsid"
    :password="guestInfo.wifiPassword"
    :security="guestInfo.wifiSecurity"
    @close="open = false"
  />
</template>

<style scoped>
.wifi-tile {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-primary);
  cursor: pointer;
  transition: transform 160ms cubic-bezier(0.3, 1.4, 0.5, 1);
}

.wifi-tile:active {
  transform: scale(0.94);
}
</style>
