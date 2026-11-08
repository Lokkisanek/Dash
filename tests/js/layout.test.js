import { describe, it, expect } from 'vitest'
import { packTiles, layoutRows, indexForCell } from '../../shared/layout.mjs'

const t = (id, w, h = 1) => ({ id, w, h })
const cells = (placed) => placed.map(({ id, col, row, w, h }) => [id, col, row, w, h])

describe('packTiles', () => {
  it('lays out the owner config from the screenshots exactly as the editor shows it', () => {
    const tiles = [
      t('div-sceny', 4),
      t('scene.obyvak_chill', 1),
      t('scene.film', 1),
      t('scene.kino', 1),
      t('switch.tv', 1),
      t('div-kuchyn', 4),
      t('switch.jidelna', 2),
      t('scene.vecere', 1),
      t('switch.kavovar', 1),
      t('div-hudba', 4),
      t('media_player.obyvak', 4, 2),
    ]
    expect(cells(packTiles(tiles))).toEqual([
      ['div-sceny', 1, 1, 4, 1],
      ['scene.obyvak_chill', 1, 2, 1, 1],
      ['scene.film', 2, 2, 1, 1],
      ['scene.kino', 3, 2, 1, 1],
      ['switch.tv', 4, 2, 1, 1],
      ['div-kuchyn', 1, 3, 4, 1],
      ['switch.jidelna', 1, 4, 2, 1],
      ['scene.vecere', 3, 4, 1, 1],
      ['switch.kavovar', 4, 4, 1, 1],
      ['div-hudba', 1, 5, 4, 1],
      ['media_player.obyvak', 1, 6, 4, 2],
    ])
  })

  it('keeps tiles under their divider when a section row is not full', () => {
    // dense packing used to pull the scenes up next to "a"
    const tiles = [t('d1', 4), t('a', 1), t('d2', 4), t('b', 1), t('c', 1), t('d', 1)]
    expect(cells(packTiles(tiles))).toEqual([
      ['d1', 1, 1, 4, 1],
      ['a', 1, 2, 1, 1],
      ['d2', 1, 3, 4, 1],
      ['b', 1, 4, 1, 1],
      ['c', 2, 4, 1, 1],
      ['d', 3, 4, 1, 1],
    ])
  })

  it('starts a new row when a tile does not fit, and never backfills', () => {
    expect(cells(packTiles([t('a', 2), t('b', 3)]))).toEqual([
      ['a', 1, 1, 2, 1],
      ['b', 1, 2, 3, 1],
    ])
    // the 1x1 does not go back to row 1, column 4
    expect(cells(packTiles([t('a', 3), t('b', 2), t('c', 1)]))).toEqual([
      ['a', 1, 1, 3, 1],
      ['b', 1, 2, 2, 1],
      ['c', 3, 2, 1, 1],
    ])
  })

  it('puts 1x1 tiles next to a 2x2 tile in its lower row', () => {
    const tiles = [t('big', 2, 2), t('a', 1), t('b', 1), t('c', 1), t('d', 1), t('e', 1)]
    expect(cells(packTiles(tiles))).toEqual([
      ['big', 1, 1, 2, 2],
      ['a', 3, 1, 1, 1],
      ['b', 4, 1, 1, 1],
      ['c', 3, 2, 1, 1],
      ['d', 4, 2, 1, 1],
      ['e', 1, 3, 1, 1],
    ])
  })

  it('moves a wide tile below a tall one instead of overlapping it', () => {
    expect(cells(packTiles([t('a', 1), t('tall', 2, 2), t('wide', 2)]))).toEqual([
      ['a', 1, 1, 1, 1],
      ['tall', 2, 1, 2, 2],
      ['wide', 1, 3, 2, 1],
    ])
    expect(cells(packTiles([t('tall', 1, 2), t('a', 1), t('b', 1), t('c', 1), t('d', 1), t('div', 4)]))).toEqual([
      ['tall', 1, 1, 1, 2],
      ['a', 2, 1, 1, 1],
      ['b', 3, 1, 1, 1],
      ['c', 4, 1, 1, 1],
      ['d', 2, 2, 1, 1],
      ['div', 1, 3, 4, 1],
    ])
  })

  it('handles a divider at the end, an empty page and long pages', () => {
    expect(cells(packTiles([t('a', 1), t('div', 4)]))).toEqual([
      ['a', 1, 1, 1, 1],
      ['div', 1, 2, 4, 1],
    ])
    expect(packTiles([])).toEqual([])
    expect(packTiles(undefined)).toEqual([])
    const many = packTiles(Array.from({ length: 10 }, (_, i) => t(`t${i}`, 1)))
    expect(many.map((p) => [p.col, p.row])).toEqual([
      [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3],
    ])
    expect(layoutRows(many)).toBe(3)
  })

  it('accepts cols/rows, clamps bad sizes and names tiles without an id by index', () => {
    const placed = packTiles([{ cols: 9, rows: 0 }, { w: 'x' }, { id: 'a', cols: 2, rows: 3 }])
    expect(cells(placed)).toEqual([
      ['#0', 1, 1, 4, 1],
      ['#1', 1, 2, 1, 1],
      ['a', 2, 2, 2, 3],
    ])
    expect(layoutRows(placed)).toBe(4)
  })
})

describe('indexForCell', () => {
  const tiles = [t('a', 1), t('b', 1), t('c', 1), t('d', 1), t('wide', 2)]

  it('moves a tile to the index that places it on the target cell', () => {
    expect(indexForCell(tiles, 0, 3, 1)).toBe(2)
    expect(indexForCell(tiles, 3, 1, 1)).toBe(0)
    // the wide tile onto the first row: it goes first
    expect(indexForCell(tiles, 4, 1, 1)).toBe(0)
  })

  it('keeps the index when the tile is already there or the index is invalid', () => {
    expect(indexForCell(tiles, 1, 2, 1)).toBe(1)
    expect(indexForCell(tiles, 9, 1, 1)).toBe(9)
  })

  it('drops onto the nearest place for a cell below the last tile', () => {
    expect(indexForCell(tiles, 0, 4, 5)).toBe(4)
  })
})
