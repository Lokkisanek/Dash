<script setup>
import { computed, ref } from 'vue'
import { Music, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-vue-next'
import { useHomeAssistant } from '@/composables/useHomeAssistant'
import { useI18n } from '@/composables/useI18n'
import { unlockAudio } from '@/composables/useSound'

const props = defineProps({
  entityId: { type: String, required: true },
  label: { type: String, required: true },
  compact: { type: Boolean, default: false },
})

const { getEntityState, mediaCommand, haAssetUrl } = useHomeAssistant()
const { t } = useI18n()

const entity = computed(() => getEntityState(props.entityId))
const attrs = computed(() => entity.value?.attributes || {})
const isPlaying = computed(() => entity.value?.state === 'playing')
const isActive = computed(() => ['playing', 'paused', 'buffering'].includes(entity.value?.state))
const title = computed(() => attrs.value.media_title || (isActive.value ? props.label : t('mediaIdle')))
const subtitle = computed(() => attrs.value.media_artist || attrs.value.media_album_name || props.label)
const artwork = computed(() => haAssetUrl(attrs.value.entity_picture_local || attrs.value.entity_picture))
const artFailed = ref(false)

const localVolume = ref(null)
const volume = computed(() => Math.round((localVolume.value ?? Number(attrs.value.volume_level ?? 0)) * 100))

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
</script>

<template>
  <div class="media-tile squircle" :class="{ 'is-compact': compact, 'is-playing': isPlaying }">
    <div class="art">
      <img
        v-if="artwork && !artFailed"
        :src="artwork"
        alt=""
        draggable="false"
        @error="artFailed = true"
      />
      <Music v-else :size="compact ? 22 : 30" :stroke-width="1.8" />
    </div>

    <div class="info">
      <div class="min-w-0">
        <p class="title truncate">{{ title }}</p>
        <p class="subtitle truncate">{{ subtitle }}</p>
      </div>

      <div class="controls">
        <button v-if="!compact" type="button" class="ctl" :aria-label="t('mediaPrev')" @click="cmd('media_previous_track')">
          <SkipBack :size="20" fill="currentColor" />
        </button>
        <button
          type="button"
          class="ctl ctl-main"
          :aria-label="isPlaying ? t('mediaPause') : t('mediaPlay')"
          @click="cmd('media_play_pause')"
        >
          <Pause v-if="isPlaying" :size="22" fill="currentColor" />
          <Play v-else :size="22" fill="currentColor" class="translate-x-[1px]" />
        </button>
        <button type="button" class="ctl" :aria-label="t('mediaNext')" @click="cmd('media_next_track')">
          <SkipForward :size="20" fill="currentColor" />
        </button>
      </div>

      <label v-if="!compact" class="volume">
        <Volume2 :size="15" class="shrink-0 opacity-60" />
        <input
          type="range"
          min="0"
          max="100"
          :value="volume"
          class="range range-xs range-primary flex-1"
          :aria-label="`${t('volume')} ${label}`"
          @pointerdown.stop
          @input="onVolume"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.media-tile {
  width: 100%;
  height: 100%;
  display: flex;
  gap: 16px;
  padding: 14px;
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
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
}

.title {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.25;
}

.subtitle {
  font-size: 13px;
  color: color-mix(in srgb, var(--color-base-content) 50%, transparent);
}

.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 190px;
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
  color: var(--color-base-content);
  cursor: pointer;
  transition: transform 160ms cubic-bezier(0.3, 1.4, 0.5, 1), background 160ms ease;
}

.ctl:active {
  transform: scale(0.88);
  background: color-mix(in srgb, var(--color-base-content) 8%, transparent);
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
</style>
