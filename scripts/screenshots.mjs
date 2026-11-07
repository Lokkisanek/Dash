#!/usr/bin/env node
/**
 * README screenshots from the mock/demo build.
 *
 *   npm run screenshots          # writes docs/img/*.png
 *
 * Builds with VITE_MODE=mock into node_modules/.cache, serves it with
 * `vite preview`, drives Chromium through the real UI (dock buttons, Wi-Fi
 * button) and stops the server again.
 *
 * Not captured:
 * - home-dark: `?theme=dark` only applies when the config has no
 *   appearance.mode, and the bundled mock config sets mode "light".
 * - standby-photos: the mock config uses the clock; switching StandBy to
 *   photos needs the HA config panel.
 * - the HA config panel itself (needs a running Home Assistant).
 *
 * Guest pass shots use the mock guest profile (src/lib/mockGuest.js).
 */
import { mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { build, preview } from 'vite'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs/img')
const buildDir = join(root, 'node_modules/.cache/dash-screenshots')
const PORT = 4174
const BASE = `http://localhost:${PORT}`
const PORTRAIT = { width: 390, height: 844 }
const LANDSCAPE = { width: 844, height: 390 }

mkdirSync(outDir, { recursive: true })

process.env.VITE_MODE = 'mock'
await build({ root, logLevel: 'warn', build: { outDir: buildDir, emptyOutDir: true } })
const server = await preview({
  root,
  logLevel: 'warn',
  build: { outDir: buildDir },
  preview: { port: PORT, strictPort: true },
})

/**
 * Wait until every finite CSS/Web animation has finished, then a short grace
 * period. Screens that keep starting short animations (the StandBy clock ticks
 * every second) fall back to the fixed wait after 3 s.
 */
async function settle(page, extraMs = 400) {
  try {
    await page.waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running')
          .every((a) => a.effect?.getComputedTiming().endTime === Infinity),
      null,
      { timeout: 3_000 },
    )
  } catch {
    /* animations keep restarting; the fixed wait below is enough */
  }
  await page.waitForTimeout(extraMs)
}

async function shot(page, name, clip) {
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file, clip, animations: 'allow', caret: 'hide' })
  console.log(`${name}.png  ${Math.round(statSync(file).size / 1024)} KB`)
}

/** Screenshot of one tile cell with a small margin, centred in the scroll area first. */
async function tileShot(page, selector, name, pad = 12) {
  const cell = page.locator('.device-cell', { has: page.locator(selector) }).first()
  await cell.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await settle(page)
  const box = await cell.boundingBox()
  await shot(page, name, {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(PORTRAIT.width, box.width + pad * 2),
    height: box.height + pad * 2,
  })
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: PORTRAIT, deviceScaleFactor: 2, locale: 'en-US' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/?lang=en&theme=light`, { waitUntil: 'networkidle' })
  await page.locator('nav.liquid-dock__nav button').first().waitFor()
  await settle(page, 800)
  await shot(page, 'home-light')

  await tileShot(page, '.media-tile', 'media-card')
  await tileShot(page, '.dial-tile', 'climate-dial')

  await page.locator('nav.liquid-dock__nav button').nth(1).click() // second dock page (bedroom)
  await settle(page, 800)
  await shot(page, 'bedroom-tiles')

  await page.getByRole('button', { name: 'Wi-Fi' }).click()
  await page.locator('dialog[open]').waitFor()
  await page.locator('dialog[open] img[src^="data:image"]').waitFor()
  await settle(page, 600)
  await shot(page, 'wifi-qr')
  await ctx.close()

  for (const [name, viewport] of [
    ['standby-clock-portrait', PORTRAIT],
    ['standby-clock-landscape', LANDSCAPE],
  ]) {
    const c = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'en-US' })
    const p = await c.newPage()
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(`${BASE}/?lang=en&standby=1`, { waitUntil: 'networkidle' })
    await p.locator('.standby').waitFor()
    await settle(p, 800)
    await shot(p, name)
    await c.close()
  }

  // Guest passes (mock): pairing from a QR link, restricted dashboard, ended pass
  for (const [name, path] of [
    ['guest-pairing', '/#pair=K7MP-3QXH-9WAD'],
    ['guest-dashboard', '/?lang=cs&guest=1'],
    ['guest-ended', '/?lang=cs&guest=ended'],
  ]) {
    const c = await browser.newContext({ viewport: PORTRAIT, deviceScaleFactor: 2, locale: 'cs-CZ' })
    const p = await c.newPage()
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await settle(p, 800)
    await shot(p, name)
    await c.close()
  }

  if (errors.length) {
    console.error(`Page errors:\n  ${errors.join('\n  ')}`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
