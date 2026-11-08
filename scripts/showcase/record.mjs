#!/usr/bin/env node
/**
 * Showcase video and README hero GIF from the mock/demo build.
 *
 *   npm run showcase                 capture, compose, encode (needs ffmpeg for the last step)
 *   npm run showcase -- --preview    capture, then one composed test frame per scene only
 *   npm run showcase -- --compose-only reuse showcase/out/capture, compose (and encode) again
 *   npm run showcase -- --encode-only  reuse showcase/out/frames, only run ffmpeg
 *
 * Steps
 *   1. Build with VITE_MODE=mock into node_modules/.cache/dash-showcase and
 *      serve it with `vite preview` on a free port (like scripts/screenshots.mjs).
 *   2. Record every clip of storyboard.mjs at 390x844 CSS px, deviceScaleFactor 2,
 *      through the Chrome DevTools Protocol (JPEG q92, with timestamps):
 *      showcase/out/capture/<clip>/. Default: Page.captureScreenshot in a loop at
 *      scale 2, real 780x1688 frames at the rate Chromium manages (~13 fps here).
 *      `--capture=screencast` uses Page.startScreencast instead: smoother, but
 *      headless Chromium sends 390x844 frames, so it is the lower-quality fallback.
 *   3. Resample to a constant 30 fps and compose 1080x1920 frames (flat
 *      background, caption bar, phone) in Chromium: showcase/out/frames/<scene>/.
 *   4. ffmpeg: one H.264 file per scene with identical settings, optional
 *      showcase/real/*.mp4 clips normalised and spliced in after scene 7, all
 *      joined with the concat demuxer and `-c copy` -> showcase/out/dash-showcase.mp4;
 *      docs/img/hero.gif (360 px, 15 fps, palettegen/paletteuse, <= 4 MB).
 *
 * ffmpeg comes from PATH or the FFMPEG / FFPROBE environment variables. Without
 * it, steps 1-3 still run and the frames stay in showcase/out/.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, preview } from 'vite'
import { chromium } from 'playwright'
import { CLIPS, GIF_PARTS, PORTRAIT, SCENES, TAGLINE } from './storyboard.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(root, 'showcase/out')
const CAPTURE = join(OUT, 'capture')
const FRAMES = join(OUT, 'frames')
const REAL = join(root, 'showcase/real')
const HERO = join(root, 'docs/img/hero.gif')
const FPS = 30
const GIF_FPS = 15
const GIF_MAX = 4 * 1024 * 1024
const W = 1080
const H = 1920
const BG = '#0a0a0f' // public/favicon.svg, as in scripts/gen-og.mjs

const args = new Set(process.argv.slice(2))
const PREVIEW = args.has('--preview')
const ENCODE_ONLY = args.has('--encode-only')
const COMPOSE_ONLY = args.has('--compose-only') // reuse showcase/out/capture
// screenshot (default): real 780x1688 frames, ~13 fps on a desktop CPU;
// screencast: smoother, but 390x844 frames in headless Chromium
const CAPTURE_MODE = args.has('--capture=screencast') ? 'screencast' : 'screenshot'

const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FFPROBE = process.env.FFPROBE || 'ffprobe'
const hasTool = (bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0

function run(bin, argv) {
  const r = spawnSync(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`${bin} ${argv.join(' ')}\n${r.stderr?.toString().slice(-2000)}`)
  return r.stdout.toString()
}

const pad = (n) => String(n).padStart(5, '0')
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

// ─── 2. capture ──────────────────────────────────────────────────────────────

async function recordClip(browser, base, clip) {
  const viewport = clip.viewport || PORTRAIT
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: 'en-US',
    colorScheme: clip.colorScheme || 'light',
    reducedMotion: 'no-preference',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + clip.url, { waitUntil: 'networkidle' })
  await page.locator(clip.ready || 'nav.liquid-dock__nav button').first().waitFor({ timeout: 15000 })
  if (clip.prepare) await clip.prepare(page)
  await page.waitForTimeout(900) // intro animations settle outside the clip

  const dir = join(CAPTURE, clip.name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const frames = []
  const cdp = await ctx.newCDPSession(page)
  const save = (data, ts) => {
    const file = `${pad(frames.length + 1)}.jpg`
    writeFileSync(join(dir, file), Buffer.from(data, 'base64'))
    frames.push({ file, ts })
  }
  let end
  if (CAPTURE_MODE === 'screencast') {
    // smooth, but this headless Chromium sends CSS-px (1x) frames
    let first
    const gotFirst = new Promise((resolve) => (first = resolve))
    cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      save(data, metadata.timestamp)
      first()
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId })
      } catch {
        /* session closed */
      }
    })
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: viewport.width * 2,
      maxHeight: viewport.height * 2,
      everyNthFrame: 1,
    })
    await gotFirst
    await clip.run(page)
    end = Date.now() / 1000
    await cdp.send('Page.stopScreencast')
  } else {
    // sharp: every frame rendered at deviceScaleFactor 2 (780x1688), as fast as
    // Chromium allows; the timestamp is the middle of each capture
    let recording = true
    const clipRect = { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 2 }
    const grab = async () => {
      const t = Date.now() / 1000
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, clip: clipRect })
      save(data, (t + Date.now() / 1000) / 2)
    }
    await grab()
    const loop = (async () => {
      while (recording) await grab()
    })()
    await clip.run(page)
    end = Date.now() / 1000
    recording = false
    await loop
  }
  await ctx.close()

  const t0 = frames[0].ts
  const meta = { name: clip.name, duration: end - t0, frames: frames.map((f) => ({ file: f.file, t: f.ts - t0 })) }
  writeFileSync(join(dir, 'frames.json'), JSON.stringify(meta, null, 1))
  if (errors.length) throw new Error(`${clip.name}: page errors\n  ${errors.join('\n  ')}`)
  console.log(`clip ${clip.name.padEnd(18)} ${frames.length} frames, ${meta.duration.toFixed(1)} s`)
}

