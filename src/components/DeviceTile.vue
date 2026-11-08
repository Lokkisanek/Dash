<script setup>
import { ref, computed, provide, watch, onUnmounted } from 'vue'
import { resolveTile, TILE_TYPES } from '@/lib/tileStyles'
import { useHomeAssistant, registerLightGroup, unregisterLightGroup } from '@/composables/useHomeAssistant'
import { useGuestConfig } from '@/composables/useGuestConfig'
import { useI18n } from '@/composables/useI18n'
import { useLongPress } from '@/composables/useLongPress'
import { lightCaps, allowedCaps } from '@/lib/lightCaps'
import LightSheet from './LightSheet.vue'
import SceneTile from './tiles/SceneTile.vue'
import ReadTile from './tiles/ReadTile.vue'
import FanTile from './tiles/FanTile.vue'
import MediaStage from './tiles/MediaStage.vue'
import PlayerSheet from './PlayerSheet.vue'
import LightTile from './LightTile.vue'
import SwitchTile from './SwitchTile.vue'
import ClimateTile from './ClimateTile.vue'
import CoverTile from './CoverTile.vue'
import SliderTile from './tiles/SliderTile.vue'
import ButtonTile from './tiles/ButtonTile.vue'
import SwitchRowTile from './tiles/SwitchRowTile.vue'
import ClimateDialTile from './tiles/ClimateDialTile.vue'
import MediaTile from './tiles/MediaTile.vue'
import DividerTile from './tiles/DividerTile.vue'
import InfoTile from './tiles/InfoTile.vue'
import WifiTile from './tiles/WifiTile.vue'
import LibraryTile from './library/LibraryTile.vue'
import { ENGINE_IDS } from '@/lib/player/playerState'
import { getEngine } from '@/lib/player/engines'

const INFO_KINDS = ['header', 'clock', 'greeting', 'weather']

const props = defineProps({
  device: { type: Object, required: true },
  /** Position from packTiles() (shared/layout.mjs): { id, col, row, w, h } */
  place: { type: Object, required: true },
})

/**
 * dash's own player (type `player`): the browser or Spotify engine shown as a
 * virtual media_player, so every media style works with it (lib/player).
 */
const engineKey = computed(() => (props.device.type === 'player' ? (props.device.source === 'spotify' ? 'spotify' : 'browser') : ''))
const mediaDevice = computed(() =>
  engineKey.value ? { ...props.device, type: 'media_player', id: ENGINE_IDS[engineKey.value] } : props.device,
)
const tile = computed(() => resolveTile(props.device))
const { getEntityState } = useHomeAssistant()
const { capabilities } = useGuestConfig()
const { t } = useI18n()

const cellStyle = computed(() => {
  const p = props.place
  return { gridColumn: `${p.col} / span ${p.w}`, gridRow: `${p.row} / span ${p.h}` }
})

/**
 * One "Nedostupné" look for every tile with an entity: the entity has no state
 * (deleted, renamed, not shared with this guest) or HA reports it unavailable.
 * A scene's "unknown" is normal (never activated), so only media players,
 * whose "unknown" means no connection, count it.
 */
const unavailable = computed(() => {
  const d = props.device
  if (!TILE_TYPES[d.type]?.needsEntity || !d.id) return false
  const s = getEntityState(d.id)
  if (!s || s.state === 'unavailable') return true
  return d.type === 'media_player' && s.state === 'unknown'
})
/** Tiles that already print "Nedostupné" in their own text get no extra label. */
const unavailableLabel = computed(
  () => unavailable.value && !['media_player', 'fan'].includes(props.device.type) && !(props.device.type === 'scene' && tile.value.style === 'row'),
)

/** dash light group: a virtual light entity built from the members (lib/lightGroup.js). */
const groupId = ref('')
watch(
  () => (props.device.type === 'light_group' ? [props.device.id, (props.device.entities || []).join(','), props.device.label] : null),
  (key) => {
    if (groupId.value) unregisterLightGroup(groupId.value)
    groupId.value = key ? registerLightGroup(props.device.id, props.device.entities || [], props.device.label || '') : ''
  },
  { immediate: true },
)
onUnmounted(() => groupId.value && unregisterLightGroup(groupId.value))

/** Spotify state is polled only while a tile shows it. */
let detachEngine = null
watch(
  engineKey,
  (key) => {
    detachEngine?.()
    detachEngine = key === 'spotify' ? getEngine('spotify')?.attach?.() || null : null
  },
  { immediate: true },
)
onUnmounted(() => detachEngine?.())
const engineState = computed(() => (engineKey.value ? getEntityState(ENGINE_IDS[engineKey.value])?.attributes?.dash_state : ''))
function unlockSound() {
  getEngine(engineKey.value)?.unlock?.()
}

