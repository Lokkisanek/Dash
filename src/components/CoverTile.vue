<script setup>
import { computed } from 'vue'
import { Blinds, ChevronUp, ChevronDown, Square } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { unlockAudio } from '@/composables/useSound'

const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
})

const { getEntityState, setCover } = useHomeAssistant()

const entity = computed(() => getEntityState(props.entityId))
const position = computed(() => entity.value?.attributes?.current_position ?? null)
const statusLabel = computed(() => {
  const s = entity.value?.state
  if (s === 'open') return 'Otevřeno'
  if (s === 'closed') return 'Zavřeno'
  if (s === 'opening') return 'Otevírá se…'
  if (s === 'closing') return 'Zavírá se…'
  return s || '—'
})

async function action(kind) {
  unlockAudio()
  await setCover(props.entityId, kind)
}
</script>

<template>
  <div class="card bg-base-100 shadow-none min-h-[156px] select-none">
    <div class="card-body p-4 gap-2 justify-between">
      <div class="flex items-start justify-between">
        <div class="btn btn-circle btn-sm pointer-events-none border-0 bg-base-200 text-base-content/50">
          <Blinds :size="18" />
        </div>
        <span v-if="position != null" class="badge badge-ghost badge-sm tabular-nums">
          {{ position }}%
        </span>
      </div>

      <div>
        <h3 class="card-title text-[15px] font-semibold tracking-tight">{{ label }}</h3>
        <p class="text-xs text-base-content/40">{{ statusLabel }}</p>

        <div class="join w-full mt-2">
          <button
            type="button"
            class="btn btn-sm join-item flex-1 bg-base-200 border-0"
            aria-label="Nahoru"
            @click="action('open')"
          >
            <ChevronUp :size="16" />
          </button>
          <button
            type="button"
            class="btn btn-sm join-item flex-1 bg-base-200 border-0"
            aria-label="Stop"
            @click="action('stop')"
          >
            <Square :size="12" fill="currentColor" />
          </button>
          <button
            type="button"
            class="btn btn-sm join-item flex-1 bg-base-200 border-0"
            aria-label="Dolů"
            @click="action('close')"
          >
            <ChevronDown :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
