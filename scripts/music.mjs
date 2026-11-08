/**
 * dash's own players against a mock-mode build (scripts/smoke.mjs): the
 * BrowserEngine plays a silent test tone generated in the page (no network),
 * pauses, fails over to "Stream nedostupný" for a dead station, the vinyl
 * turns while it plays; the panel's Music tab validates stations and shows
 * the Spotify wizard (Spotify stays off and is never contacted).
 *
 *   node scripts/music.mjs     # BASE_URL defaults to http://localhost:4173
 *   SHOTS=dir node scripts/music.mjs
 */
import { mkdirSync } from 'node:fs'
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

const harness = await serveHarness()
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const outside = []
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
  const page = await context.newPage()
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`))
  // privacy: nothing but this origin (and data:) by default
  page.on('request', (req) => {
    const url = req.url()
    if (!url.startsWith(BASE_URL) && !url.startsWith('data:') && !url.startsWith('blob:')) outside.push(url)
  })
  await page.goto(`${BASE_URL}/?lang=cs&safe=59,34`)
  await page.locator('nav.liquid-dock__nav button', { hasText: 'Přehled' }).click()
  const tile = page.locator('.device-cell[data-type="player"]')
  await tile.scrollIntoViewIfNeeded()
  await tile.locator('.np-text').click()
  const sheet = page.locator('[data-player-sheet]')
  await sheet.waitFor({ state: 'visible', timeout: 3000 })
  const tabs = await sheet.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab))
  console.log('radio sheet tabs:', tabs.join(', '))
  check(tabs.join() === 'now,sources,browse', `radio sheet tabs: ${tabs}`)

  const phase = () => sheet.locator('[data-media-stage]').getAttribute('data-phase')
  const spin = () =>
    sheet.locator('[data-vinyl-disc]').evaluate((el) => getComputedStyle(el).animationPlayState)
  await sheet.locator('[data-play]').click()
  await page.waitForFunction(() => document.querySelector('[data-player-sheet] [data-media-stage]')?.dataset.phase === 'playing', null, { timeout: 5000 }).catch(() => {})
  check((await phase()) === 'playing', `test tone should play, phase ${await phase()}`)
  check((await spin()) === 'running', 'vinyl should turn while the radio plays')
  check((await sheet.innerText()).includes('Testovací tón'), 'station name not shown')
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'radio-playing.png') })
  await sheet.locator('[data-play]').click()
  await page.waitForTimeout(200)
  check((await phase()) === 'paused', `pause: phase ${await phase()}`)
  check((await spin()) === 'paused', 'vinyl should stop when paused')

  // privacy: loading, playing and pausing contacted nothing but the app itself
  check(outside.length === 0, `requests outside the app: ${outside.join(', ')}`)

  // a station that cannot be reached: bounded retries, then "Stream nedostupný"
  await sheet.locator('[data-tab="browse"]').click()
  await sheet.locator('.item-main', { hasText: 'Nedostupná stanice' }).click()
  await page.keyboard.press('Escape')
  await tile.locator('[data-stream-error]').waitFor({ timeout: 8000 }).catch(() => {})
  check(await tile.locator('[data-stream-error]').isVisible(), 'no "Stream nedostupný" for a dead station')
  check((await tile.locator('[data-stream-error]').innerText()).includes('Stream nedostupný'), 'wrong error text')

  // a direct address must be https
  await tile.locator('.np-text').click()
  await sheet.locator('[data-tab="sources"]').click()
  await sheet.locator('#ps-stream-url').fill('http://stream.example.com/live.mp3')
  await sheet.locator('.ps-stream button[type="submit"]').click()
  check((await sheet.locator('.ps-stream [role="alert"]').innerText()).includes('https'), 'http stream address accepted')
  await page.keyboard.press('Escape')
  // only the station the user picked was contacted
  check(outside.every((u) => u.startsWith('https://stream.invalid/')), `unexpected hosts: ${outside.join(', ')}`)
  await context.close()

  // the panel's Music tab
  const pc = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'cs-CZ' })
  const panel = await pc.newPage()
  panel.on('pageerror', (err) => problems.push(`panel error: ${err.message}`))
  await panel.goto(`${harness.url}/scripts/panel-harness/?app=${encodeURIComponent(`${BASE_URL}/?lang=cs`)}`)
  await panel.locator('[data-tab="music"]').click()
  await panel.locator('#addStation').waitFor()
  await panel.locator('#newStName').fill('Plain http')
  await panel.locator('#newStUrl').fill('http://stream.example.com/live.mp3')
  await panel.locator('#addStation').click()
  check((await panel.locator('#radioError').innerText()).includes('https'), 'panel accepted an http station')
  await panel.locator('#newStName').fill('Rádio Test')
  await panel.locator('#newStUrl').fill('https://stream.invalid/live.mp3')
  await panel.locator('#addStation').click()
  check((await panel.locator('.station').count()) === 1, 'station not added')
  await panel.locator('[data-st-test="0"]').click()
  await panel.locator('[data-st-status="0"]', { hasText: 'Nehraje' }).waitFor({ timeout: 12_000 }).catch(() => {})
  check((await panel.locator('[data-st-status="0"]').innerText()).includes('Nehraje'), 'dead stream test did not report "Nehraje"')
  // Spotify: off by default, the wizard appears only when switched on
  check((await panel.locator('[data-spotify-wizard]').count()) === 0, 'Spotify wizard shown while off')
  await panel.locator('[data-spotify="enabled"]').check({ force: true })
  await panel.locator('[data-spotify-wizard]').waitFor()
  const steps = await panel.locator('[data-spotify-wizard] > li').count()
  const redirect = await panel.locator('#spotifyRedirect').innerText()
  console.log(`spotify wizard: ${steps} steps, redirect ${redirect}`)
  check(steps === 5, `wizard steps: ${steps}`)
  check(redirect.endsWith('/spotify-callback.html'), `redirect URI ${redirect}`)
  // the harness dashboard runs on http: the wizard says Spotify will refuse it
  check(await panel.locator('[data-spotify-wizard] .field-error').isVisible(), 'no http redirect warning')
  check(await panel.locator('#spotifyConnect').isDisabled(), 'connect enabled without a client id')
  if (SHOTS) await panel.screenshot({ path: join(SHOTS, 'panel-music.png'), fullPage: true })
  await pc.close()
} finally {
  await browser.close()
  await harness.close()
}

if (problems.length) {
  console.error(`\nMusic test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Music test passed.')