const clipCache = new Map()
function clipMeta(name) {
  if (!clipCache.has(name)) clipCache.set(name, JSON.parse(readFileSync(join(CAPTURE, name, 'frames.json'), 'utf8')))
  return clipCache.get(name)
}

/** The source frame (absolute path) a clip shows at time t (last frame at or before t). */
function frameAt(name, t) {
  const { frames } = clipMeta(name)
  let pick = frames[0]
  for (const f of frames) {
    if (f.t <= t) pick = f
    else break
  }
  return join(CAPTURE, name, pick.file)
}

/** Per output frame of a scene: { src, src2, alpha }. */
function sceneTimeline(scene, fps = FPS) {
  const out = []
  const total = Math.round(scene.dur * fps)
  if (scene.card) {
    for (let i = 0; i < total; i++) out.push({})
    return out
  }
  scene.parts.forEach((part, pi) => {
    const n = Math.round(part.dur * fps)
    const next = scene.parts[pi + 1]
    for (let i = 0; i < n; i++) {
      const t = part.from + i / fps
      const frame = { src: frameAt(part.clip, t) }
      const fadeStart = part.dur - (part.fade || 0)
      if (part.fade && next && i / fps >= fadeStart) {
        frame.src2 = frameAt(next.clip, next.from)
        frame.alpha = (i / fps - fadeStart) / part.fade
      }
      out.push(frame)
    }
  })
  while (out.length < total) out.push(out[out.length - 1])
  return out.slice(0, total)
}

// ─── 3. compose ──────────────────────────────────────────────────────────────

const favicon = `data:image/svg+xml;base64,${readFileSync(join(root, 'public/favicon.svg')).toString('base64')}`

