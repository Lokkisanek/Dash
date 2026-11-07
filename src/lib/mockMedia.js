/**
 * Demo music library for the player sheet (VITE_MODE=mock): three levels
 * (Knihovna -> Interpreti / Alba / Playlisty -> items), shaped like the result
 * of Home Assistant's media_player/browse_media (BrowseMedia.as_dict()).
 */
const track = (id, title, artist) => ({
  title,
  media_class: 'track',
  media_content_type: 'music',
  media_content_id: `library://track/${id}`,
  can_play: true,
  can_expand: false,
  thumbnail: null,
  dash_artist: artist,
})

const folder = (id, title, mediaClass, children) => ({
  title,
  media_class: mediaClass,
  media_content_type: 'library',
  media_content_id: `library://${id}`,
  can_play: mediaClass !== 'directory',
  can_expand: true,
  thumbnail: null,
  children,
})

const ARTISTS = [
  folder('artist/m83', 'M83', 'artist', [track(1, 'Midnight City', 'M83'), track(2, 'Wait', 'M83'), track(3, 'Outro', 'M83')]),
  folder('artist/tame', 'Tame Impala', 'artist', [track(4, 'The Less I Know the Better', 'Tame Impala'), track(5, 'Let It Happen', 'Tame Impala')]),
  folder('artist/vltava', 'Vltava', 'artist', [track(6, 'Marx Engels Beatles', 'Vltava')]),
]
const ALBUMS = [
  folder('album/hurry', 'Hurry Up, We’re Dreaming', 'album', ARTISTS[0].children),
  folder('album/currents', 'Currents', 'album', ARTISTS[1].children),
]
const PLAYLISTS = [
  folder('playlist/evening', 'Večer doma', 'playlist', [ARTISTS[0].children[1], ARTISTS[1].children[0], ARTISTS[2].children[0]]),
  folder('playlist/morning', 'Ráno', 'playlist', [ARTISTS[1].children[1], ARTISTS[0].children[0]]),
]

const ROOT = folder('root', 'Knihovna', 'directory', [
  folder('artists', 'Interpreti', 'directory', ARTISTS),
  folder('albums', 'Alba', 'directory', ALBUMS),
  folder('playlists', 'Playlisty', 'directory', PLAYLISTS),
])

function index(node, map = new Map()) {
  map.set(node.media_content_id, node)
  for (const child of node.children || []) index(child, map)
  return map
}
const BY_ID = index(ROOT)

const shallow = (node) => {
  const { children, ...rest } = node
  return { ...rest, children: (children || []).map(({ children: _c, ...c }) => c) }
}

export function mockBrowse(contentId) {
  const node = contentId ? BY_ID.get(contentId) : ROOT
  if (!node) throw new Error('demo: unknown media id')
  return shallow(node)
}

export function mockSearch(query) {
  const q = String(query || '').trim().toLowerCase()
  const result = []
  const seen = new Set()
  for (const node of BY_ID.values()) {
    if (node === ROOT || seen.has(node.media_content_id)) continue
    if (`${node.title} ${node.dash_artist || ''}`.toLowerCase().includes(q)) {
      seen.add(node.media_content_id)
      const { children: _c, ...item } = node
      result.push(item)
    }
  }
  return { result: result.slice(0, 50) }
}

export function mockItem(contentId) {
  return BY_ID.get(contentId) || null
}
