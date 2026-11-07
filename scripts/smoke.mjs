#!/usr/bin/env node
/**
 * Smoke test for a mock-mode build served by `vite preview`.
 *
 *   VITE_MODE=mock npm run build
 *   npx vite preview --port 4173 --strictPort &
 *   node scripts/smoke.mjs            # BASE_URL defaults to http://localhost:4173
 *
 * Checks: the dock renders, StandBy renders with ?standby=1, no console errors,
 * no uncaught page errors and no failed same-origin requests.
 */
import { chromium } from 'playwright'

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const origin = new URL(BASE_URL).origin
const problems = []

async function waitForServer(url, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Server not reachable at ${url}`)
}

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${label}] console error: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`[${label}] page error: ${err.message}`))
  page.on('requestfailed', (req) => {
    if (new URL(req.url()).origin === origin) {
      problems.push(`[${label}] request failed: ${req.url()} (${req.failure()?.errorText})`)
    }
  })
  page.on('response', (res) => {
    if (new URL(res.url()).origin === origin && res.status() >= 400) {
      problems.push(`[${label}] HTTP ${res.status()}: ${res.url()}`)
    }
  })
}

await waitForServer(BASE_URL)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })

try {
  const page = await context.newPage()
  watch(page, 'home')
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  await page.locator('nav.liquid-dock__nav button').first().waitFor({ state: 'visible', timeout: 15_000 })
  const dockButtons = await page.locator('nav.liquid-dock__nav button').count()
  if (dockButtons < 1) problems.push('[home] dock has no buttons')
  console.log(`home: dock rendered with ${dockButtons} button(s)`)

  const standby = await context.newPage()
  watch(standby, 'standby')
  await standby.goto(`${BASE_URL}/?standby=1`, { waitUntil: 'networkidle' })
  await standby.locator('.standby').waitFor({ state: 'visible', timeout: 15_000 })
  console.log('standby: StandBy screen rendered')

  // Guest pass (mock): restricted profile, refused value snaps back
  const guest = await context.newPage()
  watch(guest, 'guest')
  await guest.goto(`${BASE_URL}/?guest=1`, { waitUntil: 'networkidle' })
  const dock = guest.locator('nav.liquid-dock__nav button')
  await dock.first().waitFor({ state: 'visible', timeout: 15_000 })
  const labels = await dock.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  // Ložnice has nothing in the profile; Chodba keeps only the coffee machine
  if (labels.join('|') !== 'Obývák|Koupelna|Chodba') problems.push(`[guest] dock shows ${labels.join(', ')}`)
  if (await guest.getByText('TV', { exact: true }).count()) problems.push('[guest] TV tile is outside the profile but rendered')
  const dial = guest.locator('svg.dial-svg').first()
  await dial.scrollIntoViewIfNeeded()
  const before = await dial.getAttribute('aria-valuenow')
  const box = await dial.boundingBox()
  await guest.mouse.click(box.x + box.width - 4, box.y + box.height - 4) // far end = 30 °C, limit is 25
  await guest.locator('[data-testid="guest-toast"]').waitFor({ state: 'visible', timeout: 5_000 })
  await guest.waitForFunction(
    ([sel, value]) => document.querySelector(sel)?.getAttribute('aria-valuenow') === value,
    ['svg.dial-svg', before],
    { timeout: 5_000 },
  )
  console.log(`guest: dock ${labels.join(', ')}; 30 °C refused, dial back at ${before}`)

  // Pairing screen from a QR link: code read from the fragment, then removed
  const pair = await context.newPage()
  watch(pair, 'pairing')
  await pair.goto(`${BASE_URL}/#pair=ABCD-EFGH-JKMN`, { waitUntil: 'networkidle' })
  const shown = await pair.locator('[data-testid="pair-code"]').textContent({ timeout: 15_000 })
  if (shown?.trim() !== 'ABCD-EFGH-JKMN') problems.push(`[pairing] code shown as ${shown}`)
  if (pair.url().includes('pair=')) problems.push('[pairing] code left in the address bar')
  await pair.getByRole('button', { name: /prohlížeči|browser/i }).click()
  await pair.locator('nav.liquid-dock__nav button').first().waitFor({ state: 'visible', timeout: 15_000 })
  console.log('pairing: code taken from fragment, removed from URL, demo pass opened')

  // Ended pass
  const ended = await context.newPage()
  watch(ended, 'ended')
  await ended.goto(`${BASE_URL}/?guest=ended`, { waitUntil: 'networkidle' })
  await ended.locator('[data-testid="guest-status-text"]').waitFor({ state: 'visible', timeout: 15_000 })
  console.log('ended: pass-ended message rendered')
} catch (err) {
  problems.push(`assertion failed: ${err.message}`)
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`Smoke test failed:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('Smoke test passed.')
