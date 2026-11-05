<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import { X, Copy, Check, Wifi } from 'lucide-vue-next'
import QRCode from 'qrcode'
import { playTick } from '@/composables/useSound'

const props = defineProps({
  open: { type: Boolean, default: false },
  ssid: { type: String, required: true },
  password: { type: String, required: true },
  security: { type: String, default: 'WPA' },
})

const emit = defineEmits(['close'])

const dialogEl = ref(null)
const qrDataUrl = ref('')
const copied = ref(false)

function wifiQrPayload() {
  const esc = (s) => String(s).replace(/([\\;,:"])/g, '\\$1')
  return `WIFI:T:${props.security};S:${esc(props.ssid)};P:${esc(props.password)};;`
}

async function renderQr() {
  try {
    qrDataUrl.value = await QRCode.toDataURL(wifiQrPayload(), {
      width: 220,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
  } catch (err) {
    console.error('QR generation failed', err)
  }
}

async function copyPassword() {
  playTick('soft')
  try {
    await navigator.clipboard.writeText(props.password)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1800)
  } catch {
    /* clipboard may be blocked */
  }
}

function close() {
  playTick('soft')
  dialogEl.value?.close()
  emit('close')
}

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open) {
      renderQr()
      dialogEl.value?.showModal()
    } else if (dialogEl.value?.open) {
      dialogEl.value.close()
    }
  },
)

onMounted(() => {
  if (props.open) {
    renderQr()
    dialogEl.value?.showModal()
  }
})
</script>

<template>
  <dialog ref="dialogEl" class="modal modal-bottom sm:modal-middle" @close="emit('close')">
    <div class="modal-box bg-base-100 shadow-none">
      <button
        type="button"
        class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
        aria-label="Zavřít"
        @click="close"
      >
        <X :size="18" />
      </button>

      <div class="flex items-center gap-3 mb-4">
        <div class="btn btn-circle pointer-events-none border-0 bg-primary/15 text-primary">
          <Wifi :size="20" />
        </div>
        <div>
          <h3 class="font-bold text-lg">Wi-Fi pro hosty</h3>
          <p class="text-sm text-base-content/50">Naskenujte nebo zkopírujte heslo</p>
        </div>
      </div>

      <div class="flex justify-center mb-5">
        <div class="p-3 rounded-box bg-base-200 soft-inset">
          <img
            v-if="qrDataUrl"
            :src="qrDataUrl"
            alt="Wi-Fi QR kód"
            class="w-[200px] h-[200px]"
            draggable="false"
          />
        </div>
      </div>

      <div class="space-y-3">
        <div class="rounded-box bg-base-200 px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-base-content/40 mb-0.5">Síť</p>
          <p class="text-base font-medium">{{ ssid }}</p>
        </div>

        <div class="rounded-box bg-base-200 px-4 py-3 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-wider text-base-content/40 mb-0.5">Heslo</p>
            <p class="text-base font-medium font-mono tracking-wide truncate">{{ password }}</p>
          </div>
          <button type="button" class="btn btn-sm gap-1.5 shrink-0" @click="copyPassword">
            <Check v-if="copied" :size="16" class="text-success" />
            <Copy v-else :size="16" />
            {{ copied ? 'Zkopírováno' : 'Kopírovat' }}
          </button>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>
