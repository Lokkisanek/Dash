<script setup>
import { computed } from 'vue'
import { Minus, Plus, Thermometer } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'

const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
})

const { getEntityState, setClimateTemp } = useHomeAssistant()
const { t } = useI18n()

const entity = computed(() => getEntityState(props.entityId))

const current = computed(() => {
  const t = entity.value?.attributes?.current_temperature
  return t != null ? Number(t) : null
})

const target = computed(() => {
  const t = entity.value?.attributes?.temperature
  return t != null ? Number(t) : 21
})

const min = computed(() => entity.value?.attributes?.min_temp ?? 16)
const max = computed(() => entity.value?.attributes?.max_temp ?? 28)

async function adjust(delta) {
  unlockAudio()
  const next = Math.round((target.value + delta) * 2) / 2
  const clamped = Math.max(min.value, Math.min(max.value, next))
  await setClimateTemp(props.entityId, clamped)
}
</script>

<template>
  <div class="card bg-base-100 shadow-none h-full select-none">
    <div class="card-body p-4 gap-2 justify-between">
      <div class="flex items-start justify-between">
        <div class="btn btn-circle btn-sm pointer-events-none border-0 bg-error/15 text-error">
          <Thermometer :size="18" />
        </div>
        <div class="text-right">
          <p class="text-2xl font-semibold tabular-nums tracking-tight leading-none">
            {{ target.toFixed(1) }}°
          </p>
          <p v-if="current != null" class="text-xs text-base-content/40 mt-1 tabular-nums">
            {{ t('climateNow') }} {{ current.toFixed(1) }}°
          </p>
        </div>
      </div>

      <div>
        <h3 class="card-title text-[15px] font-semibold tracking-tight">{{ label }}</h3>
        <div class="join w-full mt-2">
          <button
            type="button"
            class="btn btn-sm join-item flex-1 bg-base-200 border-0"
            :aria-label="t('climateDown')"
            @click="adjust(-0.5)"
          >
            <Minus :size="16" />
          </button>
          <button
            type="button"
            class="btn btn-sm join-item flex-1 bg-base-200 border-0"
            :aria-label="t('climateUp')"
            @click="adjust(0.5)"
          >
            <Plus :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
