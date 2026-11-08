<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { X, ChevronLeft, Search, Pause, Play, Trash2, RefreshCw } from 'lucide-vue-next'
import { useHomeAssistant, libraryApi } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { statusBadge, viewReleases, formatSize, formatSpeed, formatEta, sortActivity } from '@/lib/library/releases'
import LibraryPoster from './LibraryPoster.vue'

/**
 * Videotéka (docs/LIBRARY.md): Objevit | Hledat | Stahování | Žádosti (owner).
 * Detail: poster, title, year, overview, status; owner: "Automaticky" or
 * "Vybrat release" (the picker lists releases, "Stáhnout" grabs one); a guest:
 * "Požádat" (and the picker only with library_pick_release). Same rules as the
 * other sheets: dialog, focus trap, Esc, swipe down, no page scroll behind.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  startTab: { type: String, default: 'discover' },
  startQuery: { type: String, default: '' },
  startItem: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const { mode } = useHomeAssistant()
const { capabilities } = useGuestConfig()
const { t } = useI18n()
const guest = computed(() => mode.value === 'guest')
const can = (key) => !guest.value || capabilities.value?.[key] === true

const tabs = computed(() => [
  ...(can('library_browse') ? [['discover', t('libDiscover')], ['search', t('libSearch')]] : []),
  ...(can('library_activity') ? [['activity', t('libActivity')]] : []),
  ...(guest.value ? (can('library_request') ? [['requests', t('libMyRequests')]] : []) : [['requests', t('libRequests')]]),
])
const tab = ref('discover')
const error = ref('')
const loading = ref(false)

// ── discover / search ────────────────────────────────────────────────────────
const items = ref([])
const query = ref('')
const results = ref([])
async function loadDiscover() {
  error.value = ''
  loading.value = true
  try {
    items.value = await libraryApi().discover('all')
  } catch (err) {
    error.value = err?.code || 'error'
  } finally {
    loading.value = false
  }
}
let searchTimer = 0
watch(query, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) {
    results.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    error.value = ''
    loading.value = true
    try {
      results.value = await libraryApi().search(q.trim())
    } catch (err) {
      error.value = err?.code || 'error'
    } finally {
      loading.value = false
    }
  }, 350)
})

// ── detail and release picker ────────────────────────────────────────────────
const detail = ref(null)
const picker = ref(null) // { releases, loading, sort, filter, showRejected, requestId }
const notice = ref('')
async function openItem(item) {
  notice.value = ''
  error.value = ''
  detail.value = item
  try {
    detail.value = await libraryApi().detail(item.mediaType, item.tmdbId)
  } catch (err) {
    error.value = err?.code || 'error'
  }
}
function back() {
  if (picker.value) closePicker()
  else detail.value = null
}
async function requestAuto() {
  const d = detail.value
  try {
    const res = await libraryApi().request(d.mediaType, d.tmdbId)
    detail.value = { ...d, ...(res.status && STATUS_KEYS.includes(res.status) ? res : { status: 'requested' }) }
    notice.value = guest.value ? t('libRequested') : t('libAutoDone')
  } catch (err) {
    error.value = err?.code || 'error'
  }
}
const STATUS_KEYS = ['available', 'downloading', 'monitored', 'requested', 'unrequested', 'unavailable']
async function pickRelease(requestId = '') {
  const d = detail.value
  picker.value = { releases: [], loading: true, sort: 'seeders', filter: '', showRejected: false, requestId }
  error.value = ''
  try {
    const res = await libraryApi().releases(d.mediaType, d.tmdbId)
    if (picker.value) picker.value = { ...picker.value, releases: res.releases || [], loading: false }
  } catch (err) {
    error.value = err?.code || 'error'
    if (picker.value) picker.value.loading = false
  }
}
const shown = computed(() => (picker.value ? viewReleases(picker.value.releases, picker.value) : []))
async function grab(rel) {
  const d = detail.value
  try {
    const res = await libraryApi().grab(d.mediaType, d.tmdbId, rel.guid, rel.indexerId, picker.value?.requestId)
    picker.value = null
    detail.value = { ...d, ...res }
    notice.value = t('libGrabbed')
  } catch (err) {
    error.value = err?.code || 'error'
  }
}
function closePicker() {
  const d = detail.value
  picker.value = null
  // the picker closed without a grab: the integration removes its ghost
  if (d) libraryApi().closePicker(d.mediaType, d.tmdbId).catch(() => {})
}

// ── activity ─────────────────────────────────────────────────────────────────
const activity = ref([])
let stopActivity = null
function watchActivity(on) {
  stopActivity?.()
  stopActivity = on ? libraryApi().activity((list) => (activity.value = Array.isArray(list) ? sortActivity(list) : [])) : null
}
async function torrent(action, hash) {
  try {
    await libraryApi().torrent(action, hash)
  } catch (err) {
    error.value = err?.code || 'error'
  }
}

// ── requests inbox ───────────────────────────────────────────────────────────
const requests = ref([])
const declining = ref('')
const declineNote = ref('')
async function loadRequests() {
  try {
    requests.value = (await libraryApi().requests()).items || []
  } catch (err) {
    error.value = err?.code || 'error'
  }
}
async function approve(r) {
  await libraryApi().requestUpdate(r.id, 'approve').catch((err) => (error.value = err?.code || 'error'))
  loadRequests()
}
async function decline(r) {
  await libraryApi().requestUpdate(r.id, 'decline', declineNote.value).catch((err) => (error.value = err?.code || 'error'))
  declining.value = ''
  declineNote.value = ''
  loadRequests()
}
async function pickForRequest(r) {
  await openItem({ ...r })
  pickRelease(r.id)
}

watch(tab, (k) => {
  detail.value = null
  picker.value = null
  if (k === 'discover' && !items.value.length) loadDiscover()
  if (k === 'requests') loadRequests()
  watchActivity(k === 'activity' && props.open)
})

// ── sheet behaviour (as PlayerSheet) ─────────────────────────────────────────
const panel = ref(null)
let returnFocus = null
const dragY = ref(0)
let drag = null
function close() {
  if (picker.value) closePicker()
  emit('close')
}
function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const els = [...panel.value.querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled)
  if (!els.length) return
  if (e.shiftKey && document.activeElement === els[0]) {
    e.preventDefault()
    els.at(-1).focus()
  } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
    e.preventDefault()
    els[0].focus()
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
/** Esc closes even when focus fell back to <body> (a button that disappeared). */
function onWindowKey(e) {
  if (e.key === 'Escape' && !panel.value?.contains(e.target)) {
    e.preventDefault()
    close()
  }
}
watch(
  () => props.open,
  async (isOpen) => {
    document.documentElement.classList.toggle('sheet-open', isOpen)
    window[isOpen ? 'addEventListener' : 'removeEventListener']('keydown', onWindowKey)
    if (isOpen) {
      returnFocus = document.activeElement
      const wanted = tabs.value.some(([k]) => k === props.startTab) ? props.startTab : tabs.value[0]?.[0] || 'discover'
      tab.value = wanted
      if (wanted === 'discover' && !items.value.length) loadDiscover()
      if (wanted === 'requests') loadRequests()
      watchActivity(wanted === 'activity')
      if (props.startQuery) query.value = props.startQuery
      if (props.startItem) openItem(props.startItem)
      await nextTick()
      panel.value?.querySelector('[role="tab"], button')?.focus()
    } else {
      watchActivity(false)
      returnFocus?.focus?.()
      returnFocus = null
    }
  },
)
onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKey)
  document.documentElement.classList.remove('sheet-open')
  clearTimeout(searchTimer)
  watchActivity(false)
})

