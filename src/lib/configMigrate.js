/**
 * Client copy of the config migration in the integration
 * (custom_components/guest_ha_dashboard/config_schema.py, migrate_config).
 *
 * The hosted app may talk to an older integration that still stores the header
 * switches in `general` (config version 2 or older). The app converts them the
 * same way, so the dashboard looks the same before the integration is updated.
 * tests/fixtures/header-migration.json is checked against both implementations.
 */

export const CONFIG_VERSION = 3

/** Tiles that show the header content; a page with one of them needs no migrated header. */
export const HEADER_FAMILY = ['header', 'clock', 'greeting', 'weather']

/** `general` keys of config version 2 and earlier, with the defaults they had then. */
export const LEGACY_HEADER_GENERAL = {
  showTopBar: true,
  showWelcome: true,
  weatherEntity: '',
  showTime: true,
  showDate: true,
  showWifi: true,
  showTemperature: true,
  showHumidity: true,
}

const WEATHER_ID = /^weather\.[a-z0-9_]+$/

export function configVersion(data) {
  const raw = data && typeof data === 'object' ? data.configVersion : undefined
  return Number.isInteger(raw) && raw >= 1 ? raw : 1
}

function newTileId(type) {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return `${type}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** The `header` tile that shows what the old switches showed, or null when both blocks were off. */
export function headerFromGeneral(general) {
  const old = { ...LEGACY_HEADER_GENERAL, ...(general && typeof general === 'object' ? general : {}) }
  const top = Boolean(old.showTopBar)
  const welcome = Boolean(old.showWelcome)
  if (!top && !welcome) return null
  return {
    id: newTileId('header'),
    type: 'header',
    style: 'card',
    size: '4x2',
    showTime: top && Boolean(old.showTime),
    showDate: top && Boolean(old.showDate),
    showWifi: top && Boolean(old.showWifi),
    showGreeting: welcome,
    showWeather: welcome,
    showTemperature: Boolean(old.showTemperature),
    showHumidity: Boolean(old.showHumidity),
    entity: typeof old.weatherEntity === 'string' && WEATHER_ID.test(old.weatherEntity) ? old.weatherEntity : '',
    contrast: 'auto',
  }
}

function pageListKey(data) {
  if (Array.isArray(data.pages) && data.pages.length) return 'pages'
  if (Array.isArray(data.rooms)) return 'rooms'
  return Array.isArray(data.pages) ? 'pages' : null
}

function hasHeaderTile(pages) {
  return pages.some(
    (page) => Array.isArray(page?.devices) && page.devices.some((d) => HEADER_FAMILY.includes(d?.type)),
  )
}

/** Config at CONFIG_VERSION; idempotent, the input is not changed. */
export function migrateConfig(data) {
  const out = data && typeof data === 'object' ? { ...data } : {}
  const general = out.general
  if (configVersion(out) < 3) {
    const key = pageListKey(out)
    const pages = key ? out[key] : null
    if (pages?.length && pages[0] && typeof pages[0] === 'object' && !hasHeaderTile(pages)) {
      const header = headerFromGeneral(general)
      if (header) {
        const first = structuredClone(pages[0])
        first.devices = [header, ...(Array.isArray(first.devices) ? first.devices : [])]
        out[key] = [first, ...pages.slice(1)]
      }
    }
  }
  if (general && typeof general === 'object') {
    out.general = Object.fromEntries(Object.entries(general).filter(([k]) => !(k in LEGACY_HEADER_GENERAL)))
  }
  out.configVersion = CONFIG_VERSION
  return out
}
