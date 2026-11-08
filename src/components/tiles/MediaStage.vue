<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Music, Pause, Play, SkipBack, SkipForward, Square, Volume2, LoaderCircle, Power } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'
import { mediaPosition, formatTime } from '@/lib/mediaBrand'
import { mediaCaps, mediaVolume } from '@/lib/mediaCaps'

/**
 * Big media views, used as tile styles and in the player sheet:
 *   nowplaying  iPhone-like: large artwork, title, artist, scrubber with times,
 *               transport row, volume
 *   vinyl       a record drawn with flat SVG circles: disc, grooves, the album art
 *               as the label (or the accent colour with a note), a spindle hole.
 *               The record is a square sized min(width, height) of its container
 *               (container queries), so it never overflows the tile. 2×2: record
 *               on top, title and artist below, no controls (a tap opens the
 *               player sheet). 4×3: record left, text, progress and transport
 *               right. 33⅓ rpm = 1.8 s per turn: one CSS animation on a wrapper
 *               <div>, paused with animation-play-state, so it stops at its
 *               current angle and goes on from there. It also stops while the
 *               tile is off-screen or the page is hidden; with reduced motion it
 *               never turns and "Přehrává se" shows the state.
 * Every control appears only when the player supports it (mediaCaps.js).
 */
const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, default: '' },
  variant: { type: String, default: 'nowplaying' }, // nowplaying | vinyl
  /** 2×2 vinyl: record only, compact text */
  compact: { type: Boolean, default: false },
  /** inside the player sheet: bigger, all controls */
  large: { type: Boolean, default: false },
})

const { getEntityState, mediaCommand, mediaArtwork } = useHomeAssistant()
const { capabilities } = useGuestConfig()
const { t } = useI18n()

const entity = computed(() => getEntityState(props.entityId))
const attrs = computed(() => entity.value?.attributes || {})
const caps = computed(() => mediaCaps(entity.value))
const phase = computed(() => caps.value.phase)
const playing = computed(() => phase.value === 'playing')
const title = computed(() => attrs.value.media_title || (phase.value === 'unavailable' ? t('unavailable') : t('mediaIdle')))
const artist = computed(() => attrs.value.media_artist || attrs.value.media_album_name || props.label)
const artwork = computed(() => mediaArtwork(props.entityId, attrs.value))
const artFailed = ref(false)
watch(artwork, () => (artFailed.value = false))
const art = computed(() => (artwork.value && !artFailed.value ? artwork.value : ''))

const now = ref(Date.now())
let clock = 0
const duration = computed(() => Number(attrs.value.media_duration) || 0)
const position = computed(() => mediaPosition(entity.value, now.value))
const showProgress = computed(() => ['playing', 'paused', 'buffering'].includes(phase.value) && duration.value > 0 && position.value != null)
const progress = computed(() => (showProgress.value ? Math.min(100, (position.value / duration.value) * 100) : 0))

const volumeMax = computed(() => Math.round((capabilities.value?.max_volume ?? 1) * 100))
const localVolume = ref(null)
const volume = computed(() => localVolume.value ?? Math.round(mediaVolume(entity.value) * 100))
let volTimer = 0

function cmd(service, data) {
  unlockAudio()
  return mediaCommand(props.entityId, service, data)
}
function onVolume(e) {
  const v = Math.min(volumeMax.value, Number(e.target.value))
  localVolume.value = v
  clearTimeout(volTimer)
  volTimer = setTimeout(async () => {
    await cmd('volume_set', { volume_level: v / 100 })
    setTimeout(() => (localVolume.value = null), 800)
  }, 120)
}
function onSeek(e) {
  if (!duration.value) return
  cmd('media_seek', { seek_position: Math.round((Number(e.target.value) / 100) * duration.value) })
}

// ── vinyl: rotate only while playing, visible and the page is shown ──────────
const root = ref(null)
const onScreen = ref(true)
const pageVisible = ref(typeof document === 'undefined' ? true : !document.hidden)
const spinning = computed(() => playing.value && onScreen.value && pageVisible.value)
let observer = null
function onVisibility() {
  pageVisible.value = !document.hidden
}

/** 28 groove circles between the label (r 19) and the rim (r 49.5), alternating width/opacity. */
const GROOVES = Array.from({ length: 28 }, (_, i) => ({ r: 21.5 + i * 0.95, w: i % 3 === 0 ? 0.28 : 0.14, o: i % 2 ? 0.18 : 0.34 }))
const clipId = `vinyl-label-${Math.random().toString(36).slice(2, 8)}`

onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 1000)
  document.addEventListener('visibilitychange', onVisibility)
  if (props.variant === 'vinyl' && 'IntersectionObserver' in window && root.value) {
    observer = new IntersectionObserver(([e]) => (onScreen.value = e.isIntersecting))
    observer.observe(root.value)
  }
})
onUnmounted(() => {
  clearInterval(clock)
  clearTimeout(volTimer)
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
})
</script>

<template>
  <section
    ref="root"
    class="stage squircle"
    :class="[`v-${variant}`, `phase-${phase}`, { compact, large }]"
    :data-media-stage="variant"
    :data-phase="phase"
  >
    <!-- artwork or record -->
    <div v-if="variant === 'vinyl'" class="vinyl-wrap">
      <!-- the slot never turns (layout, tests); the disc inside it does -->
      <div class="vinyl-slot" data-vinyl-slot>
        <div class="vinyl-disc" :class="{ spinning }" data-vinyl-disc>
          <svg class="vinyl" viewBox="0 0 100 100" role="img" :aria-label="playing ? t('mediaPlaying') : title">
            <circle cx="50" cy="50" r="49.5" class="rim" />
            <circle
              v-for="(g, i) in GROOVES"
              :key="i"
              cx="50"
              cy="50"
              :r="g.r"
              fill="none"
              stroke="currentColor"
              :stroke-width="g.w"
              :stroke-opacity="g.o"
            />
            <clipPath :id="clipId"><circle cx="50" cy="50" r="19" /></clipPath>
            <circle cx="50" cy="50" r="19" class="label-bg" />
            <image v-if="art" :href="art" x="31" y="31" width="38" height="38" preserveAspectRatio="xMidYMid slice" :clip-path="`url(#${clipId})`" @error="artFailed = true" />
            <circle cx="50" cy="50" r="1.6" class="spindle" />
            <circle cx="50" cy="50" r="49.5" class="outline" />
          </svg>
          <Music v-if="!art" class="vinyl-note" :stroke-width="2" aria-hidden="true" />
        </div>
      </div>
    </div>
    <div v-else class="np-art">
      <img v-if="art" :src="art" alt="" draggable="false" @error="artFailed = true" />
      <Music v-else :size="large ? 56 : 40" :stroke-width="1.6" />
    </div>

    <div class="np-body">
      <div class="np-text">
        <p class="np-title">{{ title }}</p>
        <p class="np-artist">{{ artist }}</p>
        <!-- shown only with reduced motion, where the record does not turn -->
        <p v-if="variant === 'vinyl' && playing" class="np-state">{{ t('mediaPlaying') }}</p>
      </div>

      <div v-if="showProgress && !compact" class="np-progress" data-no-swipe>
        <input
          v-if="caps.seek"
          type="range"
          min="0"
          max="100"
          step="0.1"
          :value="progress"
          class="scrub"
          :aria-label="t('mediaSeek')"
          @change="onSeek"
        />
        <div v-else class="scrub-bar"><span :style="{ width: `${progress}%` }" /></div>
        <div class="np-times tabular-nums">
          <span>{{ formatTime(position) }}</span><span>-{{ formatTime(Math.max(0, duration - position)) }}</span>
        </div>
      </div>

      <!-- 2×2 vinyl: no controls, a tap opens the player sheet -->
      <template v-if="variant === 'vinyl' && compact" />
      <div v-else-if="phase === 'off'" class="np-transport">
        <button v-if="caps.turnOn" type="button" class="np-btn main" :aria-label="t('on')" @click="cmd('turn_on')"><Power :size="22" /></button>
      </div>
      <div v-else-if="phase !== 'unavailable'" class="np-transport">
        <button v-if="caps.prev && !compact" type="button" class="np-btn" :aria-label="t('mediaPrev')" @click="cmd('media_previous_track')">
          <SkipBack :size="22" fill="currentColor" />
        </button>
        <button
          v-if="caps.playPause"
          type="button"
          class="np-btn main"
          :aria-label="playing ? t('mediaPause') : t('mediaPlay')"
          :aria-busy="phase === 'buffering'"
          data-play
          @click="cmd('media_play_pause')"
        >
          <LoaderCircle v-if="phase === 'buffering'" :size="26" class="spin" />
          <Pause v-else-if="playing" :size="26" fill="currentColor" />
          <Play v-else :size="26" fill="currentColor" />
        </button>
        <button v-if="caps.next && !compact" type="button" class="np-btn" :aria-label="t('mediaNext')" @click="cmd('media_next_track')">
          <SkipForward :size="22" fill="currentColor" />
        </button>
        <button v-if="caps.stop && large" type="button" class="np-btn" :aria-label="t('mediaStop')" @click="cmd('media_stop')">
          <Square :size="18" fill="currentColor" />
        </button>
      </div>

      <label v-if="caps.volumeSet && phase !== 'off' && !compact && (variant !== 'vinyl' || large)" class="np-volume" data-no-swipe>
        <Volume2 :size="15" class="shrink-0 opacity-60" />
        <input type="range" min="0" :max="volumeMax" :value="volume" class="range range-xs range-primary flex-1" :aria-label="t('volume')" @input="onVolume" />
      </label>
    </div>
  </section>
