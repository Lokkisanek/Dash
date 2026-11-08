<script setup>
import { ref, watch } from 'vue'
import { Clapperboard } from 'lucide-vue-next'
import { libraryApi } from '@/composables/useHomeAssistant'

/**
 * A poster through the integration (an opaque id, never an upstream URL).
 * Until it loads, or without one: a flat tonal surface with an icon.
 */
const props = defineProps({
  token: { type: String, default: '' },
  alt: { type: String, default: '' },
})

const cache = (globalThis.__dashPosters ||= new Map())
const src = ref('')
watch(
  () => props.token,
  async (token) => {
    src.value = cache.get(token) || ''
    if (!token || src.value) return
    try {
      const url = await libraryApi().poster(token)
      cache.set(token, url)
      if (props.token === token) src.value = url
    } catch {
      src.value = ''
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="poster" data-poster>
    <img v-if="src" :src="src" :alt="alt" draggable="false" />
    <Clapperboard v-else :size="22" aria-hidden="true" />
  </div>
</template>

<style scoped>
.poster {
  aspect-ratio: 2 / 3;
  width: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-base-200));
  color: color-mix(in srgb, var(--color-base-content) 45%, transparent);
}

.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
