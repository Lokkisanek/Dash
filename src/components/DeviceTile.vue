<script setup>
import { computed } from 'vue'
import { resolveTile } from '@/lib/tileStyles'
import LightTile from './LightTile.vue'
import SwitchTile from './SwitchTile.vue'
import ClimateTile from './ClimateTile.vue'
import CoverTile from './CoverTile.vue'
import SliderTile from './tiles/SliderTile.vue'
import ButtonTile from './tiles/ButtonTile.vue'
import SwitchRowTile from './tiles/SwitchRowTile.vue'
import ClimateDialTile from './tiles/ClimateDialTile.vue'
import MediaTile from './tiles/MediaTile.vue'

const props = defineProps({
  device: { type: Object, required: true },
})

const tile = computed(() => resolveTile(props.device))

const view = computed(() => {
  const d = props.device
  const { style, cols, rows } = tile.value
  const base = { entityId: d.id, label: d.label || d.id }
  switch (`${d.type}:${style}`) {
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
      return [MediaTile, { ...base, compact: cols < 4 || rows < 2 }]
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
    :style="{ gridColumn: `span ${tile.cols}`, gridRow: `span ${tile.rows}` }"
  >
    <component :is="view[0]" v-bind="view[1]" />
  </div>
</template>

<style scoped>
.device-cell {
  min-width: 0;
  min-height: 0;
}
</style>