</template>

<style scoped>
.stage {
  width: 100%;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-base-content);
  overflow: hidden;
}

.stage.large {
  background: transparent;
  padding: 0;
}

.np-art {
  flex: 1;
  min-height: 0;
  aspect-ratio: 1;
  align-self: center;
  max-width: 100%;
  display: grid;
  place-items: center;
  border-radius: 22px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-base-content) 8%, transparent);
  color: color-mix(in srgb, var(--color-base-content) 40%, transparent);
}

.np-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.np-body {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.np-title {
  font-size: 18px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.np-artist,
.np-state {
  font-size: 14px;
  color: color-mix(in srgb, var(--color-base-content) 58%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.np-state {
  font-size: 12px;
  color: var(--color-primary);
}

.scrub {
  width: 100%;
  accent-color: var(--color-primary);
}

.scrub-bar {
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--color-base-content) 12%, transparent);
  overflow: hidden;
}

.scrub-bar span {
  display: block;
  height: 100%;
  background: var(--color-base-content);
}

.np-times {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
}

.np-transport {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}

.np-btn {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.np-btn.main {
  width: 58px;
  height: 58px;
  background: var(--color-base-content);
  color: var(--color-base-100);
}

.np-volume {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ── vinyl ─────────────────────────────────────────── */
.v-vinyl {
  flex-direction: row;
  align-items: stretch;
}

.v-vinyl.compact {
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 12px;
}

.v-vinyl.large {
  flex-direction: column;
}

/* The record is min(width, height) of this box, so it can never overflow. */
.vinyl-wrap {
  container-type: size;
  flex: 0 0 46%;
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
}

.compact .vinyl-wrap {
  flex: 1 1 auto;
  width: 100%;
}

.large .vinyl-wrap {
  flex: none;
  width: 100%;
  height: min(82vw, 340px);
}

.vinyl-slot {
  width: min(100cqw, 100cqh);
  height: min(100cqw, 100cqh);
}

/* Only transform animates; the origin is the centre of a plain square <div>. */
.vinyl-disc {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  animation: vinyl-spin 1.8s linear infinite;
  animation-play-state: paused;
}

.vinyl-disc.spinning {
  animation-play-state: running;
}

@keyframes vinyl-spin {
  to {
    transform: rotate(360deg);
  }
}

.vinyl {
  display: block;
  width: 100%;
  height: 100%;
  color: #9a9a9a;
}

.rim {
  fill: #141414;
}

/* thin ring in a theme colour: the black disc stays visible on a dark card */
.outline {
  fill: none;
  stroke: color-mix(in srgb, var(--color-base-content) 28%, transparent);
  stroke-width: 0.6;
}

.label-bg {
  fill: var(--color-primary);
}

.spindle {
  fill: var(--color-base-100);
}

.vinyl-note {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 16%;
  height: 16%;
  transform: translate(-50%, -62%);
  color: var(--color-primary-content);
  pointer-events: none;
}

/* "Přehrává se" only where the record does not turn (reduced motion, below) */
.v-vinyl .np-state {
  display: none;
}

.compact .np-body {
  gap: 0;
  text-align: center;
}

.compact .np-title {
  font-size: 14px;
}

.compact .np-artist {
  font-size: 12px;
}

.v-vinyl:not(.compact):not(.large) .np-body {
  flex: 1;
  min-width: 0;
  align-content: center;
}

/* record next to the text: a narrower transport row */
.v-vinyl:not(.compact):not(.large) .np-transport {
  gap: 4px;
  justify-content: flex-start;
}

.v-vinyl:not(.compact):not(.large) .np-btn {
  width: 36px;
  height: 36px;
}

.v-vinyl:not(.compact):not(.large) .np-btn.main {
  width: 48px;
  height: 48px;
}

.spin {
  animation: np-spin 1s linear infinite;
}

@keyframes np-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vinyl-disc,
  .vinyl-disc.spinning {
    animation: none;
  }
  .v-vinyl .np-state {
    display: block;
  }
  .spin {
    animation: none;
  }
}
</style>
