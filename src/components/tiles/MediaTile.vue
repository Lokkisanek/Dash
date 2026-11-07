<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { Music, Pause, Play, SkipBack, SkipForward, Volume2, Speaker, Check, X } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'
import { detectMediaBrand, mediaPosition, formatTime } from '@/lib/mediaBrand'
import { mediaControls } from '@/lib/mediaFeatures'

/**
 * Media player in several Control-Center-like variants:
 *  card    – artwork + controls + volume (4×2), compact column at 2×2
 *  mini    – one row: artwork, title, play/next (4×1 / 2×1)
 *  cover   – full-bleed artwork with controls on top (2×2, 4×3, 4×4)
 *  button  – 1×1 artwork button, tap = play/pause
 */
const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  variant: { type: String, default: 'card' },
  compact: { type: Boolean, default: false },
  /** cover variant: show progress + volume + output (big sizes) */
  rich: { type: Boolean, default: false },
})

const { getEntityState, mediaCommand, mediaArtwork } = useHomeAssistant()
const { t } = useI18n()

const entity = computed(() => getEntityState(props.entityId))
const attrs = computed(() => entity.value?.attributes || {})
const isPlaying = computed(() => entity.value?.state === 'playing')
const isActive = computed(() => ['playing', 'paused', 'buffering'].includes(entity.value?.state))
const title = computed(() => attrs.value.media_title || (isActive.value ? props.label : t('mediaIdle')))
const subtitle = computed(() => attrs.value.media_artist || attrs.value.media_album_name || props.label)
const artwork = computed(() => mediaArtwork(props.entityId, attrs.value))
const artFailed = ref(false)
// a broken picture must not hide the artwork of the next track
watch(artwork, () => (artFailed.value = false))
const brand = computed(() => detectMediaBrand(props.entityId, attrs.value))
/** Only controls the player reports in supported_features (see mediaFeatures.js). */
const can = computed(() => mediaControls(entity.value))
const outputs = computed(() => can.value.sources)
const showOutputs = ref(false)

const localVolume = ref(null)
const volume = computed(() => Math.round((localVolume.value ?? Number(attrs.value.volume_level ?? 0)) * 100))

const now = ref(Date.now())
let clock = 0
onMounted(() => {
  if (props.variant === 'cover') clock = setInterval(() => (now.value = Date.now()), 1000)
})
onUnmounted(() => clearInterval(clock))

const duration = computed(() => Number(attrs.value.media_duration) || 0)
const position = computed(() => mediaPosition(entity.value, now.value))
const progress = computed(() =>
  duration.value && position.value != null ? Math.min(100, (position.value / duration.value) * 100) : 0,
)

async function cmd(service, data) {
  unlockAudio()
  await mediaCommand(props.entityId, service, data)
}

let volTimer = null
function onVolume(e) {
  const v = Number(e.target.value) / 100
  localVolume.value = v
  clearTimeout(volTimer)
  volTimer = setTimeout(async () => {
    await mediaCommand(props.entityId, 'volume_set', { volume_level: v })
    setTimeout(() => {
      localVolume.value = null
    }, 800)
  }, 120)
}

async function pickOutput(source) {
  showOutputs.value = false
  await cmd('select_source', { source })
}
</script>

