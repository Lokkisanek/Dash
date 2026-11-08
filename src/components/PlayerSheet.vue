<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { X, ChevronLeft, Music, Folder, Disc3, User, ListMusic, Play, MoreHorizontal, Power, Link2, Unlink } from 'lucide-vue-next'
import { useHomeAssistant, mediaBrowser, haAssetUrl } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { mediaCaps, mediaVolume, MEDIA_ENQUEUE } from '@/lib/mediaCaps'
import MediaStage from './tiles/MediaStage.vue'
import { engineKeyFor, getEngine } from '@/lib/player/engines'
import { isHttpsUrl } from '@/lib/player/browserEngine'

/**
 * Full-screen player sheet of a media tile. Tabs appear only when they make
 * sense for the active player:
 *   Teď hraje   always
 *   Přehrávače  when the tile offers more than one player
 *   Procházet   BROWSE_MEDIA (and, for a guest, the profile's media_browse)
 *   Hledat      SEARCH_MEDIA (same rule)
 *   Zdroje      dash's own players (lib/player): a stream address for the
 *               browser radio; Spotify devices and "Spustit přehrávání zde"
 * No queue tab: Home Assistant has no standard queue API (docs/SPEAKERS.md).
 * Same rules as the light sheet: dialog, focus trap, Esc, swipe down, no
 * scrolling or swiping of the page behind it.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  entityId: { type: String, required: true },
  label: { type: String, default: '' },
  variant: { type: String, default: 'nowplaying' },
  outputs: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const SPEAKER_GUIDE = 'https://github.com/Lokkisanek/Dash/blob/main/docs/SPEAKERS.md'

const { entities, getEntityState, mediaCommand, mode } = useHomeAssistant()
const { capabilities } = useGuestConfig()
const { t } = useI18n()

/** Players of this tile: its own and the configured outputs, else every player we can see. */
/** browser | spotify for dash's own engines, '' for a Home Assistant player */
const engineKey = computed(() => engineKeyFor(props.entityId))
const players = computed(() => {
  if (engineKey.value) return [props.entityId]
  const list = props.outputs?.length ? [props.entityId, ...props.outputs] : [props.entityId, ...Object.keys(entities.value || {}).filter((id) => id.startsWith('media_player.'))]
  return [...new Set(list)].filter((id) => getEntityState(id))
})
const active = ref(props.entityId)
watch(() => props.entityId, (id) => (active.value = id))
const activeEntity = computed(() => getEntityState(active.value))
const caps = computed(() => mediaCaps(activeEntity.value))
const guest = computed(() => mode.value === 'guest')
// an engine decides itself what a guest may browse (stations vs. the HA media folder)
const canBrowse = computed(() => caps.value.browseMedia && (Boolean(engineKey.value) || !guest.value || capabilities.value?.media_browse === true))
const canSearch = computed(() => caps.value.searchMedia && (Boolean(engineKey.value) || !guest.value || capabilities.value?.media_browse === true))
const canGroup = computed(() => caps.value.grouping && (!guest.value || capabilities.value?.media_group === true))
const canPlayMedia = computed(() => caps.value.playMedia)

const tabs = computed(() => [
  ['now', t('tabNow')],
  ...(players.value.length > 1 ? [['players', t('tabPlayers')]] : []),
  ...(engineKey.value ? [['sources', t('tabSources')]] : []),
  ...(canBrowse.value ? [['browse', t('tabBrowse')]] : []),
  ...(canSearch.value ? [['search', t('tabSearch')]] : []),
])
const tab = ref('now')
watch(tabs, (list) => {
  if (!list.some(([k]) => k === tab.value)) tab.value = 'now'
})

const name = (id) => getEntityState(id)?.attributes?.friendly_name || id

// ── players ──────────────────────────────────────────────────────────────────
const members = computed(() => activeEntity.value?.attributes?.group_members || [active.value])
function volumeOf(id) {
  return Math.round(mediaVolume(getEntityState(id)) * 100)
}
const volumeMax = computed(() => Math.round((capabilities.value?.max_volume ?? 1) * 100))
const volTimers = {}
function setVolume(id, value) {
  clearTimeout(volTimers[id])
  volTimers[id] = setTimeout(() => mediaCommand(id, 'volume_set', { volume_level: Math.min(volumeMax.value, value) / 100 }), 150)
}
function power(id) {
  const st = getEntityState(id)?.state
  mediaCommand(id, st === 'off' ? 'turn_on' : 'turn_off')
}
function toggleGroup(id) {
  if (members.value.includes(id)) mediaCommand(id, 'unjoin')
  else mediaCommand(active.value, 'join', { group_members: [id] })
}

