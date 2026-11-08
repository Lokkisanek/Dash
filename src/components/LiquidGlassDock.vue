<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { mountSvgLiquidGlass, supportsSvgBackdrop, allowRefraction, DOCK_GLASS } from '@/lib/liquidGlassSvg'
import { resolveIcon } from '@/lib/icons'
import { unlockAudio } from '@/composables/useSound'
import BackgroundOrbs from './BackgroundOrbs.vue'

const props = defineProps({
  /** @type {{ id: string, label?: string, showLabel?: boolean, icon?: string }[]} */
  items: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
  /** Pages visible right now (wide modes show several): all of them are marked. */
  activeIds: { type: Array, default: () => [] },
  dark: { type: Boolean, default: false },
  /** bottom | right | left: a vertical dock on the side (useLayoutMode) */
  side: { type: String, default: 'bottom' },
})

const vertical = computed(() => props.side === 'left' || props.side === 'right')
const isActive = (id) => id === props.modelValue || props.activeIds.includes(id)

const emit = defineEmits(['update:modelValue'])

const glassRef = ref(null)
const svgRef = ref(null)
let glass = null

/**
 * WebKit (every iOS browser) can't put an SVG filter in backdrop-filter, so the
 * dock carries its own copy of the background, aligned to the page, and bends
 * that with the same displacement filter.
 */
const refract = allowRefraction()
const useLens = refract && !supportsSvgBackdrop()
const lensScene = ref({ left: 0, top: 0, width: 0, height: 0 })

function alignLens() {
  const shell = glassRef.value?.closest('.dashboard-shell')
  if (!useLens || !shell || !glassRef.value) return
  const s = shell.getBoundingClientRect()
  const g = glassRef.value.getBoundingClientRect()
  lensScene.value = { left: s.left - g.left, top: s.top - g.top, width: s.width, height: s.height }
}

const DOCK_H = 88
const DOCK_R = 44
const DOCK_MAX = 6

const visibleItems = computed(() => (props.items || []).filter((i) => i?.id).slice(0, DOCK_MAX))
/** Length along the dock: its width at the bottom, its height on a side. */
const dockWidth = ref(360)
const box = computed(() =>
  vertical.value ? { width: DOCK_H, height: dockWidth.value } : { width: dockWidth.value, height: DOCK_H },
)

function computeDockWidth() {
  const n = Math.max(1, visibleItems.value.length)
  if (vertical.value) return Math.min(window.innerHeight - 24, Math.max(200, n * 72 + 16))
  return Math.min(window.innerWidth - 40, Math.max(280, n * 86 + 16))
}

function itemIcon(item) {
  return resolveIcon(item.icon || 'Home', 'Home')
}

function showName(item) {
  return item.showLabel !== false && Boolean(String(item.label || '').trim())
}

function select(id) {
  unlockAudio()
  emit('update:modelValue', id)
}

function mountGlass() {
  glass?.destroy()
  glass = null
  const glassEl = glassRef.value
  const defsHost = svgRef.value?.querySelector('defs')
  if (!glassEl || !defsHost || !visibleItems.value.length) return

  dockWidth.value = computeDockWidth()
  glassEl.style.width = `${box.value.width}px`
  glassEl.style.height = `${box.value.height}px`
  glassEl.style.borderRadius = `${DOCK_R}px`
  // embedded (HA preview) or ?glass=flat: plain blur only
  if (!refract) return

  try {
    glass = mountSvgLiquidGlass(glassEl, defsHost, {
      ...DOCK_GLASS,
      width: box.value.width,
      height: box.value.height,
      radius: DOCK_R,
      bezelWidth: 36,
      glassThickness: 70,
      ior: 1.9,
      scaleRatio: 1.15,
      blur: 0.2,
      specularOpacity: 0.72,
      specularSaturation: 6,
      tintOpacity: 0.04,
    })
  } catch (err) {
    console.warn('[LiquidGlassDock] SVG glass failed:', err)
  }
  nextTick(alignLens)
}

let resizeTimer = null
function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (computeDockWidth() !== dockWidth.value) mountGlass()
    else alignLens()
  }, 120)
}

onMounted(async () => {
  await nextTick()
  mountGlass()
  window.addEventListener('resize', onResize)
})

watch([visibleItems, () => props.side], async () => {
  await nextTick()
  mountGlass()
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  clearTimeout(resizeTimer)
  glass?.destroy()
  glass = null
})
</script>

<template>
  <div v-if="visibleItems.length" class="liquid-dock" :class="`is-${side}`" :data-dock-side="side">
    <svg
      ref="svgRef"
      xmlns="http://www.w3.org/2000/svg"
      width="0"
      height="0"
      aria-hidden="true"
      class="liquid-dock__defs"
    >
      <defs />
    </svg>

    <div
      ref="glassRef"
      class="liquid-dock__glass"
      :class="{ 'is-dense': visibleItems.length > 4, 'is-dark': dark }"
      :data-glass="refract ? 'refract' : 'blur'"
      :style="{
        width: `${box.width}px`,
        height: `${box.height}px`,
        borderRadius: `${DOCK_R}px`,
      }"
    >
      <div v-if="useLens" class="liquid-dock__lens" aria-hidden="true">
        <div
          class="liquid-dock__lens-scene"
          :class="{ 'is-dark': dark }"
          :style="{
            left: `${lensScene.left}px`,
            top: `${lensScene.top}px`,
            width: `${lensScene.width}px`,
            height: `${lensScene.height}px`,
          }"
        >
          <BackgroundOrbs :dark="dark" />
        </div>
      </div>
      <nav class="liquid-dock__nav" :class="{ 'is-vertical': vertical }" aria-label="Rooms">
        <button
          v-for="item in visibleItems"
          :key="item.id"
          type="button"
          class="liquid-dock__tab"
          :class="{
            'is-active': isActive(item.id),
            'is-icon-only': !showName(item),
          }"
          :aria-current="isActive(item.id) ? 'page' : undefined"
          :aria-label="item.label || item.id"
          @click="select(item.id)"
        >
          <component :is="itemIcon(item)" :size="22" :stroke-width="2.15" />
          <span v-if="showName(item)">{{ item.label }}</span>
        </button>
      </nav>
    </div>
  </div>
