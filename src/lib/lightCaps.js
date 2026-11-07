/**
 * What a light (or a dash light group) can do, from its state attributes.
 * Values from the installed homeassistant package (2026.10.4, light/const.py):
 *   ColorMode: onoff, brightness, color_temp, hs, xy, rgb, rgbw, rgbww, white
 *   COLOR_MODES_COLOR = hs, rgb, rgbw, rgbww, xy
 *   LightEntityFeature: EFFECT = 4, FLASH = 8, TRANSITION = 32
 *   EFFECT_OFF = "off"
 */
export const LIGHT_FEATURE = { EFFECT: 4, FLASH: 8, TRANSITION: 32 }
export const COLOR_MODES_COLOR = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy']
export const EFFECT_OFF = 'off'

const DEFAULT_MIN_K = 2000
const DEFAULT_MAX_K = 6500

export function lightCaps(entity) {
  const a = entity?.attributes || {}
  const modes = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : []
  const features = Number.isInteger(a.supported_features) ? a.supported_features : 0
  // Old integrations without supported_color_modes: brightness if the light reports one
  const brightness = modes.length ? modes.some((m) => m !== 'onoff') : a.brightness != null
  const colorTemp = modes.includes('color_temp')
  const colorModes = modes.filter((m) => COLOR_MODES_COLOR.includes(m))
  const color = colorModes.length > 0
  const effectList = Array.isArray(a.effect_list) ? a.effect_list.filter((e) => typeof e === 'string') : []
  const effects = Boolean(features & LIGHT_FEATURE.EFFECT) && effectList.length > 0
  const minK = Number.isFinite(a.min_color_temp_kelvin) ? a.min_color_temp_kelvin : DEFAULT_MIN_K
  const maxK = Number.isFinite(a.max_color_temp_kelvin) ? a.max_color_temp_kelvin : DEFAULT_MAX_K
  return {
    brightness,
    colorTemp,
    color,
    // HA converts hs_color for every colour mode; rgb only when hs/xy are missing
    colorField: colorModes.includes('hs') || colorModes.includes('xy') || !colorModes.length ? 'hs_color' : 'rgb_color',
    effects,
    effectList,
    canClearEffect: effectList.includes(EFFECT_OFF),
    minK: Math.min(minK, maxK),
    maxK: Math.max(minK, maxK),
    /** Long-press opens the sheet only when there is more than on/off. */
    hasSheet: brightness || colorTemp || color || effects,
  }
}

/** Remove what a guest profile does not allow (config.capabilities; null = owner). */
export function allowedCaps(caps, profileCaps) {
  if (!profileCaps) return caps
  const out = {
    ...caps,
    color: caps.color && profileCaps.allow_color === true,
    colorTemp: caps.colorTemp && profileCaps.allow_color_temp !== false,
    effects: caps.effects && profileCaps.allow_effects === true,
  }
  out.hasSheet = out.brightness || out.colorTemp || out.color || out.effects
  return out
}

/** Colour-temperature presets inside the light's range (labels are i18n keys). */
export function kelvinPresets(minK, maxK) {
  const wanted = [
    ['ctCandle', 2200],
    ['ctWarm', 2700],
    ['ctNeutral', 4000],
    ['ctCool', 6000],
  ]
  const seen = new Set()
  return wanted
    .map(([key, k]) => [key, Math.min(maxK, Math.max(minK, k))])
    .filter(([, k]) => (seen.has(k) ? false : seen.add(k)))
}

/** Twelve flat swatches as [hue, saturation] (hs_color) with their rgb for the dot. */
export const SWATCHES = [
  [0, 100], [20, 100], [35, 100], [50, 100], [90, 80], [140, 80],
  [180, 80], [205, 90], [230, 85], [265, 80], [300, 75], [330, 85],
]

export function hsToRgb(h, s, v = 100) {
  const sat = s / 100
  const val = v / 100
  const k = (n) => (n + h / 60) % 6
  const f = (n) => val - val * sat * Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255))
}
