<script setup>
import { ref } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'

const { status, lastError, hassUrl, loginWithHassUrl, startMockMode } = useHomeAssistant()
const { t } = useI18n()

const url = ref(hassUrl.value || 'https://')
const busy = ref(false)

async function submit() {
  busy.value = true
  try {
    await loginWithHassUrl(url.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-shell">
    <div class="login-card">
      <p class="eyebrow">Guest Home Controller</p>
      <h1>{{ t('loginTitle') }}</h1>
      <p class="lead">
        {{ t('loginLead') }}
      </p>

      <label class="field">
        <span>Home Assistant URL</span>
        <input
          v-model="url"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="https://homeassistant.local:8123"
          @keyup.enter="submit"
        />
      </label>

      <p v-if="lastError" class="error">{{ lastError }}</p>
      <p v-if="status === 'connecting'" class="hint">{{ t('loginConnecting') }}</p>

      <button type="button" class="btn-primary" :disabled="busy || status === 'connecting'" @click="submit">
        {{ t('loginContinue') }}
      </button>

      <button type="button" class="btn-ghost" @click="startMockMode">
        {{ t('loginMock') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-shell {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(ellipse at 20% 15%, rgba(255, 138, 208, 0.45), transparent 42%),
    radial-gradient(ellipse at 80% 20%, rgba(176, 140, 255, 0.4), transparent 40%),
    radial-gradient(ellipse at 70% 80%, rgba(255, 154, 106, 0.35), transparent 45%),
    #f3f0f7;
}

.login-card {
  width: min(420px, 100%);
  padding: 28px 24px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  box-shadow: 0 18px 50px rgba(40, 20, 60, 0.1);
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(26, 18, 32, 0.45);
}

h1 {
  margin: 0 0 8px;
  font-size: 1.55rem;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.lead {
  margin: 0 0 20px;
  color: rgba(26, 18, 32, 0.62);
  font-size: 0.95rem;
  line-height: 1.45;
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
  font-size: 0.85rem;
  color: rgba(26, 18, 32, 0.65);
}

.field input {
  width: 100%;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  padding: 12px 14px;
  font: inherit;
  background: rgba(255, 255, 255, 0.9);
}

.btn-primary,
.btn-ghost {
  width: 100%;
  border: 0;
  border-radius: 999px;
  padding: 12px 16px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary {
  background: #1a1220;
  color: #fff;
  margin-bottom: 8px;
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: default;
}

.btn-ghost {
  background: transparent;
  color: rgba(26, 18, 32, 0.55);
}

.error {
  color: #b91c1c;
  background: #fee2e2;
  border-radius: 12px;
  padding: 8px 10px;
  font-size: 0.88rem;
  margin: 0 0 10px;
}

.hint {
  margin: 0 0 10px;
  font-size: 0.88rem;
  color: rgba(26, 18, 32, 0.5);
}
</style>
