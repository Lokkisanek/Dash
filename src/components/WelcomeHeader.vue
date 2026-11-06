<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useWeather } from '@/composables/useWeather'
import { useI18n } from '@/composables/useI18n'
import { translateWeather } from '@/i18n/messages'

const { userName } = useHomeAssistant()
const weather = useWeather()
const { t, lang, locale } = useI18n()

const hour = ref(new Date().getHours())
let timer = null
onMounted(() => {
  timer = setInterval(() => {
    hour.value = new Date().getHours()
  }, 60_000)
})
onUnmounted(() => clearInterval(timer))

const greeting = computed(() => {
  const h = hour.value
  const key = h >= 5 && h < 11 ? 'greetMorning' : h < 18 && h >= 11 ? 'greetDay' : h >= 18 && h < 22 ? 'greetEvening' : 'greetNight'
  const name = String(userName.value || '').trim().split(/\s+/)[0]
  return name ? `${t(key)}, ${name}` : t(key)
})

const temp = computed(() => {
  const v = weather.value?.temperature
  return v == null ? null : Number(v).toLocaleString(locale.value, { maximumFractionDigits: 1 })
})
const condition = computed(() => translateWeather(lang.value, weather.value?.condition))
const humidity = computed(() => {
  const v = weather.value?.humidity
  return v == null ? null : Math.round(v)
})
</script>

<template>
  <section class="welcome">
    <p class="greeting">{{ greeting }}</p>
    <div v-if="temp != null" class="weather">
      <span class="big-temp tabular-nums">{{ temp }}°</span>
      <div class="wx-side">
        <p class="wx-cond"><span class="wx-dot" />{{ condition }}</p>
        <p class="wx-meta">
          <template v-if="humidity != null">{{ t('humidity') }} {{ humidity }} %<span class="mx-1">·</span></template>{{ t('outside') }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.welcome {
  padding: 4px 6px 0;
  color: var(--color-base-content);
  animation: welcome-in 0.6s cubic-bezier(0.2, 0.9, 0.25, 1) both;
}

@keyframes welcome-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.greeting {
  font-size: 19px;
  color: color-mix(in srgb, var(--color-base-content) 62%, transparent);
  letter-spacing: -0.01em;
}

.weather {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 2px;
}

.big-temp {
  font-size: 64px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.045em;
}

.wx-side {
  min-width: 0;
}

.wx-cond {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 550;
}

.wx-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  flex-shrink: 0;
}

.wx-meta {
  margin-top: 2px;
  font-size: 13px;
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
}
</style>
