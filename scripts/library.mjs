/**
 * Videotéka against a mock-mode build (scripts/smoke.mjs): discover → detail →
 * release picker → grab → activity progress (owner); a guest request; the
 * owner's inbox (a seeded guest request), approve, badge count. The demo
 * catalogue is generated in the page: no TMDB, Arr or CDN is contacted.
 *
 *   node scripts/library.mjs     # BASE_URL defaults to http://localhost:4173
 *   SHOTS=dir node scripts/library.mjs
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
const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) })

const browser = await chromium.launch()
try {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
    const page = await ctx.newPage()
    const outside = []
    page.on('request', (r) => !r.url().startsWith(BASE_URL) && !r.url().startsWith('data:') && outside.push(r.url()))
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`))
    await page.goto(`${BASE_URL}/?lang=cs&theme=${theme}&safe=59,34`)
    await page.locator('nav.liquid-dock__nav button', { hasText: 'Přehled' }).click()
    const tile = page.locator('[data-library-tile="trending"]')
    await tile.scrollIntoViewIfNeeded()
    await tile.locator('.lib-poster-btn').first().click()
    const sheet = page.locator('[data-library-sheet]')
    await sheet.waitFor({ state: 'visible', timeout: 3000 })
    const tabs = await sheet.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab))
    check(tabs.join() === 'discover,search,activity,requests', `owner tabs: ${tabs}`)
    await sheet.locator('[data-lib-detail]').waitFor()
    check((await sheet.locator('[data-lib-status]').innerText()).includes('Nevyžádáno'), 'first title should be unrequested')
    check((await sheet.locator('[data-tmdb-notice]').innerText()).includes('not endorsed or certified by TMDB'), 'TMDB notice missing')
    if (theme === 'light') await shot(page, 'library-detail')

    // pick a release: sorted by seeders, rejected hidden, filter works
    await sheet.locator('[data-lib-pick]').click()
    await sheet.locator('[data-lib-release]').first().waitFor()
    const titles = () => sheet.locator('[data-lib-release] .ls-rel-title').allInnerTexts()
    const bySeeders = await titles()
    check(bySeeders.length === 2 && bySeeders[0].includes('1080p'), `default sort/hidden rejected: ${bySeeders}`)
    await sheet.locator('[data-lib-sort]').selectOption('size')
    check((await titles())[0].includes('2160p'), 'sort by size')
    await sheet.locator('[data-lib-filter]').fill('bluray')
    check((await titles()).length === 1, 'filter')
    await sheet.locator('[data-lib-filter]').fill('')
    if (theme === 'light') await shot(page, 'library-picker')
    await sheet.locator('[data-lib-grab]').first().click()
    await sheet.locator('[data-lib-notice]').waitFor()
    check((await sheet.locator('[data-lib-status]').innerText()).includes('Stahuje se'), 'grabbed title should be downloading')

    // activity: progress moves
    await sheet.locator('[data-tab="activity"]').click()
    const first = sheet.locator('[data-lib-act] [data-lib-progress]').first()
    await first.waitFor()
    const p1 = parseInt(await first.innerText(), 10)
    await page.waitForTimeout(2200)
    const p2 = parseInt(await first.innerText(), 10)
    check(p2 > p1, `activity progress did not move (${p1} -> ${p2})`)
    if (theme === 'light') await shot(page, 'library-activity')
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
    check(outside.length === 0, `requests outside the app: ${outside.join(', ')}`)
    await ctx.close()
  }

  // owner inbox: a guest asked (seeded), the badge counts it, approve clears it
  const oc = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
  const owner = await oc.newPage()
  await owner.goto(`${BASE_URL}/?lang=cs&mockRequest=1`)
  await owner.locator('nav.liquid-dock__nav button', { hasText: 'Přehled' }).click()
  const badge = owner.locator('[data-library-tile="trending"] [data-lib-pending]')
  await badge.waitFor({ timeout: 5000 })
  check((await badge.innerText()) === '1', 'pending badge should be 1')
  await owner.locator('[data-library-tile="trending"] .lib-title').click()
  const sheet = owner.locator('[data-library-sheet]')
  await sheet.locator('[data-lib-req]').first().waitFor()
  check((await sheet.locator('[data-lib-req]').first().innerText()).includes('Pokoj 3'), 'request without requester')
  await shot(owner, 'library-requests')
  await sheet.locator('[data-lib-approve]').click()
  await owner.waitForTimeout(300)
  check((await sheet.locator('[data-lib-req]').first().innerText()).includes('schváleno'), 'request not approved')
  await owner.keyboard.press('Escape')
  await owner.waitForTimeout(300)
  check((await badge.count()) === 0, 'badge still shown after approving the only request')
  await oc.close()

  // guest: browse and request, no picker, no downloads tab, no inbox controls
  const gc = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
  const g = await gc.newPage()
  await g.goto(`${BASE_URL}/?lang=cs&guest=1`)
  await g.locator('nav.liquid-dock__nav button').first().waitFor({ timeout: 15_000 })
  const navs = await g.locator('nav.liquid-dock__nav button').allInnerTexts()
  const overview = navs.find((n) => n.includes('Přehled'))
  check(Boolean(overview), `guest has no Přehled page: ${navs}`)
  if (overview) {
    await g.locator('nav.liquid-dock__nav button', { hasText: 'Přehled' }).click()
    check((await g.locator('[data-library-tile="activity"]').count()) === 0, 'guest sees the activity tile')
    const gt = g.locator('[data-library-tile="trending"]')
    await gt.scrollIntoViewIfNeeded()
    await gt.locator('.lib-poster-btn').first().click()
    const gs = g.locator('[data-library-sheet]')
    await gs.locator('[data-lib-detail]').waitFor()
    const gtabs = await gs.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab))
    check(gtabs.join() === 'discover,search,requests', `guest tabs: ${gtabs}`)
    check((await gs.locator('[data-lib-pick]').count()) === 0, 'guest can open the release picker')
    await gs.locator('[data-lib-request]').click()
    await gs.locator('[data-lib-notice]').waitFor()
    check((await gs.locator('[data-lib-notice]').innerText()).includes('Žádost odeslána'), 'guest request notice')
    await gs.locator('[data-tab="requests"]').click()
    await gs.locator('[data-lib-req]').first().waitFor()
    check((await gs.locator('[data-lib-approve]').count()) === 0, 'guest sees approve buttons')
    await shot(g, 'library-guest')
  }
  await gc.close()

  // the panel's Videotéka tab: four services, secrets only as password fields, attribution
  const harness = await serveHarness()
  try {
    const pc = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'cs-CZ' })
    const panel = await pc.newPage()
    panel.on('pageerror', (err) => problems.push(`panel error: ${err.message}`))
    await panel.goto(`${harness.url}/scripts/panel-harness/?app=${encodeURIComponent(`${BASE_URL}/?lang=cs`)}`)
    await panel.locator('[data-tab="library"]').click()
    await panel.locator('[data-lib-svc]').first().waitFor()
    const services = await panel.locator('[data-lib-svc]').evaluateAll((els) => els.map((e) => e.dataset.libSvc))
    check(services.join() === 'tmdb,radarr,sonarr,qbittorrent', `services: ${services}`)
    const secretTypes = await panel.locator('[data-lib-field="api_key"], [data-lib-field="password"]').evaluateAll((els) => els.map((e) => e.type))
    check(secretTypes.length === 4 && secretTypes.every((t) => t === 'password'), `secret fields: ${secretTypes}`)
    // qBittorrent: API key by default, username + password on request
    const qb = panel.locator('[data-lib-svc="qbittorrent"]')
    const qbFields = async () => qb.locator('[data-lib-field]').evaluateAll((els) => els.map((e) => `${e.dataset.libField}:${e.type}`))
    check((await qbFields()).join() === 'url:text,api_key:password', `qBittorrent key fields: ${await qbFields()}`)
    await qb.locator('[data-lib-field="url"]').fill('http://10.0.0.5:8080')
    await qb.locator('[data-lib-qbit-auth="password"]').click()
    check((await qbFields()).join() === 'url:text,username:text,password:password', `qBittorrent password fields: ${await qbFields()}`)
    check((await qb.locator('[data-lib-field="url"]').inputValue()) === 'http://10.0.0.5:8080', 'address lost on mode switch')
    await qb.locator('[data-lib-qbit-auth="api_key"]').click()
    check((await qb.locator('[data-lib-qbit-hint]').innerText()).includes('5.2'), 'no qBittorrent 5.2 hint')
    check((await panel.locator('[data-tmdb-attribution]').innerText()).includes('not endorsed or certified by TMDB'), 'no TMDB attribution in the panel')
    check(!(await panel.locator('[data-lib-enable]').isChecked()), 'Videotéka on by default')
    await shot(panel, 'panel-library')
    await pc.close()
  } finally {
    await harness.close()
  }
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`\nLibrary test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Library test passed.')
