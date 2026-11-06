<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { mountSvgLiquidGlass, DOCK_GLASS } from '@/lib/liquidGlassSvg'
import { resolveIcon } from '@/lib/icons'
import { unlockAudio } from '@/composables/useSound'

const props = defineProps({
  /** @type {{ id: string, label?: string, showLabel?: boolean, icon?: string }[]} */
  items: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const glassRef = ref(null)
const svgRef = ref(null)
let glass = null

const DOCK_H = 88
const DOCK_R = 44

const visibleItems = computed(() => (props.items || []).filter((i) => i?.id).slice(0, 4))

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

  const dockWidth = Math.min(360, Math.max(280, window.innerWidth - 40))
  glassEl.style.width = `${dockWidth}px`
  glassEl.style.height = `${DOCK_H}px`
  glassEl.style.borderRadius = `${DOCK_R}px`

  try {
    glass = mountSvgLiquidGlass(glassEl, defsHost, {
      ...DOCK_GLASS,
      width: dockWidth,
      height: DOCK_H,
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
}

onMounted(async () => {
  await nextTick()
  mountGlass()
})

watch(visibleItems, async () => {
  await nextTick()
  mountGlass()
})

onUnmounted(() => {
  glass?.destroy()
  glass = null
})
</script>

<template>
  <div v-if="visibleItems.length" class="liquid-dock">
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
      :style="{
        width: 'min(360px, calc(100vw - 40px))',
        height: `${DOCK_H}px`,
        borderRadius: `${DOCK_R}px`,
      }"
    >
      <nav class="liquid-dock__nav" aria-label="Rooms">
        <button
          v-for="item in visibleItems"
          :key="item.id"
          type="button"
          class="liquid-dock__tab"
          :class="{
            'is-active': item.id === modelValue,
            'is-icon-only': !showName(item),
          }"
          :aria-current="item.id === modelValue ? 'page' : undefined"
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
.liquid-dock {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  justify-content: center;
  padding: 0 20px calc(16px + env(safe-area-inset-bottom, 0px));
  pointer-events: none;
  background: transparent;
}

.liquid-dock__defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.liquid-dock__glass {
  position: relative;
  pointer-events: auto;
  isolation: isolate;
  background: rgba(255, 255, 255, 0.06);
  border: 0.5px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    0 8px 28px rgba(40, 20, 60, 0.12),
    0 1px 0 rgba(255, 255, 255, 0.55) inset,
    0 -1px 0 rgba(255, 255, 255, 0.25) inset;
}

.liquid-dock__glass::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  isolation: isolate;
  backdrop-filter: blur(22px) saturate(1.85) brightness(1.05);
  -webkit-backdrop-filter: blur(22px) saturate(1.85) brightness(1.05);
  backdrop-filter: var(--lg-filter, blur(22px) saturate(1.85) brightness(1.05));
  -webkit-backdrop-filter: var(--lg-filter, blur(22px) saturate(1.85) brightness(1.05));
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
</style>
