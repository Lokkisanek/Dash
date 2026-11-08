/**
 * SVG Liquid Glass (archisvaze/liquid-glass index.html)
 * Uses feDisplacementMap + backdrop-filter — real interaction with page content.
 * https://github.com/archisvaze/liquid-glass
 */

const SURFACE_FNS = {
  convex_squircle: (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25),
}

function calculateRefractionProfile(glassThickness, bezelWidth, heightFn, ior, samples = 128) {
  const eta = 1 / ior
  function refract(nx, ny) {
    const dot = ny
    const k = 1 - eta * eta * (1 - dot * dot)
    if (k < 0) return null
    const sq = Math.sqrt(k)
    return [-(eta * dot + sq) * nx, eta - (eta * dot + sq) * ny]
  }
  const profile = new Float64Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = i / samples
    const y = heightFn(x)
    const dx = x < 1 ? 0.0001 : -0.0001
    const y2 = heightFn(x + dx)
    const deriv = (y2 - y) / dx
    const mag = Math.sqrt(deriv * deriv + 1)
    const ref = refract(-deriv / mag, -1 / mag)
    if (!ref) {
      profile[i] = 0
      continue
    }
    profile[i] = ref[0] * ((y * bezelWidth + glassThickness) / ref[1])
  }
  return profile
}

function generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 128
    d[i + 1] = 128
    d[i + 2] = 0
    d[i + 3] = 255
  }

  const r = radius
  const rSq = r * r
  const r1Sq = (r + 1) ** 2
  const rBSq = Math.max(r - bezelWidth, 0) ** 2
  const wB = w - r * 2
  const hB = h - r * 2
  const S = profile.length

  for (let y1 = 0; y1 < h; y1++) {
    for (let x1 = 0; x1 < w; x1++) {
      const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0
      const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0
      const dSq = x * x + y * y
      if (dSq > r1Sq || dSq < rBSq) continue
      const dist = Math.sqrt(dSq)
      const fromSide = r - dist
      const op =
        dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq))
      if (op <= 0 || dist === 0) continue
      const cos = x / dist
      const sin = y / dist
      const bi = Math.min(((fromSide / bezelWidth) * S) | 0, S - 1)
      const disp = profile[bi] || 0
      const dX = (-cos * disp) / maxDisp
      const dY = (-sin * disp) / maxDisp
      const idx = (y1 * w + x1) * 4
      d[idx] = (128 + dX * 127 * op + 0.5) | 0
      d[idx + 1] = (128 + dY * 127 * op + 0.5) | 0
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL()
}

function generateSpecularMap(w, h, radius, bezelWidth, angle = Math.PI / 3) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(w, h)
  const d = img.data
  d.fill(0)

  const r = radius
  const rSq = r * r
  const r1Sq = (r + 1) ** 2
  const rBSq = Math.max(r - bezelWidth, 0) ** 2
  const wB = w - r * 2
  const hB = h - r * 2
  const sv = [Math.cos(angle), Math.sin(angle)]

  for (let y1 = 0; y1 < h; y1++) {
    for (let x1 = 0; x1 < w; x1++) {
      const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0
      const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0
      const dSq = x * x + y * y
      if (dSq > r1Sq || dSq < rBSq) continue
      const dist = Math.sqrt(dSq)
      const fromSide = r - dist
      const op =
        dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq))
      if (op <= 0 || dist === 0) continue
      const cos = x / dist
      const sin = -y / dist
      const dot = Math.abs(cos * sv[0] + sin * sv[1])
      const edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) ** 2))
      const coeff = dot * edge
      const col = (255 * coeff) | 0
      const alpha = (col * coeff * op) | 0
      const idx = (y1 * w + x1) * 4
      d[idx] = col
      d[idx + 1] = col
      d[idx + 2] = col
      d[idx + 3] = alpha
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL()
}

/**
 * Alpha mask that is opaque on the bezel and fades to clear inside, so the
 * refracted lens only shows where real glass bends light the most.
 */
