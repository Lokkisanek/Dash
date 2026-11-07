/**
 * Control-Center-like grid: 4 square columns. Each device picks a style and a
 * size "<cols>x<rows>". The first entry of every list is the default.
 * Types, styles and sizes come from shared/tiles.json (npm run gen:tiles).
 */
import { GRID_COLS, TILE_TYPES } from './tileRegistry.generated.js'

export { GRID_COLS, TILE_TYPES }

/** type -> { style: [sizes] } */
export const TILE_STYLES = Object.fromEntries(
  Object.entries(TILE_TYPES).map(([type, t]) => [type, t.styles]),
)

/** Valid { style, cols, rows } for a device, falling back to defaults. */
export function resolveTile(device) {
  const styles = TILE_STYLES[device?.type] || TILE_STYLES.switch
  const style = styles[device?.style] ? device.style : Object.keys(styles)[0]
  const sizes = styles[style]
  const size = sizes.includes(device?.size) ? device.size : sizes[0]
  const [cols, rows] = size.split('x').map(Number)
  return { style, size, cols, rows }
}
