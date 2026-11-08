<script setup>
import { computed } from 'vue'
import { packTiles, layoutRows } from '../../shared/layout.mjs'
import { resolveTile } from '@/lib/tileStyles'
import DeviceTile from './DeviceTile.vue'

/**
 * One page of tiles. Positions come from packTiles() (shared/layout.mjs), the
 * same function the HA panel editor uses, and are set explicitly with
 * grid-column / grid-row: the browser never auto-places a tile.
 * Divider rows shrink to their label; every other row is one square cell.
 */
const props = defineProps({
  page: { type: Object, default: null },
})

const devices = computed(() => (Array.isArray(props.page?.devices) ? props.page.devices.filter(Boolean) : []))

const placed = computed(() => {
  const list = devices.value
  const layout = packTiles(
    list.map((d) => {
      const { cols, rows } = resolveTile(d)
      return { id: d.id, w: cols, h: rows }
    }),
  )
  return layout.map((p) => ({ ...p, device: list[p.index], key: `${p.index}:${p.id}` }))
})

const rowTemplate = computed(() => {
  const rows = layoutRows(placed.value)
  const dividerRows = new Set(placed.value.filter((p) => p.device.type === 'divider').map((p) => p.row))
  return Array.from({ length: rows }, (_, i) => (dividerRows.has(i + 1) ? 'auto' : 'var(--cell)')).join(' ')
})
</script>

<template>
  <div v-if="placed.length" class="tile-grid" data-tile-grid :style="{ gridTemplateRows: rowTemplate }">
    <DeviceTile
      v-for="item in placed"
      :key="item.key"
      :device="item.device"
      :place="item"
      :class="{ 'section-divider': item.device.type === 'divider' }"
    />
  </div>
</template>

<style scoped>
/*
 * Control Center grid: 4 square columns; tiles span "<cols>x<rows>".
 * cqw (of the .page container) keeps rows exactly as tall as columns are wide.
 */
.tile-grid {
  --gap: 12px;
  --cell: calc((100cqw - 2rem - 3 * var(--gap)) / 4);
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gap);
}

.section-divider {
  padding-top: 10px;
}
</style>