function generateEdgeMask(w, h, radius, bezelWidth, inner = 0.12) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(w, h)
  const d = img.data
  const r = radius
  for (let y1 = 0; y1 < h; y1++) {
    for (let x1 = 0; x1 < w; x1++) {
      const x = x1 < r ? r - x1 : x1 >= w - r ? x1 - (w - r) + 1 : 0
      const y = y1 < r ? r - y1 : y1 >= h - r ? y1 - (h - r) + 1 : 0
      // distance from the rounded edge (0 at the rim)
      const fromEdge = x || y ? r - Math.sqrt(x * x + y * y) : Math.min(x1, y1, w - 1 - x1, h - 1 - y1)
      const t = Math.max(0, Math.min(1, fromEdge / bezelWidth))
      const s = t * t * (3 - 2 * t)
      const a = fromEdge < 0 ? 0 : 1 - (1 - inner) * s
      const idx = (y1 * w + x1) * 4
      d[idx] = d[idx + 1] = d[idx + 2] = 255
      d[idx + 3] = (a * 255) | 0
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL()
}

/** Chromium can refract the live backdrop; WebKit/Gecko can't (no url() in backdrop-filter). */
export function supportsSvgBackdrop() {
  if (typeof navigator === 'undefined') return false
  if (new URLSearchParams(window.location.search).get('glass') === 'lens') return false
  const ua = navigator.userAgent
  return /Chrome|Chromium|Edg\//.test(ua) && !/CriOS|EdgiOS|FxiOS/.test(ua)
}

/**
 * Refraction is a progressive enhancement on top of the plain blur: only in a
 * top-level page (inside the HA panel's scaled preview iframe Chromium samples
 * the backdrop wrongly and paints a dark smear), only where backdrop-filter
 * takes an SVG url(), and never with ?glass=flat.
 */
export function allowRefraction() {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).get('glass') === 'flat') return false
  try {
    if (window.parent !== window) return false
  } catch {
    return false
  }
  return true
}

/** The blur under every dock, refracting or not: the dock stays legible over any content. */
export const DOCK_BLUR = 'blur(18px) saturate(1.7)'

/** Pill defaults tuned for the room dock (no outer shadow). */
export const DOCK_GLASS = {
  width: 360,
  height: 88,
  radius: 44,
  glassThickness: 70,
  bezelWidth: 36,
  ior: 1.9,
  scaleRatio: 1.15,
  blur: 0.2,
  specularOpacity: 0.72,
  specularSaturation: 6,
  tintOpacity: 0.04,
}

/**
 * Build SVG filter markup + apply CSS vars onto `glassEl`.
 * Returns { destroy }.
 */
export function mountSvgLiquidGlass(glassEl, defsHost, options = {}) {
  const opts = { ...DOCK_GLASS, ...options }
  const filterId = options.filterId || `liquid-glass-dock-${Math.random().toString(36).slice(2, 8)}`

  function rebuild() {
    const w = Math.max(2, Math.round(glassEl.offsetWidth || opts.width))
    const h = Math.max(2, Math.round(glassEl.offsetHeight || opts.height))
    const radius = Math.floor(Math.min(opts.radius, w / 2, h / 2))
    const bezelW = Math.max(1, Math.min(opts.bezelWidth, radius - 1, Math.min(w, h) / 2 - 1))

    const profile = calculateRefractionProfile(
      opts.glassThickness,
      bezelW,
      SURFACE_FNS.convex_squircle,
      opts.ior,
      128,
    )
    const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1
    const dispUrl = generateDisplacementMap(w, h, radius, bezelW, profile, maxDisp)
    const specUrl = generateSpecularMap(w, h, radius, bezelW * 2.5)
    const scale = maxDisp * opts.scaleRatio

    defsHost.innerHTML = `
      <filter id="${filterId}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" result="dispMap" />
        <feDisplacementMap in="SourceGraphic" in2="dispMap" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
        <feGaussianBlur in="displaced" stdDeviation="${opts.blur}" result="blurred" />
        <feImage href="${specUrl}" x="0" y="0" width="${w}" height="${h}" result="specMap" />
        <feColorMatrix in="specMap" type="matrix"
          values="1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 ${opts.specularSaturation} 0" result="specSat" />
        <feComposite in="specSat" in2="blurred" operator="arithmetic" k1="0" k2="${opts.specularOpacity}" k3="1" k4="0" />
      </filter>
    `

    // Chromium refracts the real backdrop. Elsewhere the same filter runs as a
    // plain `filter` on a lens layer (a copy of the background), masked to the rim.
    if (supportsSvgBackdrop()) {
      // refraction first, then the same blur as without it (a lone url() drops the blur)
      glassEl.style.setProperty('--lg-filter', `url(#${filterId}) ${DOCK_BLUR}`)
      glassEl.style.removeProperty('--lg-lens-filter')
      glassEl.style.removeProperty('--lg-lens-mask')
    } else {
      glassEl.style.removeProperty('--lg-filter')
      glassEl.style.setProperty('--lg-lens-filter', `url(#${filterId})`)
      glassEl.style.setProperty('--lg-lens-mask', `url(${generateEdgeMask(w, h, radius, bezelW * 1.15)})`)
    }
    glassEl.style.setProperty('--lg-radius', `${radius}px`)
    glassEl.style.setProperty('--lg-tint', `rgba(255, 255, 255, ${opts.tintOpacity})`)
    glassEl.style.width = `${w}px`
    glassEl.style.height = `${h}px`
    glassEl.style.borderRadius = `${radius}px`
  }

  rebuild()
  const ro = new ResizeObserver(() => rebuild())
  ro.observe(glassEl)

  return {
    rebuild,
    destroy() {
      ro.disconnect()
      defsHost.innerHTML = ''
    },
  }
}
