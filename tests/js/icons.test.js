import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LEGACY_ICONS, PICKER_ICONS, icons, loadAllIcons, resolveIcon } from '../../src/lib/icons.js'
import { LEGACY_ICONS as GEN_LEGACY, generateIcons, loadIconCatalog } from '../../scripts/gen-icons.mjs'

const catalog = JSON.parse(readFileSync(new URL('../../scripts/icon-catalog.json', import.meta.url), 'utf8'))

describe('icon catalog', () => {
  it('has about 300 icons in the ten categories', () => {
    expect(catalog.icons.length).toBeGreaterThanOrEqual(280)
    expect(catalog.categories.map((c) => c.id)).toEqual([
      'home', 'lights', 'kitchen', 'climate', 'security', 'media', 'weather', 'transport', 'family', 'other',
    ])
    for (const c of catalog.categories) expect(c.cs && c.en).toBeTruthy()
  })

  it('passes the generator checks (names exist in lucide, keywords in both languages)', () => {
    expect(() => loadIconCatalog()).not.toThrow()
  })

  it('keeps every icon name the picker offered before', () => {
    expect(GEN_LEGACY).toHaveLength(56)
    const names = new Set(catalog.icons.map((i) => i.name))
    for (const name of GEN_LEGACY) expect(names.has(name), name).toBe(true)
  })

  it('has Czech keywords people search for', () => {
    const hay = (name) => catalog.icons.find((i) => i.name === name).keywords.cs.join(' ')
    expect(hay('Lamp')).toContain('lampa')
    expect(hay('Bath')).toContain('koupelna')
    expect(hay('Blinds')).toContain('žaluzie')
    expect(hay('Warehouse')).toContain('vrata')
    expect(hay('Cctv')).toContain('kamera')
  })

  it('writes the same names to the app and the panel catalog', () => {
    const files = generateIcons()
    const panel = files['custom_components/guest_ha_dashboard/www/icon-catalog.js']
    for (const name of PICKER_ICONS) expect(panel).toContain(`"n":"${name}"`)
  })
})

describe('resolveIcon', () => {
  it('resolves every previously available name without waiting for the lazy chunk', () => {
    expect(LEGACY_ICONS).toEqual(GEN_LEGACY)
    for (const name of LEGACY_ICONS) {
      expect(icons[name], name).toBeTruthy()
      expect(resolveIcon(name)).toBe(icons[name])
    }
  })

  it('resolves every catalog name once all icons are loaded', async () => {
    await loadAllIcons()
    for (const name of PICKER_ICONS) expect(icons[name], name).toBeTruthy()
  })

  it('falls back to Sparkles or the given fallback', () => {
    expect(resolveIcon('NoSuchIcon')).toBe(icons.Sparkles)
    expect(resolveIcon('NoSuchIcon', 'Power')).toBe(icons.Power)
  })
})