<template>
  <!-- 1×1 button -->
  <button
    v-if="variant === 'button'"
    type="button"
    class="media-btn squircle"
    :class="{ 'is-playing': isPlaying }"
    :disabled="!can.playPause"
    :aria-label="isPlaying ? t('mediaPause') : t('mediaPlay')"
    @click="cmd('media_play_pause')"
  >
    <img v-if="artwork && !artFailed" :src="artwork" alt="" draggable="false" @error="artFailed = true" />
    <span class="media-btn__glyph">
      <Pause v-if="isPlaying" :size="22" fill="currentColor" />
      <Play v-else :size="22" fill="currentColor" class="translate-x-[1px]" />
    </span>
  </button>

  <div
    v-else
    class="media-tile squircle"
    :class="[`is-${variant}`, { 'is-compact': compact, 'is-playing': isPlaying, 'is-rich': rich }]"
  >
    <div class="art">
      <img v-if="artwork && !artFailed" :src="artwork" alt="" draggable="false" @error="artFailed = true" />
      <Music v-else :size="variant === 'mini' || compact ? 20 : 30" :stroke-width="1.8" />
    </div>

    <div class="info">
      <div class="head">
        <div class="min-w-0">
          <p class="title truncate">{{ title }}</p>
          <p class="subtitle truncate">{{ subtitle }}</p>
        </div>
        <span v-if="brand && variant !== 'mini'" class="brand" :style="{ '--brand': brand.color }">
          <i />{{ brand.name }}
        </span>
      </div>

      <div v-if="variant === 'cover' && rich && duration" class="progress">
        <div class="bar"><span :style="{ width: `${progress}%` }" /></div>
        <div class="times tabular-nums">
          <span>{{ formatTime(position) }}</span><span>{{ formatTime(duration) }}</span>
        </div>
      </div>

      <div class="controls">
        <button
          v-if="variant !== 'mini' && !compact && can.previous"
          type="button"
          class="ctl"
          :aria-label="t('mediaPrev')"
          @click="cmd('media_previous_track')"
        >
          <SkipBack :size="20" fill="currentColor" />
        </button>
        <button
          v-if="can.playPause"
          type="button"
          class="ctl ctl-main"
          :aria-label="isPlaying ? t('mediaPause') : t('mediaPlay')"
          @click="cmd('media_play_pause')"
        >
          <Pause v-if="isPlaying" :size="22" fill="currentColor" />
          <Play v-else :size="22" fill="currentColor" class="translate-x-[1px]" />
        </button>
        <button
          v-if="can.next"
          type="button"
          class="ctl"
          :aria-label="t('mediaNext')"
          @click="cmd('media_next_track')"
        >
          <SkipForward :size="20" fill="currentColor" />
        </button>
        <button
          v-if="can.source && variant !== 'mini' && !compact"
          type="button"
          class="ctl ctl-out"
          :aria-label="t('mediaOutput')"
          @click="showOutputs = true"
        >
          <Speaker :size="18" />
        </button>
      </div>

      <label v-if="can.volume && ((variant === 'card' && !compact) || (variant === 'cover' && rich))" class="volume">
        <Volume2 :size="15" class="shrink-0 opacity-60" />
        <input
          type="range"
          min="0"
          max="100"
          :value="volume"
          class="range range-xs range-primary flex-1"
          data-no-swipe
          :aria-label="`${t('volume')} ${label}`"
          @pointerdown.stop
          @input="onVolume"
        />
      </label>
    </div>

    <Transition name="sheet">
      <div v-if="showOutputs" class="outputs" data-no-swipe @click.self="showOutputs = false">
        <div class="outputs__card">
          <div class="outputs__head">
            <strong>{{ t('mediaOutputs') }}</strong>
            <button type="button" class="ctl" :aria-label="t('close')" @click="showOutputs = false">
              <X :size="18" />
            </button>
          </div>
          <button
            v-for="src in outputs"
            :key="src"
            type="button"
            class="outputs__item"
            :class="{ 'is-on': src === attrs.source }"
            @click="pickOutput(src)"
          >
            <Speaker :size="16" />
            <span class="truncate">{{ src }}</span>
            <Check v-if="src === attrs.source" :size="16" class="ml-auto" />
          </button>
          <p v-if="!outputs.length" class="subtitle">{{ t('mediaNoOutputs') }}</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.media-tile {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  gap: 16px;
  padding: 14px;
  overflow: hidden;
  border-radius: var(--radius-box);
  background: var(--color-base-100);
  color: var(--color-base-content);
  user-select: none;
}

.media-tile.is-compact {
  flex-direction: column;
  gap: 10px;
}

