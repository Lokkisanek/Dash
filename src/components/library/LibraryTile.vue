<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Clapperboard, Search } from 'lucide-vue-next'
import { useHomeAssistant, libraryApi } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { statusBadge, sortActivity } from '@/lib/library/releases'
import LibraryPoster from './LibraryPoster.vue'
import LibrarySheet from './LibrarySheet.vue'

/**
 * Videotéka tile: trending (poster row, 4×2), search (4×1), activity (list).
 * Everything opens the Videotéka sheet. The owner sees how many guest
 * requests wait.
 */
const props = defineProps({
  variant: { type: String, default: 'trending' },
  label: { type: String, default: '' },
})

const { mode } = useHomeAssistant()
const { t } = useI18n()
const guest = computed(() => mode.value === 'guest')
const open = ref(false)
const start = ref({ tab: 'discover', query: '', item: null })
const items = ref([])
const activity = ref([])
const pending = ref(0)
const query = ref('')
let stop = null

function openSheet(tab, extra = {}) {
  start.value = { tab, query: '', item: null, ...extra }
  open.value = true
}

onMounted(async () => {
  if (props.variant === 'activity') {
    stop = libraryApi().activity((list) => (activity.value = Array.isArray(list) ? sortActivity(list).slice(0, 4) : []))
  } else if (props.variant === 'trending') {
    try {
      items.value = (await libraryApi().discover('all')).slice(0, 10)
    } catch {
      items.value = []
    }
  }
  refreshPending()
})

/** Owner: how many guest requests wait (again after the sheet closes). */
async function refreshPending() {
  if (guest.value) return
  try {
    pending.value = (await libraryApi().requests()).pending || 0
  } catch {
    pending.value = 0
  }
}
function closeSheet() {
  open.value = false
  refreshPending()
}
onUnmounted(() => stop?.())
</script>

<template>
  <section class="lib-tile squircle" :class="`v-${variant}`" :data-library-tile="variant">
    <header class="lib-head">
      <button type="button" class="lib-title" @click="openSheet(pending && !guest ? 'requests' : variant === 'activity' ? 'activity' : 'discover')">
        <Clapperboard :size="18" />
        <span>{{ label || t('libTitle') }}</span>
        <span v-if="pending && !guest" class="lib-count" data-lib-pending :aria-label="t('libPendingCount')(pending)">{{ pending }}</span>
      </button>
    </header>

    <form v-if="variant === 'search'" class="lib-search" @submit.prevent="openSheet('search', { query })">
      <Search :size="16" aria-hidden="true" />
      <input v-model="query" type="search" :placeholder="t('libSearchPh')" :aria-label="t('libSearch')" data-no-swipe />
    </form>

    <ul v-else-if="variant === 'trending'" class="lib-row" data-no-swipe>
      <li v-for="item in items" :key="`${item.mediaType}:${item.tmdbId}`">
        <button type="button" class="lib-poster-btn" :aria-label="item.title" @click="openSheet('discover', { item })">
          <LibraryPoster :token="item.poster" :alt="''" />
          <span v-if="statusBadge(item).status !== 'unrequested'" class="lib-dot" :data-tone="statusBadge(item).tone" aria-hidden="true" />
        </button>
      </li>
      <li v-if="!items.length" class="lib-empty">{{ t('libEmpty') }}</li>
    </ul>

    <ul v-else class="lib-acts">
      <li v-if="!activity.length" class="lib-empty">{{ t('libNothingDownloading') }}</li>
      <li v-for="a in activity" :key="a.id" class="lib-act">
        <span class="lib-act-title">{{ a.title }}</span>
        <span class="lib-bar"><span :style="{ width: `${Math.round(a.progress)}%` }" /></span>
        <span class="lib-pct tabular-nums">{{ Math.round(a.progress) }} %</span>
      </li>
    </ul>

    <LibrarySheet :open="open" :start-tab="start.tab" :start-query="start.query" :start-item="start.item" @close="closeSheet" />
  </section>
</template>

<style scoped>
.lib-tile {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-base-content);
  overflow: hidden;
}

.lib-head {
  display: flex;
}

.lib-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  padding: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.lib-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-primary);
  color: var(--color-primary-content);
  font-size: 12px;
  text-align: center;
}

.lib-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--color-base-200);
}

.lib-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  outline: none;
}

.v-search {
  flex-direction: row;
  align-items: center;
}

.lib-row {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-x: auto;
  scrollbar-width: none;
}

.lib-row li {
  flex: 0 0 auto;
  height: 100%;
  aspect-ratio: 2 / 3;
}

.lib-poster-btn {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.lib-dot {
  position: absolute;
  right: 6px;
  top: 6px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--color-base-100);
}
.lib-dot[data-tone='success'] {
  background: var(--color-success);
}
.lib-dot[data-tone='info'] {
  background: var(--color-info);
}
.lib-dot[data-tone='warning'] {
  background: var(--color-warning);
}
.lib-dot[data-tone='accent'] {
  background: var(--color-primary);
}

.lib-acts {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.lib-act {
  display: grid;
  grid-template-columns: 1fr 80px auto;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.lib-act-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lib-bar {
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--color-base-content) 10%, transparent);
  overflow: hidden;
}

.lib-bar span {
  display: block;
  height: 100%;
  background: var(--color-primary);
}

.lib-empty {
  font-size: 13px;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}
</style>
