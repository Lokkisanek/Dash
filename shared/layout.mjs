/**
 * The one tile layout for dash: the guest app, the live preview and the HA
 * panel editor all place tiles with packTiles(). The panel gets a generated
 * copy (www/layout.js, `npm run gen:layout`); nothing else may pack tiles.
 *
 * Rules (docs/CONFIGURATION.md, "Rozložení dlaždic"):
 *  - The ARRAY ORDER of a page's tiles is the only source of truth. No x/y or
 *    order fields are stored.
 *  - Tiles are placed one after another, row-major, in array order. A cursor
 *    (row, column) marks where the previous tile ended; a tile is never placed
 *    before the cursor, so later tiles never backfill earlier gaps (no "dense").
 *  - From the cursor the tile takes the first position, moving right and then
 *    down row by row, where all its cells are free. If it does not fit in the
 *    columns left in the current row, it starts the next row and the rest of
 *    the row stays empty. A 4-wide tile (e.g. a divider) therefore always
 *    starts a new row.
 *  - A tile h rows tall occupies its columns in h rows. It blocks later tiles
 *    only through the cursor: a later tile skips the occupied cells as the
 *    cursor reaches them and may sit next to the tall tile in its lower rows.
 *  - Rows and columns are 1-based CSS grid lines: grid-column: col / span w.
 *
 * This matches CSS grid's sparse auto-placement, computed here so the editor
 * and the app can position tiles explicitly and compare the result.
 */

export const GRID_COLS = 4

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

/**
 * @param {Array<{id?: string, w?: number, h?: number, cols?: number, rows?: number}>} tiles
 * @param {number} [cols]
 * @returns {Array<{id: string, index: number, col: number, row: number, w: number, h: number}>}
 */
export function packTiles(tiles, cols = GRID_COLS) {
  const width = clampInt(cols, 1, 12, GRID_COLS)
  const taken = new Set()
  const key = (r, c) => r * width + c
  const free = (r, c, w, h) => {
    for (let y = r; y < r + h; y += 1) for (let x = c; x < c + w; x += 1) if (taken.has(key(y, x))) return false
    return true
  }
  let row = 0
  let col = 0
  const out = []
  ;(Array.isArray(tiles) ? tiles : []).forEach((tile, index) => {
    const w = clampInt(tile?.w ?? tile?.cols, 1, width, 1)
    const h = clampInt(tile?.h ?? tile?.rows, 1, 64, 1)
    for (;;) {
      if (col + w > width) {
        row += 1
        col = 0
        continue
      }
      if (free(row, col, w, h)) break
      col += 1
    }
    for (let y = row; y < row + h; y += 1) for (let x = col; x < col + w; x += 1) taken.add(key(y, x))
    out.push({ id: String(tile?.id ?? `#${index}`), index, col: col + 1, row: row + 1, w, h })
    col += w
  })
  return out
}

/** Number of grid rows a packed layout uses (0 for an empty page). */
export function layoutRows(placed) {
  return placed.reduce((max, p) => Math.max(max, p.row + p.h - 1), 0)
}

/**
 * Drag and drop: the array index the tile at `from` should move to so that it
 * lands on (col, row), 1-based. Every insertion point is packed with
 * packTiles(); the one whose placement covers the cell wins, otherwise the
 * nearest one (rows weigh more than columns), ties go to the index closest to
 * `from`. Returns `from` when nothing is closer.
 */
export function indexForCell(tiles, from, col, row, cols = GRID_COLS) {
  const list = Array.isArray(tiles) ? tiles : []
  if (from < 0 || from >= list.length) return from
  const moved = list[from]
  const rest = list.filter((_, i) => i !== from)
  let best = from
  let bestScore = Infinity
  for (let i = 0; i <= rest.length; i += 1) {
    const trial = [...rest.slice(0, i), moved, ...rest.slice(i)]
    const p = packTiles(trial, cols)[i]
    const inside = col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h
    const score = inside ? 0 : 1 + Math.abs(p.row - row) * 8 + Math.abs(p.col - col)
    const tie = score === bestScore && Math.abs(i - from) < Math.abs(best - from)
    if (score < bestScore || tie) {
      best = i
      bestScore = score
    }
  }
  return best
}