const list = computed(() => (tab.value === 'search' ? results.value : items.value))
const badge = (item) => statusBadge(item)
const canPick = computed(() => !guest.value || capabilities.value?.library_pick_release === true)
const canRequest = computed(() => !guest.value || capabilities.value?.library_request === true)
</script>

<template>
  <Teleport to="body">
    <Transition name="lsheet">
      <div v-if="open" class="ls-backdrop" data-no-swipe @click.self="close" @keydown="onKeydown">
        <div
          ref="panel"
          class="library-sheet"
          role="dialog"
          aria-modal="true"
          :aria-label="t('libTitle')"
          :style="dragY ? { transform: `translateY(${dragY}px)` } : null"
          data-library-sheet
        >
          <div class="grab" aria-hidden="true" @pointerdown="onHandleDown" @pointermove="onHandleMove" @pointerup="onHandleUp" @pointercancel="onHandleUp" />
          <header class="ls-head">
            <div class="ls-tabs" role="tablist">
              <button
                v-for="[key, text] in tabs"
                :key="key"
                type="button"
                role="tab"
                class="ls-tab"
                :class="{ active: tab === key && !detail }"
                :aria-selected="tab === key"
                :data-tab="key"
                @click="tab = key; detail = null; picker = null"
              >
                {{ text }}
              </button>
            </div>
            <button type="button" class="ls-close" :aria-label="t('close')" @click="close"><X :size="20" /></button>
          </header>

          <div class="ls-body">
            <p v-if="error" class="ls-error" role="alert" data-lib-error>{{ t(`libErr_${error}`) === `libErr_${error}` ? t('libErr_generic') : t(`libErr_${error}`) }}</p>

            <!-- detail -->
            <section v-if="detail" class="ls-detail" data-lib-detail>
              <button type="button" class="ls-back" @click="back"><ChevronLeft :size="18" /> {{ t('back') }}</button>
              <template v-if="!picker">
                <div class="ls-detail-row">
                  <LibraryPoster :token="detail.poster" :alt="detail.title" class="ls-detail-poster" />
                  <div class="ls-detail-text">
                    <h2>{{ detail.title }} <span v-if="detail.year" class="muted">{{ detail.year }}</span></h2>
                    <p class="ls-badge" :data-tone="badge(detail).tone" data-lib-status>
                      {{ t(badge(detail).key) }}<template v-if="badge(detail).percent !== null"> · {{ badge(detail).percent }} %</template>
                    </p>
                    <p class="ls-overview">{{ detail.overview }}</p>
                  </div>
                </div>
                <p v-if="notice" class="ls-notice" role="status" data-lib-notice>{{ notice }}</p>
                <div v-if="['unrequested', 'requested'].includes(badge(detail).status)" class="ls-actions">
                  <button v-if="!guest" type="button" class="ls-btn" data-lib-auto @click="requestAuto">{{ t('libAuto') }}</button>
                  <button v-else-if="canRequest && badge(detail).status === 'unrequested'" type="button" class="ls-btn" data-lib-request @click="requestAuto">{{ t('libRequest') }}</button>
                  <button v-if="canPick" type="button" class="ls-btn ghost" data-lib-pick @click="pickRelease()">{{ t('libPick') }}</button>
                </div>
              </template>

              <!-- release picker -->
              <div v-else class="ls-picker" data-lib-picker>
                <h3>{{ t('libPickTitle') }} · {{ detail.title }}</h3>
                <div class="ls-tools">
                  <label class="ls-field"><Search :size="14" /><input v-model="picker.filter" type="search" :placeholder="t('libFilter')" data-lib-filter /></label>
                  <select v-model="picker.sort" :aria-label="t('libSort')" data-lib-sort>
                    <option value="seeders">{{ t('libSortSeeders') }}</option>
                    <option value="size">{{ t('libSortSize') }}</option>
                    <option value="score">{{ t('libSortScore') }}</option>
                  </select>
                  <label class="ls-check"><input v-model="picker.showRejected" type="checkbox" /> {{ t('libShowRejected') }}</label>
                  <button type="button" class="ls-btn ghost" @click="closePicker">{{ t('libCancel') }}</button>
                </div>
                <p v-if="picker.loading" class="muted" aria-live="polite">{{ t('libSearching') }}</p>
                <p v-else-if="!shown.length" class="muted">{{ t('libNoReleases') }}</p>
                <ul class="ls-releases">
                  <li v-for="r in shown" :key="`${r.indexerId}:${r.guid}`" class="ls-release" :class="{ rejected: r.rejected }" data-lib-release>
                    <div class="ls-rel-main">
                      <strong class="ls-rel-title">{{ r.title }}</strong>
                      <span class="muted">
                        {{ r.indexer }} · {{ formatSize(r.size) }} · {{ r.seeders ?? '–' }}/{{ r.leechers ?? '–' }} · {{ r.quality }}
                        <template v-if="r.languages?.length"> · {{ r.languages.join(', ') }}</template>
                        · {{ r.customFormatScore > 0 ? '+' : '' }}{{ r.customFormatScore }}
                      </span>
                      <span v-if="picker.showRejected && r.rejections?.length" class="ls-rej">{{ r.rejections.join(' · ') }}</span>
                    </div>
                    <button type="button" class="ls-btn" data-lib-grab @click="grab(r)">{{ t('libGrab') }}</button>
                  </li>
                </ul>
              </div>
            </section>

            <!-- discover / search -->
            <template v-else-if="tab === 'discover' || tab === 'search'">
              <input v-if="tab === 'search'" v-model="query" type="search" class="ls-input" :placeholder="t('libSearchPh')" :aria-label="t('libSearch')" data-lib-search />
              <p v-if="loading" class="muted" aria-live="polite">…</p>
              <ul class="ls-grid">
                <li v-for="item in list" :key="`${item.mediaType}:${item.tmdbId}`">
                  <button type="button" class="ls-item" :data-lib-item="`${item.mediaType}:${item.tmdbId}`" @click="openItem(item)">
                    <LibraryPoster :token="item.poster" :alt="''" />
                    <span class="ls-item-title">{{ item.title }}</span>
                    <span class="ls-badge" :data-tone="badge(item).tone">{{ t(badge(item).key) }}<template v-if="badge(item).percent !== null"> {{ badge(item).percent }} %</template></span>
                  </button>
                </li>
              </ul>
            </template>

            <!-- activity -->
            <ul v-else-if="tab === 'activity'" class="ls-activity" data-lib-activity>
              <li v-if="!activity.length" class="muted">{{ t('libNothingDownloading') }}</li>
              <li v-for="a in activity" :key="a.id" class="ls-act" :data-lib-act="a.id">
                <LibraryPoster :token="a.poster" class="ls-act-poster" />
                <div class="ls-act-main">
                  <strong>{{ a.title }}</strong>
                  <span v-if="a.release" class="muted ls-rel-title">{{ a.release }}</span>
                  <div class="ls-progress" role="progressbar" :aria-valuenow="Math.round(a.progress)" aria-valuemin="0" aria-valuemax="100">
                    <span :style="{ width: `${Math.round(a.progress)}%` }" />
                  </div>
                  <span class="muted tabular-nums" data-lib-progress>{{ Math.round(a.progress) }} % <template v-if="formatSpeed(a.speed)">· {{ formatSpeed(a.speed) }}</template><template v-if="formatEta(a.eta)"> · {{ formatEta(a.eta) }}</template></span>
                </div>
                <div v-if="!guest && a.hash" class="ls-act-tools">
                  <button type="button" class="ls-icon" :aria-label="t('libPause')" @click="torrent('pause', a.hash)"><Pause :size="16" /></button>
                  <button type="button" class="ls-icon" :aria-label="t('libResume')" @click="torrent('resume', a.hash)"><Play :size="16" /></button>
                  <button type="button" class="ls-icon" :aria-label="t('libRecheck')" @click="torrent('recheck', a.hash)"><RefreshCw :size="16" /></button>
                  <button type="button" class="ls-icon" :aria-label="t('libRemove')" @click="torrent('delete', a.hash)"><Trash2 :size="16" /></button>
                </div>
              </li>
            </ul>

            <!-- requests inbox -->
            <ul v-else-if="tab === 'requests'" class="ls-requests" data-lib-requests>
              <li v-if="!requests.length" class="muted">{{ t('libNoRequests') }}</li>
              <li v-for="r in requests" :key="r.id" class="ls-req" :data-lib-req="r.id">
                <LibraryPoster :token="r.poster" class="ls-act-poster" />
                <div class="ls-act-main">
                  <strong>{{ r.title }} <span v-if="r.year" class="muted">{{ r.year }}</span></strong>
                  <span class="muted">{{ r.requester }} · {{ t(`libReq_${r.status}`) }}</span>
                  <span v-if="r.note" class="muted">{{ r.note }}</span>
                  <div v-if="!guest && r.status === 'pending'" class="ls-actions">
                    <button type="button" class="ls-btn" data-lib-approve @click="approve(r)">{{ t('libApprove') }}</button>
                    <button type="button" class="ls-btn ghost" @click="pickForRequest(r)">{{ t('libPick') }}</button>
                    <button v-if="declining !== r.id" type="button" class="ls-btn ghost" @click="declining = r.id">{{ t('libDecline') }}</button>
                    <template v-else>
                      <input v-model="declineNote" class="ls-input" :placeholder="t('libDeclineNote')" maxlength="300" />
                      <button type="button" class="ls-btn" @click="decline(r)">{{ t('libDecline') }}</button>
                    </template>
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <footer class="ls-foot" data-tmdb-notice>{{ t('libTmdbNotice') }}</footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ls-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.library-sheet {
  width: min(760px, 100%);
  max-height: calc(100dvh - var(--safe-top, 0px) - 12px);
  display: flex;
  flex-direction: column;
  border-radius: 28px 28px 0 0;
  background: var(--color-base-100);
  color: var(--color-base-content);
  padding-bottom: var(--safe-bottom, 0px);
  transition: transform 0.2s ease;
}