</template>

<style scoped>
/* Fixed to the viewport: the home-indicator inset is added once, here. */
.liquid-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--safe-bottom, 0px) + var(--dock-gap, 12px));
  z-index: 30;
  display: flex;
  justify-content: center;
  padding: 0 calc(20px + var(--safe-right, 0px)) 0 calc(20px + var(--safe-left, 0px));
  pointer-events: none;
  background: transparent;
}

/* Side dock (phone in landscape, or dockPosition left/right): vertically centred. */
.liquid-dock.is-right,
.liquid-dock.is-left {
  top: 0;
  bottom: 0;
  left: auto;
  right: calc(var(--safe-right, 0px) + 12px);
  align-items: center;
  padding: 0;
}

.liquid-dock.is-left {
  left: calc(var(--safe-left, 0px) + 12px);
  right: auto;
}

.liquid-dock__defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

/*
 * Always legible: a solid translucent fill without backdrop-filter support,
 * a lighter one over blur(18px) saturate(1.7) with it. Refraction (the SVG
 * filter in --lg-filter) only adds to that blur, never replaces it.
 */
.liquid-dock__glass {
  --dock-fill: rgba(255, 255, 255, 0.86);
  --dock-tint: rgba(255, 255, 255, 0.5);
  position: relative;
  pointer-events: auto;
  isolation: isolate;
  background: var(--dock-fill);
  border: var(--glass-border);
  box-shadow: var(--glass-shadow);
}

.liquid-dock__glass.is-dark {
  --dock-fill: rgba(30, 31, 36, 0.88);
  --dock-tint: rgba(30, 31, 36, 0.52);
}

@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  .liquid-dock__glass {
    background: var(--dock-tint);
  }
}

.liquid-dock__glass::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  isolation: isolate;
  backdrop-filter: blur(18px) saturate(1.7);
  -webkit-backdrop-filter: blur(18px) saturate(1.7);
  backdrop-filter: var(--lg-filter, blur(18px) saturate(1.7));
  -webkit-backdrop-filter: var(--lg-filter, blur(18px) saturate(1.7));
}

.liquid-dock__lens {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
  filter: var(--lg-lens-filter, none);
  -webkit-mask: var(--lg-lens-mask) 0 0 / 100% 100% no-repeat;
  mask: var(--lg-lens-mask) 0 0 / 100% 100% no-repeat;
}

.liquid-dock__lens-scene {
  position: absolute;
  background: #f3f0f7;
}

.liquid-dock__lens-scene.is-dark {
  background: #0e1014;
}

.liquid-dock__glass::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.5) 0%,
    rgba(255, 255, 255, 0.06) 14%,
    transparent 42%,
    transparent 58%,
    rgba(255, 255, 255, 0.1) 86%,
    rgba(255, 255, 255, 0.38) 100%
  );
  box-shadow:
    inset 0 1.5px 0 rgba(255, 255, 255, 0.8),
    inset 0 -1px 0 rgba(255, 255, 255, 0.4),
    inset 0 0 20px rgba(255, 255, 255, 0.15);
}

.liquid-dock__nav {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  align-items: center;
  gap: 2px;
  padding: 6px;
}

.liquid-dock__nav.is-vertical {
  grid-auto-flow: row;
  grid-auto-rows: 1fr;
  grid-auto-columns: auto;
  align-items: stretch;
}

.is-vertical .liquid-dock__tab span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}

.liquid-dock__tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 100%;
  border: 0;
  outline: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(30, 20, 45, 0.48);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition:
    color 180ms ease,
    background 180ms ease,
    box-shadow 180ms ease,
    transform 140ms ease;
}

.liquid-dock__tab.is-icon-only {
  gap: 0;
}

.is-dense .liquid-dock__tab {
  font-size: 10px;
  letter-spacing: -0.02em;
}

.is-dense .liquid-dock__tab span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 2px;
}

.liquid-dock__tab.is-active {
  color: rgba(15, 8, 30, 0.95);
  font-weight: 650;
  background: rgba(255, 255, 255, 0.28);
  border: 0.5px solid rgba(255, 255, 255, 0.65);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    inset 0 -1px 0 rgba(255, 255, 255, 0.3),
    inset 0 0 14px rgba(255, 255, 255, 0.25),
    0 2px 10px rgba(40, 20, 60, 0.08);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
}

.liquid-dock__tab:active {
  transform: scale(0.96);
}

.is-dark .liquid-dock__tab {
  color: rgba(255, 255, 255, 0.62);
}

.is-dark .liquid-dock__tab.is-active {
  color: rgba(255, 255, 255, 0.96);
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
</style>
