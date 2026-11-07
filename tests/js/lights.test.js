import { describe, expect, it } from 'vitest'
import { aggregateLightGroup, groupToggleService, lightGroupEntityId } from '../../src/lib/lightGroup.js'
import { allowedCaps, kelvinPresets, lightCaps, hsToRgb } from '../../src/lib/lightCaps.js'

const light = (id, state, attributes = {}) => ({ entity_id: id, state, attributes })

const FULL = {
  supported_color_modes: ['color_temp', 'hs'],
  supported_features: 4 | 32,
  min_color_temp_kelvin: 2200,
  max_color_temp_kelvin: 6500,
  effect_list: ['off', 'Duha', 'Svíčka'],
}

describe('lightCaps', () => {
  it('on/off only: no sheet', () => {
    expect(lightCaps(light('light.a', 'on', { supported_color_modes: ['onoff'] }))).toMatchObject({
      brightness: false,
      colorTemp: false,
      color: false,
      effects: false,
      hasSheet: false,
    })
  })

  it('brightness only', () => {
    const c = lightCaps(light('light.a', 'on', { supported_color_modes: ['brightness'] }))
    expect(c).toMatchObject({ brightness: true, colorTemp: false, color: false, effects: false, hasSheet: true })
  })

  it('full colour light with effects', () => {
    const c = lightCaps(light('light.a', 'on', FULL))
    expect(c).toMatchObject({ brightness: true, colorTemp: true, color: true, effects: true, colorField: 'hs_color' })
    expect(c.canClearEffect).toBe(true)
    expect([c.minK, c.maxK]).toEqual([2200, 6500])
  })

  it('effects need the EFFECT feature bit and a list', () => {
    expect(lightCaps(light('light.a', 'on', { ...FULL, supported_features: 32 })).effects).toBe(false)
    expect(lightCaps(light('light.a', 'on', { ...FULL, effect_list: [] })).effects).toBe(false)
  })

  it('rgb-only lights get rgb_color', () => {
    expect(lightCaps(light('light.a', 'on', { supported_color_modes: ['rgb'] })).colorField).toBe('rgb_color')
    expect(lightCaps(light('light.a', 'on', { supported_color_modes: ['xy'] })).colorField).toBe('hs_color')
  })

  it('a guest profile removes what it does not allow', () => {
    const c = allowedCaps(lightCaps(light('light.a', 'on', FULL)), { allow_color: false, allow_color_temp: true, allow_effects: false })
    expect(c).toMatchObject({ brightness: true, colorTemp: true, color: false, effects: false, hasSheet: true })
    expect(allowedCaps(lightCaps(light('light.a', 'on', FULL)), null).color).toBe(true)
  })

  it('kelvin presets stay inside the range and are unique', () => {
    expect(kelvinPresets(2700, 4000).map(([, k]) => k)).toEqual([2700, 4000])
    expect(kelvinPresets(2000, 6500)).toHaveLength(4)
  })

  it('hsToRgb', () => {
    expect(hsToRgb(0, 100)).toEqual([255, 0, 0])
    expect(hsToRgb(120, 100)).toEqual([0, 255, 0])
    expect(hsToRgb(0, 0)).toEqual([255, 255, 255])
  })
})

describe('light group aggregation', () => {
  const id = lightGroupEntityId('light_group-5a6b7c8d')

  it('virtual id', () => {
    expect(id).toBe('light.dash_group_light_group_5a6b7c8d')
  })

  it('on if any member is on, brightness = mean of the members that are on', () => {
    const g = aggregateLightGroup(id, [
      light('light.a', 'on', { brightness: 100 }),
      light('light.b', 'on', { brightness: 201 }),
      light('light.c', 'off', { brightness: null }),
    ])
    expect(g.state).toBe('on')
    expect(g.attributes.brightness).toBe(151)
    expect(g.attributes.dash_on).toBe(2)
    expect(groupToggleService(g)).toBe('turn_off')
  })

  it('all off: tap turns all on', () => {
    const g = aggregateLightGroup(id, [light('light.a', 'off'), light('light.b', 'off')])
    expect(g.state).toBe('off')
    expect(g.attributes.brightness).toBeNull()
    expect(groupToggleService(g)).toBe('turn_on')
  })

  it('values shown only when all lights that are on agree, else mixed', () => {
    const same = aggregateLightGroup(id, [
      light('light.a', 'on', { color_temp_kelvin: 2700 }),
      light('light.b', 'on', { color_temp_kelvin: 2700 }),
      light('light.c', 'off', { color_temp_kelvin: 5000 }),
    ])
    expect(same.attributes.color_temp_kelvin).toBe(2700)
    expect(same.attributes.dash_mixed).toEqual([])
    const diff = aggregateLightGroup(id, [
      light('light.a', 'on', { color_temp_kelvin: 2700, hs_color: [10, 50] }),
      light('light.b', 'on', { color_temp_kelvin: 4000, hs_color: [10, 50] }),
    ])
    expect(diff.attributes.color_temp_kelvin).toBeNull()
    expect(diff.attributes.hs_color).toEqual([10, 50])
    expect(diff.attributes.dash_mixed).toEqual(['color_temp_kelvin'])
  })

  it('capabilities are the intersection of all members', () => {
    const g = aggregateLightGroup(id, [
      light('light.a', 'on', FULL),
      light('light.b', 'on', { ...FULL, supported_color_modes: ['color_temp'], effect_list: ['off', 'Duha'], min_color_temp_kelvin: 2700 }),
      light('light.c', 'off', { ...FULL, supported_color_modes: ['color_temp', 'hs'], max_color_temp_kelvin: 5000 }),
    ])
    const caps = lightCaps(g)
    expect(g.attributes.supported_color_modes).toEqual(['color_temp'])
    expect(g.attributes.effect_list).toEqual(['off', 'Duha'])
    expect([caps.minK, caps.maxK]).toEqual([2700, 5000])
    expect(caps).toMatchObject({ colorTemp: true, color: false, effects: true })
    const plain = aggregateLightGroup(id, [light('light.a', 'on', FULL), light('light.b', 'on', { supported_color_modes: ['onoff'] })])
    expect(lightCaps(plain).hasSheet).toBe(false)
    const noFx = aggregateLightGroup(id, [light('light.a', 'on', FULL), light('light.b', 'on', { ...FULL, supported_features: 0 })])
    expect(lightCaps(noFx).effects).toBe(false)
  })

  it('unavailable members are ignored; all unavailable = unavailable', () => {
    expect(aggregateLightGroup(id, [light('light.a', 'unavailable'), light('light.b', 'on', { brightness: 50 })]).state).toBe('on')
    expect(aggregateLightGroup(id, [light('light.a', 'unavailable'), null]).state).toBe('unavailable')
  })
})
