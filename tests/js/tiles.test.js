import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GRID_COLS, TILE_STYLES, TILE_TYPES, resolveTile } from '../../src/lib/tileStyles.js'
import { generateTiles } from '../../scripts/gen-tiles.mjs'

const shared = JSON.parse(readFileSync(new URL('../../shared/tiles.json', import.meta.url), 'utf8'))

describe('tile registry', () => {
  it('is generated from shared/tiles.json', () => {
    expect(GRID_COLS).toBe(shared.gridCols)
    expect(Object.keys(TILE_TYPES)).toEqual(Object.keys(shared.types))
    for (const [type, spec] of Object.entries(shared.types)) {
      expect(TILE_STYLES[type]).toEqual(spec.styles)
    }
  })

  it('writes the same registry for the app and the panel', () => {
    const files = generateTiles()
    const values = Object.entries(files)
      .filter(([path]) => path.endsWith('.js'))
      .map(([, content]) => content.match(/TILE_TYPES = (\{[\s\S]*\});?\n$/)[1])
    expect(values).toHaveLength(2)
    expect(JSON.parse(values[0])).toEqual(JSON.parse(values[1]))
  })
})

describe('resolveTile', () => {
  for (const [type, styles] of Object.entries(TILE_STYLES)) {
    for (const [style, sizes] of Object.entries(styles)) {
      for (const size of sizes) {
        it(`${type} ${style} ${size}`, () => {
          const [cols, rows] = size.split('x').map(Number)
          expect(resolveTile({ type, style, size })).toEqual({ style, size, cols, rows })
        })
      }
    }
  }

  it('falls back to the first style and size of the type', () => {
    for (const [type, styles] of Object.entries(TILE_STYLES)) {
      const style = Object.keys(styles)[0]
      expect(resolveTile({ type, style: 'nope', size: '9x9' })).toMatchObject({ style, size: styles[style][0] })
      expect(resolveTile({ type })).toMatchObject({ style, size: styles[style][0] })
    }
  })

  it('keeps the style but fixes a size that belongs to another style', () => {
    expect(resolveTile({ type: 'light', style: 'slider', size: '2x2' })).toMatchObject({ style: 'slider', size: '4x1' })
  })

  it('treats unknown types like switch, as before', () => {
    expect(resolveTile({ type: 'toaster' })).toMatchObject({ style: 'tile', size: '2x2' })
  })
})