const COMPOSE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; background: ${BG}; overflow: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #fff; }
  .caption { position: absolute; left: 0; right: 0; top: 70px; height: 150px; display: flex; align-items: center; justify-content: center;
    font-size: 60px; font-weight: 800; letter-spacing: -1px; text-align: center; padding: 0 40px; white-space: nowrap; }
  .stage { position: absolute; left: 0; right: 0; top: 260px; bottom: 60px; display: flex; align-items: center; justify-content: center; }
  .phone { position: relative; background: #000; border: 8px solid #2c2c30; overflow: hidden; }
  .phone.portrait { width: 746px; height: 1600px; border-radius: 96px; }
  .phone.landscape { width: 980px; height: 459px; border-radius: 64px; }
  .phone img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .card { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 90px; }
  .mark { display: flex; align-items: center; gap: 36px; }
  .mark img { width: 170px; height: 170px; }
  .mark span { font-size: 190px; font-weight: 800; letter-spacing: -7px; line-height: 1; }
  .tag { margin-top: 64px; font-size: 56px; line-height: 1.25; font-weight: 600; color: #e5e5ea; }
  .meta { margin-top: 64px; font-size: 52px; font-weight: 700; color: #fbbf24; }
  .url { margin-top: 28px; font-size: 52px; font-weight: 600; color: #e5e5ea; }
  body.is-card .caption, body.is-card .stage { display: none; }
  body.is-card .card { display: flex; }
</style></head><body>
  <div class="caption" id="caption"></div>
  <div class="stage"><div class="phone portrait" id="phone"><img id="a" alt=""><img id="b" alt="" style="opacity:0"></div></div>
  <div class="card" id="card">
    <div class="mark"><img src="${favicon}" alt=""><span>dash</span></div>
    <p class="tag" id="cardTag"></p>
    <p class="meta" id="cardMeta"></p>
    <p class="url" id="cardUrl"></p>
  </div>
</body></html>`

const CARDS = {
  title: { tag: TAGLINE, meta: '', url: '' },
  end: { tag: '', meta: 'Open source · AGPL-3.0 · HACS', url: 'dash.matyas.online' },
}

const dataUrl = (file) => `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`

async function composer(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await page.setContent(COMPOSE_HTML, { waitUntil: 'load' })
  let last = ''
  return {
    async render(scene, frame, file) {
      const key = JSON.stringify([scene.name, frame.src, frame.src2, frame.alpha?.toFixed(3)])
      if (key === last) return false
      last = key
      await page.evaluate(
        async ({ caption, card, landscape, a, b, alpha }) => {
          document.body.classList.toggle('is-card', !!card)
          document.getElementById('caption').textContent = caption || ''
          if (card) {
            document.getElementById('cardTag').textContent = card.tag
            document.getElementById('cardMeta').textContent = card.meta
            document.getElementById('cardUrl').textContent = card.url
            return
          }
          const phone = document.getElementById('phone')
          phone.className = `phone ${landscape ? 'landscape' : 'portrait'}`
          const ia = document.getElementById('a')
          const ib = document.getElementById('b')
          if (ia.dataset.src !== a) {
            ia.src = a
            ia.dataset.src = a
          }
          if (b) {
            ib.src = b
            ib.style.opacity = String(alpha)
          } else ib.style.opacity = '0'
          await Promise.all([ia.decode(), b ? ib.decode() : null])
        },
        {
          caption: scene.caption,
          card: scene.card ? CARDS[scene.card] : null,
          landscape: !!scene.landscape,
          a: frame.src ? dataUrl(frame.src) : null,
          b: frame.src2 ? dataUrl(frame.src2) : null,
          alpha: frame.alpha ?? 0,
        },
      )
      await page.screenshot({ path: file, type: 'jpeg', quality: 92 })
      return true
    },
  }
}

async function composeAll(browser) {
  const c = await composer(browser)
  rmSync(FRAMES, { recursive: true, force: true })
  for (const scene of SCENES.filter((s) => !s.real)) {
    const dir = join(FRAMES, scene.name)
    mkdirSync(dir, { recursive: true })
    const timeline = sceneTimeline(scene)
    let prev = null
    for (let i = 0; i < timeline.length; i++) {
      const file = join(dir, `${pad(i + 1)}.jpg`)
      const drawn = await c.render(scene, timeline[i], file)
      if (!drawn && prev) copyFileSync(prev, file)
      prev = file
    }
    console.log(`scene ${scene.name.padEnd(12)} ${timeline.length} frames`)
  }
}

async function composePreview(browser) {
  const c = await composer(browser)
  const dir = join(OUT, 'preview')
  mkdirSync(dir, { recursive: true })
  for (const scene of SCENES.filter((s) => !s.real)) {
    const timeline = sceneTimeline(scene)
    const file = join(dir, `${scene.name}.jpg`)
    await c.render(scene, timeline[Math.floor(timeline.length * 0.6)], file)
    console.log(`preview ${file}`)
  }
}

/** Raw phone frames for the hero GIF at a constant 15 fps. */
function gifFrames() {
  const dir = join(OUT, 'gif')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let n = 0
  for (const part of GIF_PARTS) {
    const count = Math.round(part.dur * GIF_FPS)
    for (let i = 0; i < count; i++) copyFileSync(frameAt(part.clip, part.from + i / GIF_FPS), join(dir, `${pad(++n)}.jpg`))
  }
  return dir
}

// ─── 4. encode ───────────────────────────────────────────────────────────────

// identical settings for every scene, so the concat demuxer can join with -c copy
const RANGE = 'format=yuv420p,setrange=limited'
const X264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(FPS), '-video_track_timescale', '15360', '-an', '-movflags', '+faststart']

function encodeTo(target, inputArgs) {
  const tmp = target.replace(/\.mp4$/, '.tmp.mp4')
  run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...inputArgs, ...X264, tmp])
  renameSync(tmp, target)
}

function encodeAll() {
  const clips = []
  const dir = join(OUT, 'scenes')
  mkdirSync(dir, { recursive: true })
  for (const scene of SCENES) {
    if (scene.real) {
      if (!existsSync(REAL)) continue
      for (const f of readdirSync(REAL).filter((x) => x.toLowerCase().endsWith('.mp4')).sort()) {
        const target = join(dir, `real-${f}`)
        encodeTo(target, [
          '-i', join(REAL, f),
          '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease:out_range=limited,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x${BG.slice(1)},fps=${FPS},${RANGE}`,
        ])
        clips.push(target)
        console.log(`real clip ${f}`)
      }
      continue
    }
    const target = join(dir, `${scene.name}.mp4`)
    // JPEG frames are full range; convert to limited range so the file is plain yuv420p
    encodeTo(target, ['-framerate', String(FPS), '-i', join(FRAMES, scene.name, '%05d.jpg'), '-vf', `scale=in_range=full:out_range=limited,${RANGE}`])
    clips.push(target)
  }
  const list = join(dir, 'concat.txt')
  writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n') + '\n')
  const final = join(OUT, 'dash-showcase.mp4')
  const tmp = join(OUT, 'dash-showcase.tmp.mp4')
  run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', tmp])
  renameSync(tmp, final)
  if (hasTool(FFPROBE)) {
    const probe = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt:format=duration', '-of', 'json', final])
    console.log(`${final}\n${probe}`)
  }
}

