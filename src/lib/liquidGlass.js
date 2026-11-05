/**
 * Liquid Glass WebGL — shader adapted from archisvaze/liquid-glass
 * https://github.com/archisvaze/liquid-glass
 *
 * Canvas is sized to the pill only. Backdrop is a live snapshot of the page
 * behind it (html-to-image), sampled with correct UV offsets.
 */
import * as THREE from 'three'
import { toCanvas } from 'html-to-image'

export const PILL_DEFAULTS = {
  width: 320,
  height: 78,
  radius: 39,
  thickness: 34,
  bezel: 16,
  ior: 2.4,
  blur: 2.4,
  specular: 0.22,
  tint: 0.02,
  shadow: 0,
}

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`

const FRAGMENT = `
precision highp float;
varying vec2 vUv;

uniform vec2 uResolution;
uniform vec2 uGlassSize;
uniform float uRadius;
uniform float uBezel;
uniform float uThickness;
uniform float uIOR;
uniform float uBlur;
uniform float uSpecular;
uniform float uTint;
uniform sampler2D uBgTex;
uniform vec2 uBgOffset; // pill top-left in capture pixels
uniform vec2 uBgSize;   // full capture size in pixels
uniform bool uHasBg;

float sdRoundedRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float surfaceHeight(float t) {
  float s = 1.0 - t;
  return pow(1.0 - s*s*s*s, 0.25);
}

vec3 sampleBg(vec2 canvasPx) {
  // canvasPx is in pill-local pixels (origin top-left of canvas)
  vec2 pagePx = uBgOffset + canvasPx;
  vec2 uv = pagePx / uBgSize;
  uv.y = 1.0 - uv.y;
  uv = clamp(uv, 0.001, 0.999);
  return texture2D(uBgTex, uv).rgb;
}

vec3 sampleBgBlurred(vec2 canvasPx, float radius) {
  if (radius < 0.5) return sampleBg(canvasPx);
  vec3 sum = vec3(0.0);
  vec2 offsets[12];
  offsets[0] = vec2(-0.94201, -0.39906);
  offsets[1] = vec2( 0.94558, -0.76890);
  offsets[2] = vec2(-0.09418, -0.92938);
  offsets[3] = vec2( 0.34495, 0.29387);
  offsets[4] = vec2(-0.91588, -0.45771);
  offsets[5] = vec2(-0.81544, 0.48568);
  offsets[6] = vec2(-0.38277, -0.56071);
  offsets[7] = vec2(-0.12675, 0.84686);
  offsets[8] = vec2( 0.89642, 0.41254);
  offsets[9] = vec2( 0.18150, -0.30020);
  offsets[10] = vec2(-0.01445, -0.16001);
  offsets[11] = vec2( 0.59614, 0.71118);
  for (int i = 0; i < 12; i++) {
    sum += sampleBg(canvasPx + offsets[i] * radius);
  }
  return sum / 12.0;
}

