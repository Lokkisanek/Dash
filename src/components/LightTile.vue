<script setup>
import { computed, ref } from 'vue'
import { Lightbulb } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'

const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  supportsBrightness: { type: Boolean, default: true },
})

const { getEntityState, toggleLight, setLightBrightness } = useHomeAssistant()
const { t } = useI18n()

const dragging = ref(false)
const localPct = ref(null)

const entity = computed(() => getEntityState(props.entityId))
const isOn = computed(() => entity.value?.state === 'on')

const brightnessPct = computed(() => {
  if (localPct.value != null) return localPct.value
  const b = entity.value?.attributes?.brightness
  if (!isOn.value || b == null) return 0
  return Math.round((b / 255) * 100)
})

const displayPct = computed(() => (isOn.value ? brightnessPct.value : 0))

async function onToggle() {
  if (dragging.value) return
  unlockAudio()
  await toggleLight(props.entityId)
}

function onRangeInput(e) {
  unlockAudio()
  dragging.value = true
  const pct = Number(e.target.value)
  localPct.value = pct
  setLightBrightness(props.entityId, pct)
}

function onRangeEnd() {
  dragging.value = false
  setTimeout(() => {
    localPct.value = null
  }, 150)
}
</script>

<template>
  <div
    class="card bg-base-100 shadow-none h-full select-none active:scale-[0.98] transition-transform duration-150"
    :class="isOn ? 'ring-1 ring-primary/25' : ''"
    @click="onToggle"
  >
    <div class="card-body p-4 gap-2 justify-between">
      <div class="flex items-start justify-between gap-2">
        <div
          class="btn btn-circle btn-sm pointer-events-none border-0"
          :class="isOn ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content/40'"
        >
          <Lightbulb :size="18" :stroke-width="isOn ? 2.4 : 2" />
        </div>
        <span
          class="badge badge-soft badge-sm tabular-nums"
          :class="isOn ? 'badge-primary' : 'badge-ghost'"
        >
          {{ isOn ? `${displayPct}%` : t('offShort') }}
        </span>
      </div>

      <div>
        <h3 class="card-title text-[15px] font-semibold tracking-tight">{{ label }}</h3>
        <p class="text-xs" :class="isOn ? 'text-primary' : 'text-base-content/40'">
          {{ isOn ? t('on') : t('off') }}
        </p>
      </div>

      <input
        v-if="supportsBrightness"
        type="range"
        min="1"
        max="100"
        :value="displayPct || 1"
        class="range range-xs range-primary w-full"
        :aria-label="`${t('brightness')} ${label}`"
        @click.stop
        @pointerdown.stop
        @input.stop="onRangeInput"
        @change.stop="onRangeEnd"
        @pointerup.stop="onRangeEnd"
      />
    </div>
  </div>
</template>