function encodeGif(dir) {
  // fewer colours / frames until it fits; never drop the README promise
  for (const [colors, fps] of [[256, GIF_FPS], [128, GIF_FPS], [96, GIF_FPS], [64, 12], [48, 10]]) {
    const tmp = HERO.replace(/\.gif$/, '.tmp.gif')
    run(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-framerate', String(GIF_FPS), '-i', join(dir, '%05d.jpg'),
      '-vf', `fps=${fps},scale=360:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-loop', '0', tmp,
    ])
    const size = statSync(tmp).size
    if (size <= GIF_MAX) {
      renameSync(tmp, HERO)
      console.log(`docs/img/hero.gif ${Math.round(size / 1024)} KB (${colors} colours, ${fps} fps)`)
      return
    }
    rmSync(tmp)
  }
  throw new Error('hero.gif stays over 4 MB; shorten GIF_PARTS in storyboard.mjs')
}

// ─── main ────────────────────────────────────────────────────────────────────

const ffmpeg = hasTool(FFMPEG)
mkdirSync(OUT, { recursive: true })

if (!ENCODE_ONLY) {
  const port = await freePort()
  const buildDir = join(root, 'node_modules/.cache/dash-showcase')
  process.env.VITE_MODE = 'mock'
  await build({ root, logLevel: 'warn', build: { outDir: buildDir, emptyOutDir: true } })
  const server = await preview({ root, logLevel: 'warn', build: { outDir: buildDir }, preview: { port, strictPort: true } })
  const browser = await chromium.launch()
  try {
    if (!COMPOSE_ONLY) for (const clip of CLIPS) await recordClip(browser, `http://localhost:${port}`, clip)
    if (PREVIEW) await composePreview(browser)
    else await composeAll(browser)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.httpServer.close(resolve))
  }
  if (PREVIEW) process.exit(0)
}

const gifDir = gifFrames()
if (!ffmpeg) {
  console.log(`\nffmpeg not found (PATH or FFMPEG=...). Frames are ready:\n  ${FRAMES}\n  ${gifDir}\nInstall ffmpeg and run \`npm run showcase -- --encode-only\` to encode the video and docs/img/hero.gif.`)
  process.exit(0)
}
encodeAll()
encodeGif(gifDir)