/** Light tiles (and groups) get long-press controls when they can do more than on/off. */
const lightId = computed(() => (props.device.type === 'light' ? props.device.id : groupId.value))
const sheetCaps = computed(() =>
  lightId.value ? allowedCaps(lightCaps(getEntityState(lightId.value)), capabilities.value) : null,
)
const sheetOpen = ref(false)
const longPress = useLongPress(
  () => {
    sheetOpen.value = true
  },
  { armed: () => Boolean(sheetCaps.value?.hasSheet) },
)
provide('dashLongPress', longPress)
const lpHandlers = computed(() => (sheetCaps.value?.hasSheet ? longPress.handlers : {}))
/** Media tiles (all styles but the 1×1 button) open the player sheet on a tap. */
const playerOpen = ref(false)
const hasPlayer = computed(() => mediaDevice.value.type === 'media_player' && tile.value.style !== 'button')
function onMediaTap(e) {
  if (!hasPlayer.value) return
  // composedPath, not target.closest: a control may already be re-rendered (and
  // detached) by the time the click bubbles up here
  const path = e.composedPath()
  const stop = path.indexOf(e.currentTarget)
  if (path.slice(0, stop).some((el) => el.matches?.('button, input, a, label, select'))) return
  playerOpen.value = true
}

const sheetLabel = computed(() => {
  const d = props.device
  if (d.label) return d.label
  return getEntityState(lightId.value)?.attributes?.friendly_name || d.id
})

const view = computed(() => {
  const d = mediaDevice.value
  const { style, cols, rows } = tile.value
  const base = { entityId: d.id, label: d.label || d.id }
  if (INFO_KINDS.includes(d.type)) return [InfoTile, { device: d, kind: d.type, variant: style, cols, rows }]
  if (d.type === 'light_group') {
    // same tiles as a light, reading the virtual group entity
    const g = { entityId: groupId.value, label: d.label || t('groupMembers')((d.entities || []).length) }
    if (style === 'slider') return [SliderTile, { ...g, kind: 'light', icon: d.icon || 'LampCeiling' }]
    if (style === 'vertical') return [SliderTile, { ...g, kind: 'light', icon: d.icon || 'LampCeiling', vertical: true }]
    if (style === 'button') return [ButtonTile, { ...g, domain: 'light', icon: d.icon || 'LampCeiling', wide: cols > 1 }]
    return [LightTile, { ...g, supportsBrightness: true }]
  }
  switch (`${d.type}:${style}`) {
    case 'scene:button':
      return [SceneTile, { ...base, icon: d.icon }]
    case 'scene:row':
      return [SceneTile, { ...base, icon: d.icon, row: true }]
    case 'sensor:value':
    case 'sensor:row':
    case 'binary_sensor:status':
    case 'binary_sensor:row':
    case 'entity:value':
    case 'entity:row':
      return [ReadTile, { ...base, kind: d.type, icon: d.icon, attribute: d.attribute || '', row: style === 'row', wide: cols >= 4 }]
    case 'fan:toggle':
      return [FanTile, { ...base, icon: d.icon }]
    case 'fan:slider':
      return [FanTile, { ...base, icon: d.icon, slider: true }]
    case 'media_player:nowplaying':
      return [MediaStage, { ...base, variant: 'nowplaying' }]
    case 'media_player:vinyl':
      return [MediaStage, { ...base, variant: 'vinyl', compact: cols < 4 }]
    case 'wifi:button':
      return [WifiTile, {}]
    case 'library:trending':
    case 'library:search':
    case 'library:activity':
      return [LibraryTile, { variant: style, label: d.label || '' }]
    case 'divider:line':
      return [DividerTile, { label: d.label || '' }]
    case 'light:slider':
      return [SliderTile, { ...base, kind: 'light', icon: d.icon }]
    case 'light:vertical':
      return [SliderTile, { ...base, kind: 'light', icon: d.icon, vertical: true }]
    case 'light:button':
      return [ButtonTile, { ...base, domain: 'light', icon: d.icon, wide: cols > 1 }]
    case 'switch:row':
      return [SwitchRowTile, { ...base, icon: d.icon || 'Power' }]
    case 'switch:button':
      return [ButtonTile, { ...base, domain: 'switch', icon: d.icon, wide: cols > 1 }]
    case 'climate:dial':
      return [ClimateDialTile, base]
    case 'cover:slider':
      return [SliderTile, { ...base, kind: 'cover', icon: d.icon }]
    case 'cover:vertical':
      return [SliderTile, { ...base, kind: 'cover', icon: d.icon, vertical: true }]
    case 'media_player:tile':
      return [MediaTile, { ...base, variant: 'card', compact: cols < 4 || rows < 2 }]
    case 'media_player:mini':
      return [MediaTile, { ...base, variant: 'mini' }]
    case 'media_player:cover':
      return [MediaTile, { ...base, variant: 'cover', rich: cols === 4 && rows >= 3 }]
    case 'media_player:button':
      return [MediaTile, { ...base, variant: 'button' }]
    case 'switch:tile':
      return [SwitchTile, { ...base, icon: d.icon || 'Power' }]
    case 'climate:tile':
      return [ClimateTile, base]
    case 'cover:tile':
      return [CoverTile, base]
    default:
      return [LightTile, { ...base, supportsBrightness: d.supportsBrightness !== false }]
  }
})
</script>

