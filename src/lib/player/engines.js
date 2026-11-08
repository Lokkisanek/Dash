import { ENGINE_IDS, toEntity, dispatchCommand } from './playerState'
import { createBrowserEngine } from './browserEngine'
import { createSpotifyEngine } from './spotifyEngine'

/**
 * dash's own engines as virtual media_player entities (`media_player.dash_radio`,
 * `media_player.dash_spotify`). useHomeAssistant asks here first in
 * getEntityState, mediaCommand and mediaBrowser, so tiles and the player sheet
 * need no engine-specific code.
 *
 * `ctx` (set by useHomeAssistant): { stations(), library, spotifyApi, labels,
 * libraryEnabled(), spotifyEnabled(), canSpotifyBrowse(), isOwner(), deviceName }
 */
const engines = {}
let ctx = null

export function configureEngines(context) {
  ctx = context
}

export function engineKeyFor(entityId) {
  return Object.keys(ENGINE_IDS).find((k) => ENGINE_IDS[k] === entityId) || ''
}

export function getEngine(key) {
  if (!ctx || !ENGINE_IDS[key]) return null
  if (!engines[key]) {
    engines[key] =
      key === 'browser'
        ? createBrowserEngine({
            name: ctx.labels.radio,
            stations: ctx.stations,
            library: { enabled: ctx.libraryEnabled, browse: ctx.library.browse, resolve: ctx.library.resolve },
            labels: { stations: ctx.labels.radio, library: ctx.labels.library },
            retryDelays: ctx.retryDelays,
          })
        : createSpotifyEngine({
            name: 'Spotify',
            api: ctx.spotifyApi,
            canBrowse: ctx.canSpotifyBrowse(),
            canSearch: ctx.canSpotifySearch(),
            labels: ctx.labels,
          })
  }
  return engines[key]
}

export function engineEntity(entityId) {
  const key = engineKeyFor(entityId)
  if (!key) return null
  if (key === 'spotify' && !ctx?.spotifyEnabled()) return null
  const engine = getEngine(key)
  return engine ? toEntity(entityId, engine.state, key) : null
}

/** true when the call was for an engine (handled here), false for Home Assistant. */
export async function engineCommand(entityId, service, data) {
  const key = engineKeyFor(entityId)
  if (!key) return false
  const engine = getEngine(key)
  if (engine) await dispatchCommand(engine, service, data)
  return true
}

export function engineBrowser(entityId) {
  const engine = getEngine(engineKeyFor(entityId))
  if (!engine) return null
  return {
    browse: (type, id) => engine.browse(type, id),
    search: (q) => (engine.search ? engine.search(q) : Promise.resolve({ result: [] })),
  }
}

/** Test hook: forget engines (vitest). */
export function resetEngines() {
  for (const k of Object.keys(engines)) {
    engines[k].destroy?.()
    delete engines[k]
  }
}
