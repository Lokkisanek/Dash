/**
 * Demo photos for the StandBy frame, drawn at runtime (flat colours, one shape,
 * a caption) and handed out as object URLs, so the demo build runs the real
 * photo cache and slideshow code instead of placeholders.
 *
 * Demo-only switches: ?mockPhotos=1 (photo mode), ?mockPhotos=empty, ?mockPhotos=fail.
 */
const PHOTOS = [
  { bg: '#2f5d50', fg: '#e9dfc4', label: 'Les' },
  { bg: '#c8643f', fg: '#fbefe0', label: 'Západ' },
  { bg: '#2e4f7f', fg: '#dfe8f4', label: 'Jezero' },
  { bg: '#5b4a7a', fg: '#efe8f8', label: 'Večer' },
]

export const MOCK_PHOTO_IDS = PHOTOS.map((_, i) => `${'0'.repeat(31)}${i + 1}`)

export function mockPhotosFlag() {
  try {
    return new URLSearchParams(window.location.search).get('mockPhotos')
  } catch {
    return null
  }
}

export async function mockPhotoUrl(id) {
  const photo = PHOTOS[MOCK_PHOTO_IDS.indexOf(id)]
  if (!photo) return null
  const canvas = document.createElement('canvas')
  // portrait-ish, so phones crop little and tablets still fill the screen
  canvas.width = 900
  canvas.height = 1100
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = photo.bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = photo.fg
  ctx.beginPath()
  ctx.arc(560, 330, 120, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  ctx.moveTo(0, 1100)
  ctx.lineTo(380, 640)
  ctx.lineTo(900, 1100)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.font = '600 46px system-ui, sans-serif'
  ctx.fillText(photo.label, 80, 160)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  return blob ? URL.createObjectURL(blob) : null
}
