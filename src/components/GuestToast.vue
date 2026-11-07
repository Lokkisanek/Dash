<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { useHomeAssistant } from '@/composables/useHomeAssistant'

/** One short line after a refused guest action. */
const { toast } = useHomeAssistant()
const text = ref('')
let timer = 0

watch(
  () => toast.value?.id,
  () => {
    if (!toast.value) return
    text.value = toast.value.text
    clearTimeout(timer)
    timer = setTimeout(() => {
      text.value = ''
    }, 2800)
  },
)
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <Transition name="guest-toast">
    <div v-if="text" class="toast toast-top toast-center z-50 pt-[max(12px,env(safe-area-inset-top))]" role="status">
      <div class="alert alert-soft text-sm shadow-none" data-testid="guest-toast">{{ text }}</div>
    </div>
  </Transition>
</template>

<style scoped>
.guest-toast-enter-active,
.guest-toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.guest-toast-enter-from,
.guest-toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
