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
    'weather.forecast_home': {},
  },
}

const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/

function stripForeign(item, allowed) {
  return Object.fromEntries(
    Object.entries(item).filter(
      ([k, v]) => k !== 'haAreaId' && !(typeof v === 'string' && ENTITY_ID.test(v) && !allowed.has(v)),
    ),
  )
}

/** Same filtering as guest_policy.filter_config. */
export function filterConfigForProfile(config, profile) {
  const allowed = new Set(Object.keys(profile.entities || {}))
  const pages = (config.pages || [])
    .map((page) => ({
      ...stripForeign(page, allowed),
      devices: (page.devices || [])
        .filter((d) => allowed.has(d?.id) || d?.type === 'divider')
        .map((d) => stripForeign(d, allowed)),
    }))
    // same rule as guest_policy.filter_config: a page needs one usable tile
    .filter((page) => page.devices.some((d) => d.type !== 'divider'))
  const pageIds = new Set(pages.map((p) => p.id))
  const general = { ...(config.general || {}) }
  if (!allowed.has(general.weatherEntity)) general.weatherEntity = ''
  if (!profile.show_wifi) general.showWifi = false
  return {
    ...config,
    general,
    guestInfo: profile.show_wifi ? config.guestInfo : { wifiSsid: '', wifiPassword: '', wifiSecurity: 'nopass' },
    pages,
    dock: (config.dock || []).filter((d) => pageIds.has(d?.pageId)),
    hosting: undefined,
    dashboardUrl: undefined,
  }
}

/** Reason code if the mock profile refuses the call, else null. */
export function mockDenyReason(profile, domain, service, data = {}) {
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
