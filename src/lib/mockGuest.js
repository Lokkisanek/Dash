/**
 * Mock guest pass for demo and tests (VITE_MODE=mock, ?guest=1).
 *
 * Mirrors what the integration does on the server: tiles outside the profile
 * disappear, a value outside the profile limit is refused. The real checks
 * live in custom_components/guest_ha_dashboard/guest_policy.py.
 */

export const MOCK_GUEST_PASS = {
  id: 'mock',
  label: 'Pokoj 3',
  kind: 'phone',
  valid_until: null,
}

/** Living room without the TV, bathroom; heating limited to 18–25 °C. */
export const MOCK_GUEST_PROFILE = {
  name: 'Pokoj 3',
  show_wifi: true,
  entities: {
    'light.obyvak_strop': {},
    'light.obyvak_lampa': {},
    'light.obyvak_led_pas': {},
    'cover.obyvak_zaluzie': {},
    'switch.kava': {},
    'media_player.obyvak': {},
    'climate.obyvak': { limits: { 'climate.set_temperature': { temperature: { min: 18, max: 25 } } } },
    'light.koupelna_strop': {},
    'light.koupelna_zrcadlo': {},
    'light.loznice_nocni_leva': {},
    'light.loznice_nocni_prava': {},
    'scene.vecer': {},
    'sensor.obyvak_teplota': {},
    'binary_sensor.vchodove_dvere': {},
    'fan.loznice': {},
    'weather.forecast_home': {},
  },
  // same keys as GUEST_CAPABILITY_DEFAULTS; the demo guest may change colours
  capabilities: {
    allow_color: true,
    allow_color_temp: true,
    allow_effects: false,
    max_transition: 5,
    media_browse: true,
    media_group: false,
    max_volume: 0.7,
  },
}

import { TILE_TYPES } from './tileRegistry.generated.js'

const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/
/** Tiles without an entity of their own (dividers, header family). */
const isLayout = (d) =>
  TILE_TYPES[d?.type]?.needsEntity === false &&
  !Object.values(TILE_TYPES[d?.type]?.fields || {}).some((f) => f.type === 'entities')

function stripForeign(item, allowed) {
  return Object.fromEntries(
    Object.entries(item)
      .filter(([k, v]) => k !== 'haAreaId' && !(typeof v === 'string' && ENTITY_ID.test(v) && !allowed.has(v)))
      .map(([k, v]) => [k, Array.isArray(v) ? v.filter((x) => !(typeof x === 'string' && ENTITY_ID.test(x)) || allowed.has(x)) : v]),
  )
}

/** Same filtering as guest_policy.filter_config. */
export function filterConfigForProfile(config, profile) {
  const allowed = new Set(Object.keys(profile.entities || {}))
  const pages = (config.pages || [])
    .map((page) => ({
      ...stripForeign(page, allowed),
      devices: (page.devices || [])
        .map((d) => stripForeign(d, allowed))
        .filter((d) => (Array.isArray(d.entities) ? d.entities.length > 0 : allowed.has(d?.id) || isLayout(d)))
        .filter((d) => !(d?.type === 'wifi' && !profile.show_wifi))
        .map((d) => (!profile.show_wifi && 'showWifi' in d ? { ...d, showWifi: false } : d)),
    }))
    // same rule as guest_policy.filter_config: a page needs one usable tile
    .filter((page) => page.devices.some((d) => !isLayout(d)))
  const pageIds = new Set(pages.map((p) => p.id))
  const general = { ...(config.general || {}) }
  return {
    ...config,
    capabilities: { ...profile.capabilities },
    general,
    guestInfo: profile.show_wifi ? config.guestInfo : { wifiSsid: '', wifiPassword: '', wifiSecurity: 'nopass' },
    pages,
    dock: (config.dock || []).filter((d) => pageIds.has(d?.pageId)),
    hosting: undefined,
    dashboardUrl: undefined,
  }
}

/** Reason code if the mock profile refuses the call, else null. Lists: every entity. */
export function mockDenyReason(profile, domain, service, data = {}) {
  if (Array.isArray(data.entity_id)) {
    if (domain !== 'light' || data.entity_id.length > 20) return 'bad_request'
    for (const id of data.entity_id) {
      const reason = mockDenyReason(profile, domain, service, { ...data, entity_id: id })
      if (reason) return reason
    }
    return null
  }
  const entry = profile.entities?.[data.entity_id]
  if (!entry) return 'entity_not_allowed'
  const limit = entry.limits?.[`${domain}.${service}`] || {}
  for (const [field, range] of Object.entries(limit)) {
    const value = data[field]
    if (value == null) continue
    if ((range.min != null && value < range.min) || (range.max != null && value > range.max)) {
      return 'out_of_range'
    }
  }
  return null
}
