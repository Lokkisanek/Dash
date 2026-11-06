<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'

/**
 * iOS-StandBy-like idle screen: big rounded clock (portrait stacks hours over
 * minutes, landscape puts them in a row) or a photo frame that cross-fades.
 */
const props = defineProps({
  settings: { type: Object, required: true },
  use24h: { type: Boolean, default: true },
})
const emit = defineEmits(['wake'])

const { fetchPhoto, listPhotos, isMock } = useHomeAssistant()
const { lang, t } = useI18n()

const now = ref(new Date())
let tick = 0

const hours = computed(() => {
  const h = now.value.getHours()
  const v = props.use24h ? h : h % 12 || 12
  return String(v).padStart(2, '0')
})
const minutes = computed(() => String(now.value.getMinutes()).padStart(2, '0'))
const dateLabel = computed(() =>
  now.value.toLocaleDateString(lang.value === 'en' ? 'en-US' : 'cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }),
)

/* Gentle drift against OLED burn-in */
const drift = ref({ x: 0, y: 0 })
function nudge() {
  drift.value = { x: Math.round((Math.random() - 0.5) * 16), y: Math.round((Math.random() - 0.5) * 16) }
}

/* Photo frame */
const photoMode = computed(() => props.settings.mode === 'photos')
const urls = ref([])
const slots = ref([null, null])
const front = ref(0)
let slideTimer = 0
let slideIdx = 0

async function loadPhotos() {
  urls.value.forEach((u) => URL.revokeObjectURL(u))
  urls.value = []
  if (!photoMode.value) return
  const ids = await listPhotos()
  const loaded = []
  for (const id of ids) {
    const url = await fetchPhoto(id)
    if (url) loaded.push(url)
  }
  if (!loaded.length && isMock.value) {
    // demo frames so the mock build shows the cross-fade
    loaded.push('demo:a', 'demo:b', 'demo:c')
  }
  urls.value = loaded
  slideIdx = 0
  slots.value = [loaded[0] || null, null]
  front.value = 0
  scheduleSlide()
}

function scheduleSlide() {
  clearTimeout(slideTimer)
  if (urls.value.length < 2) return
  slideTimer = setTimeout(() => {
    slideIdx = (slideIdx + 1) % urls.value.length
    const back = front.value ? 0 : 1
    slots.value[back] = urls.value[slideIdx]
    front.value = back
    scheduleSlide()
  }, Math.max(3, Number(props.settings.photoSeconds) || 8) * 1000)
}

const DEMO = {
  'demo:a': 'linear-gradient(135deg,#ff8ad0,#b08cff)',
  'demo:b': 'linear-gradient(135deg,#2f8a7e,#3b6fb0)',
  'demo:c': 'linear-gradient(135deg,#ff9a6a,#8a8a2c)',
}
function slotStyle(url) {
  if (!url) return {}
  return DEMO[url] ? { backgroundImage: DEMO[url] } : { backgroundImage: `url("${url}")` }
}

const showPhotos = computed(() => photoMode.value && urls.value.length > 0)

watch(() => props.settings.mode, loadPhotos)

onMounted(() => {
  tick = setInterval(() => {
    const prev = now.value.getMinutes()
    now.value = new Date()
    if (now.value.getMinutes() !== prev) nudge()
  }, 1000)
  loadPhotos()
})
onUnmounted(() => {
  clearInterval(tick)
  clearTimeout(slideTimer)
  urls.value.forEach((u) => URL.revokeObjectURL(u))
})
</script>

<template>
  <div
    class="standby"
    :class="[`clock-${settings.clockStyle || 'bold'}`, { 'has-photos': showPhotos }]"
    role="button"
    tabindex="0"
    :aria-label="t('standbyTap')"
    @click="emit('wake')"
    @keydown.enter="emit('wake')"
  >
    <template v-if="showPhotos">
      <div
        v-for="(url, i) in slots"
        :key="i"
        class="photo"
        :class="{ 'is-front': front === i }"
        :style="{ ...slotStyle(url), '--dur': `${(Number(settings.photoSeconds) || 8) + 2}s` }"
      />
      <div class="photo-clock tabular-nums">
        <strong>{{ hours }}:{{ minutes }}</strong>
        <span>{{ dateLabel }}</span>
      </div>
    </template>

    <div v-else class="clock" :style="{ transform: `translate(${drift.x}px, ${drift.y}px)` }">
      <div class="digits tabular-nums" aria-live="polite">
        <span class="pair">
          <Transition v-for="(d, i) in hours" :key="`h${i}`" name="digit" mode="out-in">
            <span :key="d" class="digit" :class="`c${i}`">{{ d }}</span>
          </Transition>
        </span>
        <span class="colon" aria-hidden="true"><i /><i /></span>
        <span class="pair">
          <Transition v-for="(d, i) in minutes" :key="`m${i}`" name="digit" mode="out-in">
            <span :key="d" class="digit" :class="`c${i + 2}`">{{ d }}</span>
          </Transition>
        </span>
      </div>
      <p class="date">{{ dateLabel }}</p>
    </div>
  </div>
</template>

<style scoped>
.standby {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #000;
  color: #fff;
  cursor: pointer;
  user-select: none;
  outline: none;
  padding: var(--safe-top, 0px) var(--safe-right, 0px) var(--safe-bottom, 0px) var(--safe-left, 0px);
}

.clock {
  display: grid;
  justify-items: center;
  gap: 2vmin;
  transition: transform 4s ease-in-out;
}

.digits {
  display: flex;
  align-items: center;
  font-family: ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif;
  font-weight: 900;
  line-height: 0.86;
  letter-spacing: -0.04em;
}

.pair {
  display: flex;
}

.digit {
  display: inline-block;
  min-width: 0.6em;
  text-align: center;
}

.clock-bold .c0 { color: #c777b8; }
.clock-bold .c1 { color: #b47fd4; }
.clock-bold .c2 { color: #a497f2; }
.clock-bold .c3 { color: #8e44a8; }

.clock-minimal .digits {
  font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif;
  font-weight: 200;
  letter-spacing: -0.02em;
}

.colon {
  display: grid;
  gap: 0.32em;
  margin: 0 0.04em;
}
.colon i {
  width: 0.17em;
  height: 0.17em;
  border-radius: 50%;
  background: #8a8a8e;
  animation: breathe 2s ease-in-out infinite;
}
.clock-minimal .colon i {
  width: 0.08em;
  height: 0.08em;
  background: #fff;
}

.date {
  margin: 0;
  font: 600 clamp(14px, 2.6vmin, 22px) / 1.2 -apple-system, system-ui, sans-serif;
  color: rgba(255, 255, 255, 0.55);
  text-transform: capitalize;
}

/* landscape: one row, as wide as possible */
@media (orientation: landscape) {
  .digits {
    font-size: min(31vw, 74vh);
  }
}

/* portrait: hours above minutes */
@media (orientation: portrait) {
  .digits {
    flex-direction: column;
    font-size: min(52vw, 34vh);
  }
  .colon {
    display: flex;
    gap: 0.32em;
    margin: 0.06em 0;
  }
}

@keyframes breathe {
  50% { opacity: 0.45; }
}

.digit-enter-active,
.digit-leave-active {
  transition: transform 0.45s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.45s ease, filter 0.45s ease;
}
.digit-enter-from {
  transform: translateY(-18%);
  opacity: 0;
  filter: blur(8px);
}
.digit-leave-to {
  transform: translateY(18%);
  opacity: 0;
  filter: blur(8px);
}

/* photo frame */
.photo {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0;
  transform: scale(1);
  transition: opacity 1.8s ease, transform 0s linear 1.8s;
}
.photo.is-front {
  opacity: 1;
  transform: scale(1.08);
  transition: opacity 1.8s ease, transform var(--dur, 10s) linear;
}

.photo-clock {
  position: absolute;
  left: calc(28px + var(--safe-left, 0px));
  bottom: calc(26px + var(--safe-bottom, 0px));
  display: grid;
  gap: 2px;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.45);
}
.photo-clock strong {
  font: 300 clamp(40px, 9vmin, 84px) / 1 -apple-system, 'SF Pro Display', system-ui, sans-serif;
  letter-spacing: -0.02em;
}
.photo-clock span {
  font: 600 15px/1.2 -apple-system, system-ui, sans-serif;
  opacity: 0.85;
  text-transform: capitalize;
}

@media (prefers-reduced-motion: reduce) {
  .photo, .photo.is-front { transform: none; }
  .colon i { animation: none; }
}
</style>
