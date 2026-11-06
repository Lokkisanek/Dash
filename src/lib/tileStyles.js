/**
 * Control-Center-like grid: 4 square columns. Each device picks a style and a
 * size "<cols>x<rows>". The first entry of every list is the default.
 * Keep in sync with TILE_STYLES in custom_components/.../www/panel.js.
 */
export const GRID_COLS = 4

export const TILE_STYLES = {
  light: { tile: ['2x2', '4x2'], slider: ['4x1', '2x1'], vertical: ['1x2', '2x2'], button: ['1x1', '2x1'] },
  switch: { tile: ['2x2'], row: ['4x1'], button: ['1x1', '2x1'] },
  climate: { tile: ['2x2'], dial: ['4x3'] },
  cover: { tile: ['2x2'], slider: ['4x1', '2x1'], vertical: ['1x2', '2x2'] },
  media_player: { tile: ['4x2', '2x2'] },
}

/** Valid { style, cols, rows } for a device, falling back to defaults. */
export function resolveTile(device) {
  const styles = TILE_STYLES[device?.type] || TILE_STYLES.switch
  const style = styles[device?.style] ? device.style : Object.keys(styles)[0]
  const sizes = styles[style]
  const size = sizes.includes(device?.size) ? device.size : sizes[0]
  const [cols, rows] = size.split('x').map(Number)
  return { style, size, cols, rows }
}
