<script setup>
import { computed } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { unlockAudio } from '@/composables/useSound'
import { resolveIcon } from '@/lib/icons'

const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  icon: { type: String, default: 'Power' },
})

const { getEntityState, toggleSwitch } = useHomeAssistant()

const entity = computed(() => getEntityState(props.entityId))
const isOn = computed(() => entity.value?.state === 'on')
const Icon = computed(() => resolveIcon(props.icon, 'Power'))

async function onToggle() {
  unlockAudio()
  await toggleSwitch(props.entityId)
}
</script>

<template>
  <button
    type="button"
    class="card bg-base-100 shadow-none min-h-[156px] w-full text-left select-none active:scale-[0.98] transition-transform duration-150"
    :class="isOn ? 'ring-1 ring-info/30' : ''"
    @click="onToggle"
  >
    <div class="card-body p-4 gap-2 justify-between">
      <div class="flex items-start justify-between">
        <div
          class="btn btn-circle btn-sm pointer-events-none border-0"
          :class="isOn ? 'bg-info text-info-content' : 'bg-base-200 text-base-content/40'"
        >
          <component :is="Icon" :size="18" />
        </div>
        <span class="badge badge-soft badge-sm" :class="isOn ? 'badge-info' : 'badge-ghost'">
          {{ isOn ? 'Zap' : 'Vyp' }}
        </span>
      </div>

      <div>
        <h3 class="card-title text-[15px] font-semibold tracking-tight">{{ label }}</h3>
        <p class="text-xs" :class="isOn ? 'text-info' : 'text-base-content/40'">
          {{ isOn ? 'Zapnuto' : 'Vypnuto' }}
        </p>
      </div>
    </div>
  </button>
</template>
