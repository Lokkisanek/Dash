import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONFIG_VERSION, HEADER_FAMILY, LEGACY_HEADER_GENERAL, migrateConfig } from '../../src/lib/configMigrate.js'
import { TILE_TYPES, resolveTile } from '../../src/lib/tileStyles.js'

const cases = JSON.parse(readFileSync(new URL('../fixtures/header-migration.json', import.meta.url), 'utf8'))

const withoutIds = (config) => ({
  ...config,
  pages: (config.pages || []).map((p) => ({
    ...p,
    devices: (p.devices || []).map((d) => (d.type === 'header' ? { ...d, id: 'header-*' } : d)),
  })),
})

describe('config migration (same cases as tests/pure/test_config_schema.py)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const input = structuredClone(c.input)
      const out = migrateConfig(input)
      expect(withoutIds(out)).toEqual(c.output)
      expect(input).toEqual(c.input) // input untouched
      expect(migrateConfig(out)).toEqual(out) // idempotent
    })
  }

  it('gives the inserted header a unique id', () => {
    const out = migrateConfig({ configVersion: 2, general: {}, pages: [{ id: 'a', devices: [] }] })
    expect(out.pages[0].devices[0].id).toMatch(/^header-[0-9a-f]{8}$/)
  })

  it('treats a config without version or general like the old defaults', () => {
    const out = migrateConfig({ pages: [{ id: 'a', devices: [] }] })
    expect(out.configVersion).toBe(CONFIG_VERSION)
    expect(out.pages[0].devices[0]).toMatchObject({ type: 'header', showTime: true, showGreeting: true })
  })

  it('knows the same legacy keys and header types as the registry', () => {
    expect(Object.keys(LEGACY_HEADER_GENERAL)).toHaveLength(8)
    for (const type of HEADER_FAMILY) expect(TILE_TYPES[type]?.needsEntity).toBe(false)
  })
})

describe('header-family tiles', () => {
  const expected = {
    header: ['card', 'plain', 'lockscreen', 'compact', 'glass'],
    clock: ['card', 'plain', 'lockscreen', 'compact'],
    greeting: ['card', 'plain'],
    weather: ['card', 'plain', 'glass', 'compact'],
    wifi: ['button'],
  }
  for (const [type, styles] of Object.entries(expected)) {
    it(`${type} offers ${styles.join(', ')}`, () => {
      expect(Object.keys(TILE_TYPES[type].styles)).toEqual(styles)
      expect(TILE_TYPES[type].group).toBe('header')
    })
  }

  it('defaults: header card 4x2, wifi 1x1 only, lockscreen is full width', () => {
    expect(resolveTile({ type: 'header' })).toMatchObject({ style: 'card', size: '4x2' })
    expect(resolveTile({ type: 'wifi', size: '2x2' })).toMatchObject({ style: 'button', size: '1x1' })
    expect(resolveTile({ type: 'clock', style: 'lockscreen', size: '2x1' })).toMatchObject({ size: '4x2' })
    expect(resolveTile({ type: 'header', style: 'compact' })).toMatchObject({ size: '4x1' })
  })

  it('contrast is offered only for styles without a surface', () => {
    for (const type of ['header', 'clock', 'greeting', 'weather']) {
      const field = TILE_TYPES[type].fields.contrast
      expect(field.values).toEqual(['auto', 'light', 'dark'])
      for (const s of field.styles) expect(['plain', 'lockscreen', 'compact']).toContain(s)
    }
  })
})
