/**
 * dash light groups: one tile for several lights (type `light_group`).
 *
 * The tile reads a virtual light entity built from its members and sends one
 * service call with a list of entity ids (the integration checks every one).
 *   state       on if ANY member is on
 *   brightness  rounded mean of the members that are on
 *   colour, colour temperature, effect: shown only when all members that are
 *               on agree, otherwise `mixed` lists the attribute ("Různé")
 *   capabilities: only what ALL members support (intersection)
 */

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function intersect(lists) {
  if (!lists.length) return []
  return lists.reduce((acc, list) => acc.filter((x) => list.includes(x)))
}

export function aggregateLightGroup(id, members) {
  const present = members.filter(Boolean)
  const usable = present.filter((e) => e.state !== 'unavailable' && e.state !== 'unknown')
  const on = usable.filter((e) => e.state === 'on')
  const attrs = (e) => e.attributes || {}

  const mixed = []
  const agreed = (key) => {
    const values = on.map((e) => attrs(e)[key]).filter((v) => v != null)
    if (!values.length) return null
    if (values.every((v) => sameValue(v, values[0])) && values.length === on.length) return values[0]
    mixed.push(key)
    return null
  }

  const brightnessValues = on.map((e) => attrs(e).brightness).filter((b) => Number.isFinite(b))
  const brightness = brightnessValues.length
    ? Math.round(brightnessValues.reduce((s, b) => s + b, 0) / brightnessValues.length)
    : null

  const modes = intersect(present.map((e) => (Array.isArray(attrs(e).supported_color_modes) ? attrs(e).supported_color_modes : [])))
  const features = present.length
    ? present.map((e) => (Number.isInteger(attrs(e).supported_features) ? attrs(e).supported_features : 0)).reduce((a, b) => a & b)
    : 0
  const effectList = intersect(present.map((e) => (Array.isArray(attrs(e).effect_list) ? attrs(e).effect_list : [])))
  const mins = present.map((e) => attrs(e).min_color_temp_kelvin).filter(Number.isFinite)
  const maxs = present.map((e) => attrs(e).max_color_temp_kelvin).filter(Number.isFinite)

  let state = 'off'
  if (on.length) state = 'on'
  else if (!usable.length) state = 'unavailable'

  return {
    entity_id: id,
    state,
    attributes: {
      friendly_name: '',
      brightness: on.length ? brightness : null,
      color_temp_kelvin: agreed('color_temp_kelvin'),
      hs_color: agreed('hs_color'),
      effect: agreed('effect'),
      supported_color_modes: modes,
      supported_features: features,
      effect_list: effectList,
      ...(mins.length ? { min_color_temp_kelvin: Math.max(...mins) } : {}),
      ...(maxs.length ? { max_color_temp_kelvin: Math.min(...maxs) } : {}),
      dash_members: present.map((e) => e.entity_id),
      dash_on: on.length,
      dash_mixed: mixed,
    },
  }
}

/** Tap on a group: any member on -> all off, else all on (never a per-light toggle). */
export function groupToggleService(groupState) {
  return groupState?.state === 'on' ? 'turn_off' : 'turn_on'
}

/** Virtual entity id of a group tile: `light.dash_group_<tile id>`. */
export function lightGroupEntityId(tileId) {
  return `light.dash_group_${String(tileId || '').toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
}
