#!/usr/bin/env node
/**
 * StandBy photo frame against a mock-mode build (see scripts/smoke.mjs for setup).
 *
 *   node scripts/standby-photos.mjs     # BASE_URL defaults to http://localhost:4173
 *
 * The demo build draws its photos at runtime and serves them through the same
 * cache and slideshow code as a real Home Assistant (?mockPhotos=1|empty|fail).
 */
import { chromium } from 'playwright'

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const problems = []

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${label}] console error: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`[${label}] page error: ${err.message}`))
}

const frontPhoto = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.standby .photo.is-front')
    if (!el) return null
    const style = getComputedStyle(el)
    return { id: el.dataset.photoId, bg: style.backgroundImage, opacity: Number(style.opacity) }
  })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })

try {
  // 1. Photos appear quickly and the slideshow moves on
  const page = await context.newPage()
  watch(page, 'photos')
  await page.goto(`${BASE_URL}/?standby=1&mockPhotos=1&lang=cs`)
  await page.locator('.standby').waitFor({ state: 'visible', timeout: 15_000 })
  const t0 = Date.now()
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.standby .photo.is-front')
      return el && getComputedStyle(el).backgroundImage.startsWith('url("blob:')
    },
    null,
    { timeout: 1_500 },
  )
  const first = await frontPhoto(page)
  console.log(`photos: first photo ${first.id.slice(-2)} on screen after ${Date.now() - t0} ms`)
  if ((await page.getAttribute('.standby', 'data-photo-status')) !== 'ready') {
    await page.waitForSelector('.standby[data-photo-status="ready"]', { timeout: 5_000 })
  }
  await page.waitForFunction(
    (id) => document.querySelector('.standby .photo.is-front')?.dataset.photoId !== id,
    first.id,
    { timeout: 8_000 },
  )
  const second = await frontPhoto(page)
  if (!second.bg.startsWith('url("blob:')) problems.push('[photos] second slide has no photo')
  console.log(`photos: slideshow advanced to ${second.id.slice(-2)}`)

  // 2. A failing photo list is visible on the fallback clock
  const fail = await context.newPage()
  watch(fail, 'fail')
  await fail.goto(`${BASE_URL}/?standby=1&mockPhotos=fail&lang=cs`)
  await fail.locator('.standby[data-photo-status="error"]').waitFor({ timeout: 10_000 })
  const note = (await fail.locator('.standby .photo-note').textContent())?.trim()
  if (note !== 'Fotky se nepodařilo načíst') problems.push(`[fail] unexpected note "${note}"`)
  if (await fail.locator('.standby .photo').count()) problems.push('[fail] photo layers shown')
  await fail.locator('.standby .digits').waitFor({ state: 'visible' })
  console.log(`fail: clock with "${note}"`)

  // 3. No photos yet
  const empty = await context.newPage()
  watch(empty, 'empty')
  await empty.goto(`${BASE_URL}/?standby=1&mockPhotos=empty&lang=en`)
  await empty.locator('.standby[data-photo-status="empty"]').waitFor({ timeout: 10_000 })
  const emptyNote = (await empty.locator('.standby .photo-note').textContent())?.trim()
  if (emptyNote !== 'No photos yet') problems.push(`[empty] unexpected note "${emptyNote}"`)
  console.log(`empty: clock with "${emptyNote}"`)
} catch (err) {
  problems.push(`assertion failed: ${err.message}`)
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`StandBy photo test failed:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('StandBy photo test passed.')