// ── browse / search ──────────────────────────────────────────────────────────
const crumbs = ref([]) // [{ title, type, id }]
const listing = ref(null)
const loading = ref(false)
const failed = ref('')
const menuFor = ref('')

async function load(type, id, title) {
  loading.value = true
  failed.value = ''
  menuFor.value = ''
  try {
    const res = await mediaBrowser.browse(active.value, type, id)
    listing.value = res
    if (id) crumbs.value = [...crumbs.value, { title: title || res.title, type, id }]
    else crumbs.value = []
  } catch (err) {
    failed.value = err?.code || err?.message || 'error'
  } finally {
    loading.value = false
  }
}
function back() {
  const list = crumbs.value.slice(0, -1)
  const prev = list.at(-1)
  crumbs.value = list.slice(0, -1)
  if (prev) load(prev.type, prev.id, prev.title)
  else load()
}

const query = ref('')
const results = ref([])
let searchTimer = 0
watch(query, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) {
    results.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    loading.value = true
    failed.value = ''
    try {
      const res = await mediaBrowser.search(active.value, q.trim())
      results.value = res?.result || res?.children || []
    } catch (err) {
      failed.value = err?.code || err?.message || 'error'
    } finally {
      loading.value = false
    }
  }, 350)
})
/** Search results grouped by media class (artists, albums, tracks, …). */
const grouped = computed(() => {
  const map = new Map()
  for (const item of results.value) {
    const key = item.media_class || 'other'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return [...map.entries()]
})

watch(tab, (k) => {
  if (k === 'browse' && !listing.value) load()
  if (k === 'sources' && engineKey.value === 'spotify') loadDevices()
})

// ── sources (dash engines) ───────────────────────────────────────────────────
const streamUrl = ref('')
const streamError = ref('')
async function playStream() {
  streamError.value = ''
  if (!isHttpsUrl(streamUrl.value.trim())) {
    streamError.value = t('httpsOnly')
    return
  }
  try {
    await getEngine('browser').playUrl(streamUrl.value.trim())
    tab.value = 'now'
  } catch {
    streamError.value = t('streamUnavailable')
  }
}
const devices = ref([])
async function loadDevices() {
  try {
    devices.value = (await getEngine('spotify').devices()) || []
  } catch {
    devices.value = []
  }
}
const canPlayHere = computed(() => engineKey.value === 'spotify' && !guest.value && Boolean(getEngine('spotify')))
async function playHereBrowser() {
  try {
    await getEngine('spotify').playHere(navigator.platform || 'web')
  } catch (err) {
    failed.value = err?.message || 'error'
  }
}
watch(active, () => {
  listing.value = null
  crumbs.value = []
  results.value = []
  if (tab.value === 'browse') load()
})

const ICONS = { artist: User, album: Disc3, playlist: ListMusic, track: Music, directory: Folder }
const iconFor = (item) => ICONS[item.media_class] || (item.can_expand ? Folder : Music)
/** Owner mode shows HA thumbnails; a guest never gets them (they are HA URLs). */
const thumb = (item) => (!guest.value && item.thumbnail ? haAssetUrl(item.thumbnail) : '')

// not `open`: in the template that name is the prop
function openItem(item) {
  if (item.can_expand) load(item.media_content_type, item.media_content_id, item.title)
  else if (item.can_play) play(item)
}
function play(item, enqueue = MEDIA_ENQUEUE.PLAY) {
  if (!canPlayMedia.value) return
  menuFor.value = ''
  const data = { media_content_type: item.media_content_type, media_content_id: item.media_content_id }
  if (caps.value.enqueue) data.enqueue = enqueue
  mediaCommand(active.value, 'play_media', data)
}

// ── sheet behaviour ──────────────────────────────────────────────────────────
const panel = ref(null)
let returnFocus = null
const dragY = ref(0)
let drag = null
function close() {
  emit('close')
}
function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll('button, input, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled)
  if (!items.length) return
  const first = items[0]
  const last = items.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}
function onHandleDown(e) {
  drag = { y: e.clientY }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function onHandleMove(e) {
  if (drag) dragY.value = Math.max(0, e.clientY - drag.y)
}
function onHandleUp() {
  if (!drag) return
  drag = null
  if (dragY.value > 80) close()
  dragY.value = 0
}
watch(
  () => props.open,
  async (isOpen) => {
    document.documentElement.classList.toggle('sheet-open', isOpen)
    if (isOpen) {
      returnFocus = document.activeElement
      tab.value = 'now'
      active.value = props.entityId
      await nextTick()
      panel.value?.querySelector('[role="tab"], button')?.focus()
    } else if (returnFocus?.focus) {
      returnFocus.focus()
      returnFocus = null
    }
  },
)
onUnmounted(() => {
  document.documentElement.classList.remove('sheet-open')
  clearTimeout(searchTimer)
  Object.values(volTimers).forEach(clearTimeout)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="psheet">
      <div v-if="open" class="ps-backdrop" data-no-swipe @click.self="close" @keydown="onKeydown">
        <div
          ref="panel"
          class="player-sheet"
          role="dialog"
          aria-modal="true"
          :aria-label="label || name(active)"
          :style="dragY ? { transform: `translateY(${dragY}px)` } : null"
          data-player-sheet
        >
          <div class="grab" aria-hidden="true" @pointerdown="onHandleDown" @pointermove="onHandleMove" @pointerup="onHandleUp" @pointercancel="onHandleUp" />
          <header class="ps-head">
            <div class="ps-tabs" role="tablist">
              <button
                v-for="[key, text] in tabs"
                :key="key"
                type="button"
                role="tab"
                class="ps-tab"
                :class="{ active: tab === key }"
                :aria-selected="tab === key"
                :data-tab="key"
                @click="tab = key"
              >
                {{ text }}
              </button>
            </div>
            <button type="button" class="ps-close" :aria-label="t('close')" @click="close"><X :size="20" /></button>
          </header>

          <div class="ps-body">
            <!-- now playing -->
            <div v-if="tab === 'now'" class="ps-now">
              <p v-if="active !== entityId" class="ps-on">{{ name(active) }}</p>
              <MediaStage :entity-id="active" :label="name(active)" :variant="variant === 'vinyl' ? 'vinyl' : 'nowplaying'" large />
              <p v-if="!canBrowse && !canSearch" class="ps-hint" data-speaker-hint>
                {{ t('noBrowseHint') }}
                <a :href="SPEAKER_GUIDE" target="_blank" rel="noopener">{{ t('speakerGuide') }}</a>
              </p>
            </div>

            <!-- sources: dash's own players -->
            <div v-else-if="tab === 'sources'" class="ps-sources" data-sources>
              <form v-if="engineKey === 'browser'" class="ps-stream" @submit.prevent="playStream">
                <label class="ps-label" for="ps-stream-url">{{ t('streamUrl') }}</label>
                <div class="ps-stream-row">
                  <input id="ps-stream-url" v-model="streamUrl" type="url" inputmode="url" class="ps-input" placeholder="https://" />
                  <button type="submit" class="pp-btn">{{ t('streamPlay') }}</button>
                </div>
                <p v-if="streamError" class="ps-hint" role="alert">{{ streamError }}</p>
              </form>
              <template v-else>
                <button v-if="canPlayHere" type="button" class="pp-btn ps-here" data-play-here @click="playHereBrowser">{{ t('playHereBrowser') }}</button>
                <h3 class="ps-label">{{ t('spotifyDevices') }}</h3>
                <p v-if="!devices.length" class="ps-hint">{{ t('noDevices') }}</p>
                <ul class="ps-players">
                  <li v-for="d in devices" :key="d.id" class="ps-player" :class="{ active: d.is_active }">
                    <div class="pp-row">
                      <div class="pp-name"><strong>{{ d.name }}</strong><span>{{ d.type }}</span></div>
                      <button v-if="!d.is_active && !guest" type="button" class="pp-btn" @click="getEngine('spotify').transfer(d.id)">{{ t('playHere') }}</button>
                    </div>
                  </li>
                </ul>
              </template>
            </div>

            <!-- players -->
            <ul v-else-if="tab === 'players'" class="ps-players">
              <li v-for="id in players" :key="id" class="ps-player" :class="{ active: id === active }" :data-player="id">
                <div class="pp-row">
                  <div class="pp-name">
                    <strong>{{ name(id) }}</strong>
                    <span>{{ getEntityState(id)?.state }}</span>
                  </div>
                  <button v-if="id !== active" type="button" class="pp-btn" @click="active = id">{{ t('playHere') }}</button>
                  <button
                    v-if="canGroup && id !== active && mediaCaps(getEntityState(id)).grouping"
                    type="button"
                    class="pp-icon"
                    :aria-pressed="members.includes(id)"
                    :aria-label="members.includes(id) ? t('ungroup') : t('group')"
                    :title="members.includes(id) ? t('ungroup') : t('group')"
                    @click="toggleGroup(id)"
                  >
                    <Unlink v-if="members.includes(id)" :size="16" /><Link2 v-else :size="16" />
                  </button>
                  <button
                    v-if="mediaCaps(getEntityState(id)).turnOn || mediaCaps(getEntityState(id)).turnOff"
                    type="button"
                    class="pp-icon"
                    :aria-label="t('power')"
                    @click="power(id)"
                  >
                    <Power :size="16" />
                  </button>
                </div>
                <input
                  v-if="mediaCaps(getEntityState(id)).volumeSet"
                  type="range"
                  min="0"
                  :max="volumeMax"
                  :value="volumeOf(id)"
                  class="range range-xs range-primary w-full"
                  :aria-label="`${t('volume')} ${name(id)}`"
                  @input="setVolume(id, Number($event.target.value))"
                />
              </li>
            </ul>

            <!-- browse -->
            <div v-else-if="tab === 'browse'" class="ps-browse">
              <nav class="crumbs" :aria-label="t('tabBrowse')">
                <button v-if="crumbs.length" type="button" class="pp-icon" :aria-label="t('back')" @click="back"><ChevronLeft :size="18" /></button>
                <span>{{ crumbs.length ? crumbs.map((c) => c.title).join(' / ') : listing?.title || '…' }}</span>
              </nav>
              <p v-if="failed" class="ps-hint">{{ t('browseFailed') }}</p>
              <ul v-else class="items" :aria-busy="loading">
                <li v-for="item in listing?.children || []" :key="item.media_content_id" class="item" :data-item="item.media_content_id">
                  <button type="button" class="item-main" @click="openItem(item)">
                    <img v-if="thumb(item)" :src="thumb(item)" alt="" loading="lazy" />
                    <component :is="iconFor(item)" v-else :size="18" class="item-icon" />
                    <span class="item-title">{{ item.title }}</span>
                  </button>
                  <template v-if="item.can_play && canPlayMedia">
                    <button v-if="caps.enqueue" type="button" class="pp-icon" :aria-label="t('mediaMore')" :aria-expanded="menuFor === item.media_content_id" @click="menuFor = menuFor === item.media_content_id ? '' : item.media_content_id">
                      <MoreHorizontal :size="16" />
                    </button>
                    <button type="button" class="pp-icon" :aria-label="t('playNow')" @click="play(item)"><Play :size="16" fill="currentColor" /></button>
                  </template>
                  <div v-if="menuFor === item.media_content_id" class="item-menu">
                    <button type="button" class="pp-btn" @click="play(item, MEDIA_ENQUEUE.NEXT)">{{ t('playNext') }}</button>
                    <button type="button" class="pp-btn" @click="play(item, MEDIA_ENQUEUE.ADD)">{{ t('addQueue') }}</button>
                  </div>
                </li>
              </ul>
            </div>

            <!-- search -->
            <div v-else-if="tab === 'search'" class="ps-search">
              <input v-model="query" type="search" class="ps-input" :placeholder="t('searchPh')" :aria-label="t('tabSearch')" data-search-input />
              <p v-if="failed" class="ps-hint">{{ t('browseFailed') }}</p>
              <p v-else-if="query && !loading && !results.length" class="ps-hint">{{ t('noResults') }}</p>
              <section v-for="[cls, items] in grouped" :key="cls" class="group">
                <h3>{{ t(`mediaClass_${cls}`) === `mediaClass_${cls}` ? cls : t(`mediaClass_${cls}`) }}</h3>
                <ul class="items">
                  <li v-for="item in items" :key="item.media_content_id" class="item" :data-item="item.media_content_id">
                    <button type="button" class="item-main" @click="item.can_play ? play(item) : (tab = 'browse', load(item.media_content_type, item.media_content_id, item.title))">
                      <component :is="iconFor(item)" :size="18" class="item-icon" />
                      <span class="item-title">{{ item.title }}</span>
                    </button>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ps-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  touch-action: none;
  overscroll-behavior: contain;
}

.player-sheet {
  width: 100%;
  max-width: 560px;
  height: calc(100% - var(--safe-top, 0px) - 12px);
  display: flex;
  flex-direction: column;
  border-radius: 28px 28px 0 0;
  background: var(--color-base-100);
  color: var(--color-base-content);
  padding: 0 18px calc(16px + var(--safe-bottom, 0px));
  transition: transform 0.2s ease;
}

@media (min-width: 768px) {
  .ps-backdrop {
    align-items: center;
  }
  .player-sheet {
    height: min(820px, 92vh);
    border-radius: 28px;
  }
}

.grab {
  height: 22px;
  display: grid;
  place-items: center;
  touch-action: none;
  cursor: grab;
}

.grab::before {
  content: '';
  width: 40px;
  height: 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-base-content) 22%, transparent);
}

.ps-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.ps-tabs {
  flex: 1;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  touch-action: pan-x;
}

.ps-tab {
  flex-shrink: 0;
  padding: 8px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: color-mix(in srgb, var(--color-base-content) 60%, transparent);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.ps-tab.active {
  background: var(--color-base-content);
  color: var(--color-base-100);
}

.ps-close,
.pp-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-base-content) 8%, transparent);
  color: inherit;
  cursor: pointer;
}