void main() {
  // Local pixel coords, origin top-left
  vec2 canvasPx = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
  vec2 center = uResolution * 0.5;
  vec2 p = canvasPx - center;
  vec2 halfSize = uGlassSize * 0.5;

  float sd = sdRoundedRect(p, halfSize, uRadius);

  if (sd > 0.75) {
    discard;
  }

  float distFromEdge = max(-sd, 0.0);
  float maxBezel = max(min(halfSize.x, halfSize.y) * 0.4, 1.0);
  float bezel = min(uBezel, min(uRadius, maxBezel));
  float t = clamp(distFromEdge / max(bezel, 1.0), 0.0, 1.0);

  float h = surfaceHeight(t);
  float dt = 0.001;
  float h2 = surfaceHeight(min(t + dt, 1.0));
  float dh = (h2 - h) / dt;

  float slopeAngle = atan(dh * (uThickness / max(bezel, 1.0)));
  float sinR = clamp(sin(slopeAngle) / uIOR, -1.0, 1.0);
  float thetaR = asin(sinR);
  float displacement = h * uThickness * (tan(slopeAngle) - tan(thetaR));

  vec2 grad;
  float eps = 0.5;
  grad.x = sdRoundedRect(p + vec2(eps, 0.0), halfSize, uRadius) - sd;
  grad.y = sdRoundedRect(p + vec2(0.0, eps), halfSize, uRadius) - sd;
  float gLen = length(grad);
  grad = gLen > 0.0001 ? grad / gLen : vec2(0.0, 1.0);

  vec2 refractedPx = canvasPx - grad * displacement;

  vec3 color = uHasBg
    ? sampleBgBlurred(refractedPx, uBlur)
    : vec3(0.95, 0.93, 0.98);

  vec2 lightDir = normalize(vec2(0.25, -0.9));
  float rimDot = abs(dot(grad, lightDir));
  float rimFalloff = 1.0 - smoothstep(0.0, bezel * 0.85, distFromEdge);
  color += vec3(pow(rimDot * rimFalloff, 3.5) * uSpecular);

  color = mix(color, vec3(1.0), uTint);

  float alpha = smoothstep(0.9, -0.4, sd) * mix(0.78, 0.94, t);
  gl_FragColor = vec4(color, alpha);
}`

export function mountLiquidGlassPill(wrapEl, canvasEl, options = {}) {
  const params = { ...PILL_DEFAULTS, ...options }
  const captureEl = options.captureEl || document.body
  const filter = options.filter || (() => true)

  let disposed = false
  let bgTexture = null
  let hasBg = false
  let capturing = false
  let captureTimer = 0
  let pageSize = { w: 1, h: 1 }
  let pillOffset = { x: 0, y: 0 }

  const renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uGlassSize: { value: new THREE.Vector2(params.width, params.height) },
      uRadius: { value: params.radius },
      uBezel: { value: params.bezel },
      uThickness: { value: params.thickness },
      uIOR: { value: params.ior },
      uBlur: { value: params.blur },
      uSpecular: { value: params.specular },
      uTint: { value: params.tint },
      uBgTex: { value: null },
      uBgOffset: { value: new THREE.Vector2(0, 0) },
      uBgSize: { value: new THREE.Vector2(1, 1) },
      uHasBg: { value: false },
    },
    transparent: true,
    depthTest: false,
  })

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))

  function layout() {
    const shell = captureEl.getBoundingClientRect()
    const pill = wrapEl.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const w = Math.max(1, Math.round(pill.width))
    const h = Math.max(1, Math.round(pill.height))
    renderer.setSize(w, h, false)

    const gw = Math.min(params.width, w - 2)
    const gh = Math.min(params.height, h - 2)
    const gr = Math.min(params.radius, gw / 2, gh / 2)
    const bezel = Math.min(params.bezel, gh * 0.28, gr)

    material.uniforms.uResolution.value.set(w, h)
    material.uniforms.uGlassSize.value.set(gw, gh)
    material.uniforms.uRadius.value = gr
    material.uniforms.uBezel.value = bezel
    material.uniforms.uThickness.value = params.thickness
    material.uniforms.uIOR.value = params.ior
    material.uniforms.uBlur.value = params.blur
    material.uniforms.uSpecular.value = params.specular
    material.uniforms.uTint.value = params.tint

    // Offsets in CSS pixels (shader uses same space as setSize without drawingBuffer quirks)
    pillOffset = {
      x: (pill.left - shell.left) * (pageSize.w / Math.max(shell.width, 1)),
      y: (pill.top - shell.top) * (pageSize.h / Math.max(shell.height, 1)),
    }
    material.uniforms.uBgOffset.value.set(pillOffset.x, pillOffset.y)
    material.uniforms.uBgSize.value.set(pageSize.w, pageSize.h)
    material.uniforms.uHasBg.value = hasBg

    // Also pass css-pixel offset when texture matches shell css size * dpr
    // Recompute using dpr-consistent space:
    const cssW = Math.max(shell.width, 1)
    const cssH = Math.max(shell.height, 1)
    material.uniforms.uBgOffset.value.set(
      ((pill.left - shell.left) / cssW) * pageSize.w,
      ((pill.top - shell.top) / cssH) * pageSize.h,
    )

    void dpr
    renderer.render(scene, camera)
  }

  function softenDockBand(sourceCanvas) {
    // Hairlines from layout edges (card shadows / section seams) get baked into
    // the capture and show up as a “random line” through the pill. Soften that band.
    const ctx = sourceCanvas.getContext('2d')
    if (!ctx) return sourceCanvas

    const shell = captureEl.getBoundingClientRect()
    const pill = wrapEl.getBoundingClientRect()
    const scaleX = sourceCanvas.width / Math.max(shell.width, 1)
    const scaleY = sourceCanvas.height / Math.max(shell.height, 1)

    const bandY = Math.max(0, (pill.top - shell.top) * scaleY - 28 * scaleY)
    const bandH = Math.min(sourceCanvas.height - bandY, (pill.height + 56) * scaleY)

    const tmp = document.createElement('canvas')
    tmp.width = sourceCanvas.width
    tmp.height = sourceCanvas.height
    const tctx = tmp.getContext('2d')
    tctx.drawImage(sourceCanvas, 0, 0)
    tctx.filter = `blur(${Math.max(10, 14 * scaleY)}px)`
    tctx.drawImage(
      sourceCanvas,
      0,
      bandY,
      sourceCanvas.width,
      bandH,
      0,
      bandY,
      sourceCanvas.width,
      bandH,
    )
    tctx.filter = 'none'
    return tmp
  }

  function applyTexture(sourceCanvas) {
    const prepared = softenDockBand(sourceCanvas)
    if (bgTexture) bgTexture.dispose()
    bgTexture = new THREE.CanvasTexture(prepared)
    bgTexture.colorSpace = THREE.SRGBColorSpace
    bgTexture.minFilter = THREE.LinearFilter
    bgTexture.magFilter = THREE.LinearFilter
    bgTexture.needsUpdate = true
    material.uniforms.uBgTex.value = bgTexture
    pageSize = { w: prepared.width, h: prepared.height }
    hasBg = true
    material.uniforms.uHasBg.value = true
    material.uniforms.uBgSize.value.set(pageSize.w, pageSize.h)
  }

  async function captureBackdrop() {
    if (disposed || capturing) return
    capturing = true
    const prev = canvasEl.style.visibility
    canvasEl.style.visibility = 'hidden'
    try {
      const shot = await toCanvas(captureEl, {
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        cacheBust: true,
        filter,
        backgroundColor: null,
      })
      if (!disposed) {
        applyTexture(shot)
        layout()
      }
    } catch (err) {
      console.warn('[liquidGlass] capture failed:', err)
      layout()
    } finally {
      canvasEl.style.visibility = prev
      capturing = false
    }
  }

  function scheduleCapture(delay = 70) {
    clearTimeout(captureTimer)
    captureTimer = setTimeout(() => captureBackdrop(), delay)
  }

  const ro = new ResizeObserver(() => {
    layout()
    scheduleCapture(100)
  })
  ro.observe(wrapEl)
  ro.observe(captureEl)

  layout()
  scheduleCapture(40)

  return {
    refresh: () => scheduleCapture(40),
    render: layout,
    destroy() {
      disposed = true
      clearTimeout(captureTimer)
      ro.disconnect()
      bgTexture?.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
