<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import '@fontsource/sacramento/latin-400.css'
import { useI18n } from '@/composables/useI18n'

/** First-run welcome: "hello.dash" written by hand, then click / swipe up. */
const emit = defineEmits(['done'])
const { t } = useI18n()

const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
const ready = ref(false)
const leaving = ref(false)
const lift = ref(0)
const prompt = computed(() => (touch ? t('introSwipe') : t('introClick')))

let readyTimer = 0
let start = null

function proceed() {
  if (leaving.value) return
  leaving.value = true
  setTimeout(() => emit('done'), 650)
}

function onDown(e) {
  start = { y: e.clientY, t: performance.now() }
}

function onMove(e) {
  if (!start || !touch) return
  lift.value = Math.min(0, e.clientY - start.y)
}

function onUp(e) {
  if (!start) return
  const dy = e.clientY - start.y
  const fast = dy / Math.max(1, performance.now() - start.t) < -0.5
  start = null
  if (!touch) {
    if (Math.abs(dy) < 8) proceed()
    return
  }
  if (dy < -90 || (fast && dy < -30)) proceed()
  else lift.value = 0
}

function onKey(e) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp') proceed()
}

onMounted(() => {
  readyTimer = setTimeout(() => (ready.value = true), 3400)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  clearTimeout(readyTimer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    class="intro"
    :class="{ 'is-leaving': leaving }"
    role="button"
    tabindex="0"
    :aria-label="prompt"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="start = null; lift = 0"
  >
    <div class="intro__sky" aria-hidden="true">
      <span class="blob b1" />
      <span class="blob b2" />
      <span class="blob b3" />
      <span class="blob b4" />
    </div>

    <div class="intro__stage" :style="{ transform: `translate3d(0, ${lift * 0.6}px, 0)` }">
      <svg class="intro__word" viewBox="0 0 640 220" role="img" aria-label="hello.dash">
        <defs>
          <linearGradient id="introWipeGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0.85" stop-color="#fff" />
            <stop offset="1" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <mask id="introWipe" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="220">
            <rect class="wipe" x="-80" y="0" width="720" height="220" fill="url(#introWipeGrad)" />
          </mask>
        </defs>
        <g mask="url(#introWipe)">
          <text class="ink" x="50%" y="62%" text-anchor="middle">hello<tspan class="dot">.</tspan>dash</text>
        </g>
      </svg>
    </div>

    <div class="intro__prompt" :class="{ 'is-ready': ready }">
      <span>{{ prompt }}</span>
      <span v-if="touch" class="home-bar" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.intro {
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #2d5f73;
  color: #fff;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  outline: none;
  transition: opacity 0.65s cubic-bezier(0.32, 0.72, 0, 1);
}

.intro__sky {
  position: absolute;
  inset: -20%;
  filter: blur(70px) saturate(1.2);
}

.blob {
  position: absolute;
  border-radius: 50%;
  opacity: 0.9;
  animation: drift 16s ease-in-out infinite alternate;
}
.b1 { width: 55vmax; height: 55vmax; left: -5%; top: -8%; background: #3b6fb0; }
.b2 { width: 45vmax; height: 45vmax; right: -6%; top: 18%; background: #2f8a7e; animation-duration: 19s; animation-delay: -6s; }
.b3 { width: 40vmax; height: 40vmax; left: 12%; top: 26%; background: #c9874f; animation-duration: 14s; animation-delay: -3s; }
.b4 { width: 50vmax; height: 50vmax; left: 20%; bottom: -18%; background: #8a8a2c; animation-duration: 21s; animation-delay: -9s; }

@keyframes drift {
  from { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(6vmax, -4vmax, 0) scale(1.12); }
  to { transform: translate3d(-5vmax, 5vmax, 0) scale(0.94); }
}

.intro__stage {
  position: relative;
  width: min(86vw, 680px);
  transition: transform 0.65s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.65s ease;
}

.intro__word {
  display: block;
  width: 100%;
  overflow: visible;
}

.ink {
  font-family: 'Sacramento', 'Snell Roundhand', cursive;
  font-size: 168px;
  fill: #fff;
  fill-opacity: 0;
  stroke: #fff;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 900;
  stroke-dashoffset: 900;
  paint-order: stroke;
  filter: drop-shadow(0 2px 14px rgba(0, 0, 0, 0.12));
  animation:
    write 2.6s cubic-bezier(0.55, 0.1, 0.35, 1) 0.35s forwards,
    ink-fill 0.9s ease 2.3s forwards;
}

.dot {
  fill: #ffd29a;
  stroke: #ffd29a;
}

.wipe {
  transform: translateX(-720px);
  animation: wipe 2.6s cubic-bezier(0.55, 0.1, 0.35, 1) 0.35s forwards;
}

@keyframes write {
  to { stroke-dashoffset: 0; }
}
@keyframes ink-fill {
  to { fill-opacity: 1; stroke-width: 0.6; }
}
@keyframes wipe {
  to { transform: translateX(0); }
}

.intro__prompt {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  display: grid;
  justify-items: center;
  gap: 14px;
  font: 500 16px/1.2 -apple-system, 'SF Pro Text', system-ui, sans-serif;
  letter-spacing: -0.01em;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.8s ease, transform 0.8s cubic-bezier(0.32, 0.72, 0, 1);
}

.intro__prompt.is-ready {
  opacity: 0.92;
  transform: none;
}

.intro__prompt.is-ready span:first-child {
  animation: nudge 2.4s ease-in-out 0.8s infinite;
}

.home-bar {
  width: 134px;
  height: 5px;
  border-radius: 999px;
  background: #fff;
}

@keyframes nudge {
  0%, 70%, 100% { transform: none; }
  80% { transform: translateY(-6px); }
}

.intro.is-leaving .intro__stage {
  transform: translate3d(0, -14vh, 0) scale(0.92) !important;
  opacity: 0;
}
.intro.is-leaving {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .blob, .intro__prompt span { animation: none !important; }
  .ink { animation: none; fill-opacity: 1; stroke-dashoffset: 0; }
  .wipe { animation: none; transform: none; }
}
</style>