.ps-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
}

.ps-now {
  display: grid;
  gap: 14px;
}

.ps-on {
  font-size: 13px;
  color: var(--color-primary);
}

.ps-hint {
  font-size: 13px;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

.ps-hint a {
  color: var(--color-primary);
  text-decoration: underline;
}

.ps-sources {
  display: grid;
  gap: 12px;
}

.ps-label {
  font-size: 13px;
  font-weight: 600;
  color: color-mix(in srgb, var(--color-base-content) 60%, transparent);
}

.ps-stream {
  display: grid;
  gap: 6px;
}

.ps-stream-row {
  display: flex;
  gap: 8px;
}

.ps-stream-row .ps-input {
  flex: 1;
  min-width: 0;
}

.ps-here {
  justify-self: start;
}

.ps-players,
.items {
  display: grid;
  gap: 2px;
}

.ps-player {
  display: grid;
  gap: 8px;
  padding: 12px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-base-content) 8%, transparent);
}

.ps-player.active strong {
  color: var(--color-primary);
}

.pp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pp-name {
  flex: 1;
  min-width: 0;
  display: grid;
}

.pp-name span {
  font-size: 12px;
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
}

.pp-btn {
  flex-shrink: 0;
  padding: 6px 12px;
  border: 1px solid color-mix(in srgb, var(--color-base-content) 14%, transparent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
}

.crumbs span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.item-main img {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
}

.item-icon {
  flex-shrink: 0;
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
}

.item-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-menu {
  flex-basis: 100%;
  display: flex;
  gap: 6px;
  padding: 0 0 6px 34px;
}

.ps-input {
  width: 100%;
  padding: 10px 14px;
  margin-bottom: 10px;
  border: 1px solid color-mix(in srgb, var(--color-base-content) 14%, transparent);
  border-radius: 14px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.group h3 {
  margin: 10px 0 2px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
}

.psheet-enter-active,
.psheet-leave-active {
  transition: opacity 0.22s ease;
}
.psheet-enter-from,
.psheet-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .player-sheet {
    transition: none;
  }
}
</style>
