/**
 * Music against a mock-mode build (see scripts/smoke.mjs): the vinyl style
 * (rotation state, angle kept across pause/resume, reduced motion), the
 * nowplaying style and the player sheet (browse, play, switch player, volume).
 *
 *   node scripts/player.mjs     # BASE_URL defaults to http://localhost:4173
 *   SHOTS=dir node scripts/player.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || ''
const problems = []
const check = (ok, msg) => {
  if (!ok) problems.push(msg)
}
const shot = async (page, name) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

/** Rotation angle of the vinyl disc in degrees, from its computed transform matrix. */
const angle = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-vinyl-disc]')
    const m = getComputedStyle(el).transform
    if (!m || m === 'none') return 0
    // numbers may use exponents such as 6.1e-17 (a near-zero sine)
    const [a, b] = m.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number)
    return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  })
const playState = (page) => page.evaluate(() => getComputedStyle(document.querySelector('[data-vinyl-disc]')).animationPlayState)

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
  const page = await context.newPage()
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`)
  })
  await page.goto(`${BASE_URL}/?lang=cs&safe=59,34`)
  await page.locator('nav.liquid-dock__nav button', { hasText: 'Přehled' }).click()
  const vinyl = page.locator('[data-media-stage="vinyl"]').first()
  await vinyl.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)

  // playing: the disc turns around a fixed centre (no orbiting) and there is no tonearm
  check((await playState(page)) === 'running', `vinyl should spin while playing, got ${await playState(page)}`)
  check((await page.locator('[data-tonearm]').count()) === 0, 'tonearm should be gone')
  const centre = () =>
    page.evaluate(() => {
      const r = document.querySelector('[data-vinyl-disc]').getBoundingClientRect()
      return [r.left + r.width / 2, r.top + r.height / 2]
    })
  const c1 = await centre()
  const r1 = await angle(page)
  await page.waitForTimeout(1000)
  const c2 = await centre()
  const r2 = await angle(page)
  check(Math.hypot(c1[0] - c2[0], c1[1] - c2[1]) < 1, `record centre moved: ${c1} -> ${c2}`)
  check(Math.abs(r1 - r2) > 1, `record angle did not change in 1 s (${r1.toFixed(1)} -> ${r2.toFixed(1)})`)
  await shot(page, 'vinyl-playing')

  // pause: stops at the current angle, keeps it, resumes from it
  await vinyl.locator('[data-play]').click()
  await page.waitForTimeout(300)
  check((await playState(page)) === 'paused', 'vinyl should pause')
  const a1 = await angle(page)
  await page.waitForTimeout(500)
  const a2 = await angle(page)
  check(Math.abs(a1 - a2) < 0.5, `angle changed while paused: ${a1.toFixed(1)} -> ${a2.toFixed(1)}`)
  await shot(page, 'vinyl-paused')
  const t0 = Date.now()
  await vinyl.locator('[data-play]').click()
  const a3 = await angle(page)
  const dt = (Date.now() - t0) / 1000
  const turned = (a3 - a2 + 360) % 360
  // 200°/s while running: it may only have moved on by the time that passed (+15°)
  check(turned <= 200 * dt + 15, `resume did not continue from the paused angle (${a2.toFixed(1)} -> ${a3.toFixed(1)} in ${dt.toFixed(2)} s)`)
  console.log(`vinyl: paused at ${a2.toFixed(1)}°, resumed at ${a3.toFixed(1)}° after ${dt.toFixed(2)} s`)

  // the record stays inside its tile, 4×3 and 2×2, light and dark
  for (const theme of ['light', 'dark']) {
    const p = await context.newPage()
    await p.goto(`${BASE_URL}/?lang=cs&theme=${theme}&safe=59,34`)
    await p.locator('nav.liquid-dock__nav button', { hasText: 'Přehled' }).click()
    for (const size of ['4x3', '2x2']) {
      const stage = p.locator(`.device-cell[data-w="${size[0]}"][data-h="${size[2]}"] [data-media-stage="vinyl"]`).first()
      await stage.scrollIntoViewIfNeeded()
      const inside = await stage.evaluate((el) => {
        const t = el.getBoundingClientRect()
        const r = el.querySelector('[data-vinyl-slot]').getBoundingClientRect()
        return r.width > 20 && r.left >= t.left - 0.5 && r.top >= t.top - 0.5 && r.right <= t.right + 0.5 && r.bottom <= t.bottom + 0.5
      })
      check(inside, `${theme} ${size}: record outside its tile`)
      if (SHOTS) await stage.screenshot({ path: join(SHOTS, `vinyl-${size}-${theme}.png`) })
    }
    await p.close()
  }

  // nowplaying style renders its scrubber-less idle state (kitchen is paused, no duration)
  const np = page.locator('[data-media-stage="nowplaying"]').first()
  await np.scrollIntoViewIfNeeded()
  check(await np.locator('input[type="range"]').count() === 1, 'nowplaying: volume slider expected')
  check(await np.locator('[data-play]').count() === 1, 'nowplaying: play button expected')
  await shot(page, 'nowplaying')

  // ── player sheet ─────────────────────────────────────────────────────────
  await vinyl.locator('.np-text').click()
  const sheet = page.locator('[data-player-sheet]')
  await sheet.waitFor({ state: 'visible', timeout: 3000 })
  const tabs = await sheet.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab))
  console.log('tabs:', tabs.join(', '))
  check(tabs.join(',') === 'now,players,browse,search', `tabs: ${tabs}`)
  await sheet.locator('[data-tab="browse"]').click()
  await sheet.locator('.item-main', { hasText: 'Interpreti' }).click()
  await sheet.locator('.item-main', { hasText: 'Tame Impala' }).click()
  await sheet.locator('.item', { hasText: 'Let It Happen' }).locator('button[aria-label="Přehrát"]').click()
  await page.waitForTimeout(200)
  await shot(page, 'player-browse')
  await sheet.locator('[data-tab="now"]').click()
  check((await sheet.innerText()).includes('Let It Happen'), 'played item is not now playing')
  // enqueue menu
  await sheet.locator('[data-tab="search"]').click()
  await sheet.locator('[data-search-input]').fill('m83')
  await sheet.locator('.group h3').first().waitFor({ timeout: 3000 })
  const groups = await sheet.locator('.group h3').allInnerTexts()
  console.log('search groups:', groups.join(', '))
  check(groups.length > 0, 'search found nothing')
  await shot(page, 'player-search')
  // players: switch to the kitchen (no browse there) and set its volume
  await sheet.locator('[data-tab="players"]').click()
  await shot(page, 'player-players')
  await sheet.locator('[data-player="media_player.kuchyn"] .pp-btn', { hasText: 'Přehrát zde' }).click()
  const tabs2 = await sheet.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab))
  check(tabs2.join(',') === 'now,players', `kitchen tabs: ${tabs2}`)
  const vol = sheet.locator('[data-player="media_player.kuchyn"] input[type="range"]')
  await vol.fill('40')
  await page.waitForTimeout(400)
  await sheet.locator('[data-tab="now"]').click()
  check(await sheet.locator('[data-speaker-hint]').count() === 1, 'no hint for a player without browse')
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden', timeout: 2000 })
  await context.close()

  // reduced motion: no rotation at all
  const rm = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ', reducedMotion: 'reduce' })
  const p2 = await rm.newPage()
  await p2.goto(`${BASE_URL}/?lang=cs`)
  await p2.locator('nav.liquid-dock__nav button', { hasText: 'Přehled' }).click()
  await p2.locator('[data-media-stage="vinyl"]').first().scrollIntoViewIfNeeded()
  await p2.waitForTimeout(500)
  const anim = await p2.evaluate(() => getComputedStyle(document.querySelector('[data-vinyl-disc]')).animationName)
  check(anim === 'none', `reduced motion still animates: ${anim}`)
  check((await p2.locator('[data-media-stage="vinyl"]').first().innerText()).includes('Přehrává se'), 'reduced motion: no "Přehrává se" label')
  await rm.close()

  // guest: only the allowed player, browse allowed by the demo profile
  const gc = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
  const g = await gc.newPage()
  await g.goto(`${BASE_URL}/?lang=cs&guest=1`)
  await g.locator('nav.liquid-dock__nav button', { hasText: 'Obývák' }).waitFor({ timeout: 15_000 })
  await g.locator('.device-cell[data-entity="media_player.obyvak"] .info').first().click()
  const gs = g.locator('[data-player-sheet]')
  await gs.waitFor({ state: 'visible', timeout: 3000 })
  const gtabs = await gs.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab))
  console.log('guest tabs:', gtabs.join(', '))
  check(gtabs.join(',') === 'now,browse,search', `guest tabs: ${gtabs}`)
  await gc.close()
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`\nPlayer test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Player test passed.')