<template>
  <div
    class="device-cell"
    :class="{ 'has-sheet': sheetCaps?.hasSheet, 'is-unavailable': unavailable }"
    :data-entity="device.id"
    :data-type="device.type"
    :data-tile-id="place.id"
    :data-col="place.col"
    :data-row="place.row"
    :data-w="place.w"
    :data-h="place.h"
    :data-unavailable="unavailable ? '' : undefined"
    :style="cellStyle"
    v-bind="lpHandlers"
    @click="onMediaTap"
  >
    <component :is="view[0]" v-bind="view[1]" class="cell-body" />
    <!-- browser radio: autoplay needs a tap; a dead stream says so -->
    <button v-if="engineState === 'blocked'" type="button" class="unlock-sound" data-unlock-sound @click.stop="unlockSound">
      {{ t('tapToPlay') }}
    </button>
    <span v-else-if="engineState === 'error'" class="stream-error" data-stream-error>{{ t('streamUnavailable') }}</span>
    <span v-if="unavailableLabel" class="unavailable-label">{{ t('unavailable') }}</span>
    <!-- keyboard users: the long-press controls without a long press -->
    <button
      v-if="sheetCaps?.hasSheet"
      type="button"
      class="lp-more"
      :aria-label="`${sheetLabel}: ${t('lightMore')}`"
      @click.stop="sheetOpen = true"
    >
      …
    </button>
    <!-- keyboard users: open the player without tapping the tile -->
    <button
      v-if="hasPlayer"
      type="button"
      class="lp-more"
      :aria-label="`${device.label || mediaDevice.id}: ${t('openPlayer')}`"
      @click.stop="playerOpen = true"
    >
      …
    </button>
    <PlayerSheet
      v-if="hasPlayer"
      :open="playerOpen"
      :entity-id="mediaDevice.id"
      :label="device.label || mediaDevice.id"
      :variant="tile.style"
      :outputs="device.outputs || []"
      @close="playerOpen = false"
    />
    <LightSheet
      v-if="sheetCaps?.hasSheet || sheetOpen"
      :open="sheetOpen"
      :entity-id="lightId"
      :label="sheetLabel"
      @close="sheetOpen = false"
    />
  </div>
</template>

<style scoped>
.device-cell {
  position: relative;
  min-width: 0;
  min-height: 0;
}

/* No iOS callout or text selection on a tile that reacts to a long press. */
.device-cell.has-sheet {
  -webkit-touch-callout: none;
  user-select: none;
  -webkit-user-select: none;
}

/* Same quiet look for every unavailable tile (the label stays readable). */
.device-cell.is-unavailable > .cell-body {
  opacity: 0.45;
  filter: grayscale(1);
  pointer-events: none;
}

.unlock-sound {
  position: absolute;
  inset: auto 8px 8px;
  z-index: 2;
  padding: 10px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--color-base-content);
  color: var(--color-base-100);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
}

.stream-error {
  position: absolute;
  right: 12px;
  top: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-error);
  pointer-events: none;
}

/* a solid chip: on a 1-wide tile it sits on the name, on wider ones on the state pill */
.unavailable-label {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--color-base-100);
  max-width: calc(100% - 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.66rem;
  font-weight: 600;
  line-height: 1;
  color: color-mix(in srgb, var(--color-base-content) 70%, transparent);
  pointer-events: none;
}

.device-cell:not([data-w='1']) > .unavailable-label {
  left: auto;
  right: 10px;
  bottom: auto;
  top: 10px;
  transform: none;
}

.lp-more {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: var(--color-base-100);
  color: var(--color-base-content);
  opacity: 0;
  pointer-events: none;
}

.lp-more:focus-visible {
  opacity: 1;
  pointer-events: auto;
  outline: 2px solid var(--color-primary);
}
</style>