.grab {
  width: 44px;
  height: 5px;
  margin: 8px auto 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-base-content) 22%, transparent);
  touch-action: none;
}

.ls-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 14px 8px;
}

.ls-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  flex: 1;
}

.ls-tab,
.ls-btn,
.ls-back {
  border: 0;
  border-radius: 999px;
  padding: 8px 14px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  background: transparent;
  color: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.ls-tab.active {
  background: var(--color-base-content);
  color: var(--color-base-100);
}

.ls-btn {
  background: var(--color-base-content);
  color: var(--color-base-100);
}

.ls-btn.ghost {
  background: color-mix(in srgb, var(--color-base-content) 8%, transparent);
  color: inherit;
}

.ls-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-left: 4px;
}

.ls-close,
.ls-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-base-content) 8%, transparent);
  color: inherit;
  cursor: pointer;
}

.ls-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 16px 16px;
  display: grid;
  align-content: start;
  gap: 12px;
}

.ls-input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--color-base-content) 14%, transparent);
  background: var(--color-base-200);
  color: inherit;
  font: inherit;
}

.ls-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.ls-item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.ls-item-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ls-badge {
  justify-self: start;
  font-size: 11px;
  font-weight: 650;
  color: color-mix(in srgb, var(--color-base-content) 60%, transparent);
}

