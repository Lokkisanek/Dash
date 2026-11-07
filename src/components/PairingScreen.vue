<script setup>
import { ref, computed } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { hassUrlFromPath } from '@/lib/hassTarget'
import { formatCode, normalizeCode, isStandalone, isIos } from '@/lib/guestPass'

const { pairCode, pairError, pairBusy, hassUrl, isMock, pairNow, closePairing } = useHomeAssistant()
const { t } = useI18n()

const pathUrl = hassUrlFromPath()
const code = ref(formatCode(pairCode.value))
const host = ref('')
const ios = isIos()

// A code from the QR in a browser tab: install first, the app has its own
// storage on iOS (docs/GUEST_PASSES.md, "Pairing").
const showInstall = ref(Boolean(pairCode.value) && !isStandalone())
const needHost = computed(() => !isMock.value && !pathUrl && !hassUrl.value)
const valid = computed(() => Boolean(normalizeCode(code.value)) && (!needHost.value || host.value.trim()))

const errorText = computed(() => {
  const err = pairError.value
  if (!err) return ''
  const text = t(`pairErr_${err.code}`)
  return (text === `pairErr_${err.code}` ? t('pairErr_unreachable') : text).replace('{n}', err.retryAfter || 60)
})

function onCodeInput(e) {
  code.value = formatCode(e.target.value)
  e.target.value = code.value
}

function targetUrl() {
  if (!needHost.value) return pathUrl || hassUrl.value
  const raw = host.value.trim()
  return raw.includes('://') ? raw : `https://${raw}`
}

function submit() {
  if (!valid.value || pairBusy.value) return
  pairNow(targetUrl(), code.value)
}

function continueInBrowser() {
  showInstall.value = false
  if (!needHost.value) submit()
}
</script>

<template>
  <main class="pair-shell min-h-full bg-base-200 text-base-content">
    <div class="w-full max-w-sm">
      <p class="text-xs uppercase tracking-[0.16em] text-base-content/45 mb-2">dash</p>

      <template v-if="showInstall">
        <h1 class="text-2xl font-semibold tracking-tight mb-3">{{ t('pairInstallTitle') }}</h1>
        <p class="text-base-content/75 leading-relaxed">{{ ios ? t('pairInstallIos') : t('pairInstallOther') }}</p>
        <p class="font-mono text-3xl tracking-[0.12em] my-6 select-all" data-testid="pair-code">{{ code }}</p>
        <p class="text-sm text-base-content/55">{{ t('pairCodeTtl') }}</p>
        <button type="button" class="btn btn-ghost mt-6 -ml-4" @click="continueInBrowser">
          {{ t('pairContinueBrowser') }}
        </button>
      </template>

      <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t('pairTitle') }}</h1>
        <p class="text-base-content/75 -mt-2">{{ t('pairLead') }}</p>

        <label v-if="needHost" class="flex flex-col gap-1.5">
          <span class="text-sm text-base-content/60">{{ t('pairHost') }}</span>
          <input
            v-model="host"
            class="input w-full"
            type="url"
            inputmode="url"
            autocomplete="url"
            autocapitalize="none"
            spellcheck="false"
            placeholder="ha.example.com"
          />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-sm text-base-content/60">{{ t('pairCode') }}</span>
          <input
            :value="code"
            class="input input-lg w-full font-mono tracking-[0.12em] uppercase"
            type="text"
            autocomplete="one-time-code"
            autocapitalize="characters"
            autocorrect="off"
            spellcheck="false"
            maxlength="14"
            placeholder="XXXX-XXXX-XXXX"
            data-testid="pair-input"
            @input="onCodeInput"
          />
        </label>

        <p v-if="errorText" class="text-error text-sm" role="alert">{{ errorText }}</p>

        <button type="submit" class="btn btn-primary" :disabled="pairBusy || !valid">
          {{ pairBusy ? t('pairBusy') : t('pairSubmit') }}
        </button>
        <button type="button" class="btn btn-ghost btn-sm self-start -ml-3" @click="closePairing">
          {{ t('pairOwner') }}
        </button>
      </form>
    </div>
  </main>
</template>

<style scoped>
.pair-shell {
  display: grid;
  place-items: center;
  padding: max(40px, env(safe-area-inset-top)) 24px max(40px, env(safe-area-inset-bottom));
}
</style>
