<script setup>
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { guestDashboard } from '@/config/guestDashboard'
import { resolveIcon } from '@/lib/icons'

const { activateScene } = useHomeAssistant()

const scenes = guestDashboard.scenes

function iconFor(name) {
  return resolveIcon(name, 'Sparkles')
}

async function onScene(scene) {
  await activateScene(scene.entityId)
}
</script>

<template>
  <div class="flex gap-2.5 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-1 px-1 pb-1">
    <button
      v-for="scene in scenes"
      :key="scene.id"
      type="button"
      class="btn btn-sm snap-start shrink-0 gap-2 bg-base-100 border-0 shadow-none active:scale-95"
      @click="onScene(scene)"
    >
      <component
        :is="iconFor(scene.icon)"
        :size="15"
        :stroke-width="2.2"
        :style="{ color: scene.accent }"
      />
      {{ scene.label }}
    </button>
  </div>
</template>