.ls-badge[data-tone='success'] {
  color: var(--color-success);
}
.ls-badge[data-tone='info'] {
  color: var(--color-info);
}
.ls-badge[data-tone='warning'] {
  color: var(--color-warning);
}
.ls-badge[data-tone='accent'] {
  color: var(--color-primary);
}
.ls-badge[data-tone='none'] {
  visibility: hidden;
}

.ls-detail-row {
  display: grid;
  grid-template-columns: minmax(96px, 30%) 1fr;
  gap: 16px;
}

.ls-detail-text h2 {
  margin: 0 0 4px;
  font-size: 20px;
}

.ls-detail-text .ls-badge[data-tone='none'] {
  visibility: visible;
}

.ls-overview {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.45;
  color: color-mix(in srgb, var(--color-base-content) 75%, transparent);
}

.ls-actions,
.ls-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.ls-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--color-base-200);
  flex: 1 1 160px;
}

.ls-field input {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  min-width: 0;
  flex: 1;
  outline: none;
}

.ls-tools select {
  padding: 6px 10px;
  border-radius: 999px;
  border: 0;
  background: var(--color-base-200);
  color: inherit;
  font: inherit;
}

.ls-check {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}

.ls-releases,
.ls-activity,
.ls-requests {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.ls-release,
.ls-act,
.ls-req {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-base-content) 8%, transparent);
}

.ls-release.rejected {
  opacity: 0.6;
}

.ls-rel-main,
.ls-act-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
  font-size: 13px;
}

.ls-rel-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ls-rej {
  font-size: 12px;
  color: var(--color-error);
}

.ls-act-poster {
  width: 44px;
  flex: none;
}

.ls-act-tools {
  display: flex;
  gap: 4px;
}

.ls-progress {
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--color-base-content) 10%, transparent);
  overflow: hidden;
}

.ls-progress span {
  display: block;
  height: 100%;
  background: var(--color-primary);
  transition: width 0.6s ease;
}

.muted {
  color: color-mix(in srgb, var(--color-base-content) 55%, transparent);
  font-size: 13px;
  font-weight: 400;
}

.ls-error {
  margin: 0;
  color: var(--color-error);
  font-size: 13px;
}

.ls-notice {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.ls-foot {
  padding: 8px 16px 10px;
  font-size: 11px;
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--color-base-content) 8%, transparent);
}

.lsheet-enter-active,
.lsheet-leave-active {
  transition: opacity 0.25s ease;
}
.lsheet-enter-from,
.lsheet-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .library-sheet,
  .ls-progress span {
    transition: none;
  }
}
</style>
