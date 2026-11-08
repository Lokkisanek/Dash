/**
 * Dock glass stays legible over content: with a white card under the dock,
 * the mean luminance inside the dock is at least 60 % of the card's (no dark
 * smear), in the app (refracting glass) and in the HA panel's preview iframe
 * (plain blur). Also saves the dock over the vinyl record for review.
 *
 *   node scripts/dock-glass.mjs     # BASE_URL (mock build) defaults to http://localhost:4173
 *   SHOTS=dir node scripts/dock-glass.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { serveHarness } from './serve-harness.mjs'

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || ''
const problems = []
const check = (ok, msg) => {
  if (!ok) problems.push(msg)
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

/** Mean relative luminance (0–1) of a PNG, decoded by the browser. */
async function meanLuminance(decoder, png) {
  return decoder.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const ch = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * ch(d[i]) + 0.7152 * ch(d[i + 1]) + 0.0722 * ch(d[i + 2])
    return sum / (d.length / 4)
  }, png.toString('base64'))
}

/**
 * Scrolls `cell` under the dock inside `scope` (page or frame). With `blank`,
 * the card's content is hidden so only its white surface is behind the glass.
 */
async function cardUnderDock(scope, cellSelector, blank) {
  return scope.evaluate(
    ([sel, hide]) => {
      const cell = document.querySelector(sel)
      const dock = document.querySelector('.liquid-dock__glass').getBoundingClientRect()
      const scroller = cell.closest('[data-dashboard-scroll]')
      const before = cell.getBoundingClientRect()
      if (!(before.top < dock.top && before.bottom > dock.bottom)) scroller.scrollTop += before.top - (dock.top - 40)
      const card = cell.querySelector('.squircle, section, div')
      for (const el of card.children) el.style.visibility = hide ? 'hidden' : ''
      const r = cell.getBoundingClientRect()
      const covers = r.top < dock.top && r.bottom > dock.bottom
      const bg = getComputedStyle(card).backgroundColor
      return { covers, bg, cell: [Math.round(r.top), Math.round(r.bottom)], dock: [Math.round(dock.top), Math.round(dock.bottom)], scroll: scroller.scrollTop }
    },
    [cellSelector, blank],
  )
}

const harness = await serveHarness()
const browser = await chromium.launch()
try {
  const decoderCtx = await browser.newContext()
  const decoder = await decoderCtx.newPage()

  // 1. the app, top-level: refracting glass over a white card
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
    const page = await context.newPage()
    await page.goto(`${BASE_URL}/?lang=cs&theme=${theme}&safe=59,34`)
    await page.locator('nav.liquid-dock__nav button', { hasText: 'Přehled' }).click()
    const vinyl = '.device-cell[data-w="4"][data-h="3"]:has([data-media-stage="vinyl"])'
    await page.locator(vinyl).waitFor()
    const glassMode = await page.locator('.liquid-dock__glass').getAttribute('data-glass')
    if (theme === 'light') {
      const r = await cardUnderDock(page, vinyl, true)
      check(r.covers, 'app: the card does not cover the dock')
      await page.waitForTimeout(300)
      const lum = await meanLuminance(decoder, await page.locator('.liquid-dock__glass').screenshot())
      console.log(`app (${glassMode}): dock luminance ${lum.toFixed(3)} over a white card (${r.bg})`)
      check(lum >= 0.6, `app: dock luminance ${lum.toFixed(3)} < 60 % of a white card`)
    }
    await cardUnderDock(page, vinyl, false)
    await page.waitForTimeout(300)
    if (SHOTS) writeFileSync(join(SHOTS, `dock-over-vinyl-${theme}.png`), await page.screenshot())
    await context.close()
  }

  // 2. the HA panel's preview iframe (scaled frame): plain blur, no smear
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'cs-CZ' })
  const page = await context.newPage()
  await page.goto(`${harness.url}/scripts/panel-harness/?app=${encodeURIComponent(`${BASE_URL}/?lang=cs`)}`)
  const frame = page.frameLocator('iframe[title="Guest dashboard live preview"]')
  // the panel's draft (harness fixture) has replaced the mock config
  await frame.locator('[data-tile-id="switch.koupelna_boiler"]').waitFor({ timeout: 15_000 })
  const handle = await page.locator('iframe[title="Guest dashboard live preview"]').elementHandle()
  const inner = await handle.contentFrame()
  const media = '.device-cell[data-tile-id="media_player.kuchyn"]'
  const glassMode = await inner.locator('.liquid-dock__glass').getAttribute('data-glass')
  check(glassMode === 'blur', `preview: glass should not refract inside the iframe (got ${glassMode})`)
  const r = await cardUnderDock(inner, media, true)
  check(r.covers, `preview: the card does not cover the dock ${JSON.stringify(r)}`)
  await page.waitForTimeout(300)
  const lum = await meanLuminance(decoder, await inner.locator('.liquid-dock__glass').screenshot())
  console.log(`preview (${glassMode}): dock luminance ${lum.toFixed(3)} over a white card`)
  check(lum >= 0.6, `preview: dock luminance ${lum.toFixed(3)} < 60 % of a white card`)
  await cardUnderDock(inner, media, false)
  if (SHOTS) await page.locator('#iphone').screenshot({ path: join(SHOTS, 'dock-preview.png') })
  await context.close()
  await decoderCtx.close()
} finally {
  await browser.close()
  await harness.close()
}

if (problems.length) {
  console.error(`\nDock glass test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Dock glass test passed.')