.art {
  position: relative;
  height: 100%;
  aspect-ratio: 1;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 22px;
  background: linear-gradient(140deg, color-mix(in srgb, var(--color-primary) 55%, #ff8ad0), #8f6bff);
  color: white;
  transition: transform 400ms cubic-bezier(0.3, 1.3, 0.5, 1);
}

.media-tile:not(.is-playing) .art {
  transform: scale(0.92);
}

.is-compact .art {
  height: 46px;
  border-radius: 14px;
}

.art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.info {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.title {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.25;
}

.subtitle {
  font-size: 13px;
  color: color-mix(in srgb, currentColor 55%, transparent);
}

.brand {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 650;
  background: color-mix(in srgb, var(--brand) 14%, transparent);
  color: color-mix(in srgb, var(--brand) 80%, currentColor);
}

.brand i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brand);
}

.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 230px;
}

.is-compact .controls {
  justify-content: flex-start;
  gap: 8px;
}

.ctl {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: transform 160ms cubic-bezier(0.3, 1.4, 0.5, 1), background 160ms ease;
}

.ctl:active {
  transform: scale(0.88);
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.ctl-main {
  width: 46px;
  height: 46px;
  background: var(--color-base-content);
  color: var(--color-base-100);
}

.volume {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* mini: single row */
.is-mini {
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 10px;
}
.is-mini .art {
  height: 100%;
  max-height: 56px;
  border-radius: 14px;
}
.is-mini .info {
  flex-direction: row;
  align-items: center;
}
.is-mini .title {
  font-size: 14px;
}
.is-mini .subtitle {
  font-size: 12px;
}
.is-mini .controls {
  gap: 2px;
  flex-shrink: 0;
}
.is-mini .ctl-main {
  width: 40px;
  height: 40px;
}

/* cover: artwork fills the tile */
.is-cover {
  padding: 16px;
  color: #fff;
  background: #2a2233;
}
.is-cover .art {
  position: absolute;
  inset: 0;
  height: auto;
  aspect-ratio: auto;
  border-radius: 0;
  transform: none !important;
}
.is-cover .art::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.05) 30%, rgba(0, 0, 0, 0.62) 100%);
}
.is-cover:not(.is-playing) .art img {
  filter: saturate(0.7) brightness(0.85);
}
.is-cover .art img {
  transition: filter 400ms ease, transform 8s ease;
}
.is-cover.is-playing .art img {
  transform: scale(1.06);
}
.is-cover .info {
  justify-content: flex-end;
  gap: 10px;
}
.is-cover .head {
  order: 0;
}
.is-cover .brand {
  position: absolute;
  top: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.is-cover .subtitle {
  color: rgba(255, 255, 255, 0.72);
}
.is-cover .ctl-main {
  background: #fff;
  color: #111;
}
.is-cover.is-rich .title {
  font-size: 20px;
}
.is-cover:not(.is-rich) .controls .ctl:first-child {
  display: none;
}

.progress .bar {
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  overflow: hidden;
}
.progress .bar span {
  display: block;
  height: 100%;
  background: #fff;
  border-radius: inherit;
  transition: width 1s linear;
}
.progress .times {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
}

/* 1×1 button */
.media-btn {
  position: relative;
  width: 100%;
  height: 100%;
  border: 0;
  padding: 0;
  overflow: hidden;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: linear-gradient(140deg, color-mix(in srgb, var(--color-primary) 55%, #ff8ad0), #8f6bff);
  color: #fff;
  transition: transform 160ms cubic-bezier(0.3, 1.4, 0.5, 1);
}

.media-btn:disabled {
  cursor: default;
  opacity: 0.55;
}
.media-btn:active {
  transform: scale(0.92);
}
.media-btn img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(0.75);
}
.media-btn__glyph {
  position: relative;
  display: grid;
  place-items: center;
}

/* output sheet */
.outputs {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  align-items: end;
  padding: 8px;
  background: color-mix(in srgb, var(--color-base-100) 40%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: var(--color-base-content);
}
.outputs__card {
  max-height: 100%;
  overflow: auto;
  display: grid;
  gap: 2px;
  padding: 8px;
  border-radius: 22px;
  background: var(--color-base-100);
}
.outputs__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 4px 8px;
  font-size: 14px;
}
.outputs__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.outputs__item.is-on {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  font-weight: 600;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.25s ease;
}
.sheet-enter-active .outputs__card,
.sheet-leave-active .outputs__card {
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .outputs__card,
.sheet-leave-to .outputs__card {
  transform: translateY(24px);
}
</style>
