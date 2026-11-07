/**
 * Edges of the app on a phone, against a mock-mode build (see scripts/smoke.mjs):
 * the wallpaper must reach the top and bottom edge (no strip under the status bar,
 * no "chin" under the dock) and the dock must sit a fixed gap above the home indicator.
 *
 *   node scripts/layout-edges.mjs     # BASE_URL defaults to http://localhost:4173
 *   SHOTS=dir node scripts/layout-edges.mjs   # also keep the screenshots
 *
 * Chromium has no iOS safe-area insets, so `?safe=top,bottom` (dev/demo builds only)
 * simulates them. Tiles may scroll under the home indicator like on iOS, so the
 * test hides the tiles and the dock, keeps every layer behind them (shell, pages,
 * strips) and compares the edges pixel by pixel with a screenshot of the wallpaper
 * layer alone. A band of any other colour at an edge fails, whatever the wallpaper.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || ''
const problems = []

const CASES = [
  { name: 'notch-light', width: 390, height: 844, safe: [59, 34], theme: 'light' },
  { name: 'notch-dark', width: 390, height: 844, safe: [59, 34], theme: 'dark' },
  { name: 'home-button-light', width: 375, height: 667, safe: [20, 0], theme: 'light' },
  { name: 'home-button-dark', width: 375, height: 667, safe: [20, 0], theme: 'dark' },
]

/** Mean colour per row band (top and bottom `rows` px) of a PNG, decoded in the browser. */
async function edgeBands(decoder, png, rows = 10) {
  return decoder.evaluate(
    async ({ b64, rows }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const band = (y0) => {
        const d = ctx.getImageData(0, y0, c.width, rows).data
        const out = []
        // One sample per 10 px column, so a local difference is not averaged away
        for (let x = 0; x < c.width; x += 10) {
          let r = 0
          let g = 0
          let b = 0
          for (let y = 0; y < rows; y++) {
            const i = (y * c.width + x) * 4
            r += d[i]
            g += d[i + 1]
            b += d[i + 2]
          }
          out.push([r / rows, g / rows, b / rows])
        }
        return out
      }
      return { top: band(0), bottom: band(c.height - rows) }
    },
    { b64: png.toString('base64'), rows },
  )
}

const maxDiff = (a, b) =>
  Math.max(...a.map((px, i) => Math.max(...px.map((v, k) => Math.abs(v - b[i][k])))))

const browser = await chromium.launch()
const decoder = await (await browser.newContext()).newPage()

try {
  for (const c of CASES) {
    const context = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 1,
      locale: 'cs-CZ',
      colorScheme: c.theme,
    })
    const page = await context.newPage()
    page.on('pageerror', (err) => problems.push(`[${c.name}] page error: ${err.message}`))
    await page.goto(`${BASE_URL}/?lang=cs&theme=${c.theme}&safe=${c.safe.join(',')}`)
    await page.locator('.liquid-dock__glass').waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(700)

    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: join(SHOTS, `edges-${c.name}.png`) })
    }
    // Every layer except the content: tiles, header tiles and the dock hidden
    const noContent = await page.addStyleTag({
      content: '[data-dashboard-scroll] *, .liquid-dock { visibility: hidden !important; }',
    })
    await page.waitForTimeout(100)
    const full = await page.screenshot()
    // Only the wallpaper layer
    const onlyWallpaper = await page.addStyleTag({
      content: '.dashboard-shell > :not(.wallpaper) { visibility: hidden !important; }',
    })
    await page.waitForTimeout(100)
    const wallpaper = await page.screenshot()
    await noContent.evaluate((el) => el.remove())
    await onlyWallpaper.evaluate((el) => el.remove())

    const a = await edgeBands(decoder, full)
    const b = await edgeBands(decoder, wallpaper)
    const top = maxDiff(a.top, b.top)
    const bottom = maxDiff(a.bottom, b.bottom)
    if (top > 6) problems.push(`[${c.name}] top 10 px differ from the wallpaper (max channel diff ${top.toFixed(1)})`)
    if (bottom > 6) problems.push(`[${c.name}] bottom 10 px differ from the wallpaper (max channel diff ${bottom.toFixed(1)})`)

    const geo = await page.evaluate(() => {
      const glass = document.querySelector('.liquid-dock__glass').getBoundingClientRect()
      const safeBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--frame-safe-bottom')) || 0
      const scroller = document.querySelector('[data-dashboard-scroll]')
      scroller.scrollTop = scroller.scrollHeight
      const tiles = [...scroller.querySelectorAll('.tile-grid > *')]
      const lastBottom = Math.max(...tiles.map((t) => t.getBoundingClientRect().bottom))
      return { gap: window.innerHeight - glass.bottom, dockTop: glass.top, safeBottom, lastBottom }
    })
    const low = 8 + geo.safeBottom
    const high = 24 + geo.safeBottom
    if (geo.gap < low || geo.gap > high) {
      problems.push(`[${c.name}] dock bottom is ${geo.gap.toFixed(1)} px above the edge, expected ${low}–${high}`)
    }
    if (geo.lastBottom > geo.dockTop) {
      problems.push(`[${c.name}] last tile row (bottom ${geo.lastBottom.toFixed(0)}) is under the dock (top ${geo.dockTop.toFixed(0)})`)
    }
    console.log(
      `${c.name}: top diff ${top.toFixed(1)}, bottom diff ${bottom.toFixed(1)}, dock ${geo.gap.toFixed(1)} px above the edge, last row ${(geo.dockTop - geo.lastBottom).toFixed(0)} px above the dock`,
    )
    await context.close()
  }
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`\nLayout edge test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Layout edge test passed.')
