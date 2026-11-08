/**
 * Wide and landscape layouts against a mock-mode build (scripts/smoke.mjs):
 * phone landscape with the side dock, tablet portrait, tablet landscape with
 * pages side by side, keyboard paging, the standby clock, no horizontal scroll.
 * Tile positions in every mode equal the phone's (one packing, shared/layout.mjs).
 *
 *   node scripts/wide-layout.mjs     # BASE_URL defaults to http://localhost:4173
 *   SHOTS=dir node scripts/wide-layout.mjs
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
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const cellsOf = (page, pageId) =>
  page.evaluate((id) => {
    const scope = id ? document.querySelector(`[data-page-id="${id}"]`) : document
    return [...(scope?.querySelectorAll('[data-tile-grid] > .device-cell') || [])].map((e) =>
      [e.dataset.tileId, e.dataset.col, e.dataset.row, e.dataset.w, e.dataset.h].join(':'),
    )
  }, pageId)

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

const browser = await chromium.launch()
try {
  // reference: the first page on a phone in portrait
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
  const pp = await phone.newPage()
  await pp.goto(`${BASE_URL}/?lang=cs&safe=59,34`)
  await pp.locator('[data-tile-grid] .device-cell').first().waitFor({ timeout: 15_000 })
  const reference = await cellsOf(pp, null)
  const firstPageId = await pp.evaluate(() => document.querySelector('.liquid-dock__tab[aria-current="page"]')?.getAttribute('aria-label'))
  check(
    (await pp.locator('.dashboard-shell').getAttribute('data-layout-mode')) === 'phone-portrait',
    'phone portrait not detected',
  )
  await phone.close()

  const cases = [
    { name: 'phone-landscape', w: 844, h: 390, safe: '0,59,21,59', mode: 'phone-landscape', side: 'right', n: 1 },
    { name: 'tablet-portrait', w: 820, h: 1180, safe: '24,0,20,0', mode: 'tablet-portrait', side: 'bottom', n: 1 },
    { name: 'tablet-landscape', w: 1280, h: 800, safe: '24,0,20,0', mode: 'tablet-landscape', side: 'bottom', n: 3 },
  ]
  for (const theme of ['light', 'dark']) {
    for (const c of cases) {
      const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, locale: 'cs-CZ' })
      const page = await ctx.newPage()
      page.on('pageerror', (err) => problems.push(`[${c.name}] page error: ${err.message}`))
      await page.goto(`${BASE_URL}/?lang=cs&theme=${theme}&safe=${c.safe}`)
      await page.locator('[data-tile-grid] .device-cell').first().waitFor({ timeout: 15_000 })
      await page.waitForTimeout(400)
      const shell = page.locator('.dashboard-shell')
      const mode = await shell.getAttribute('data-layout-mode')
      const side = await shell.getAttribute('data-dock-side')
      const n = Number(await shell.getAttribute('data-pages-per-view'))
      if (theme === 'light') console.log(`${c.name}: mode ${mode}, dock ${side}, ${n} page(s) side by side`)
      check(mode === c.mode, `[${c.name}] mode ${mode}`)
      check(side === c.side, `[${c.name}] dock side ${side}`)
      check(n === c.n, `[${c.name}] ${n} pages per view, expected ${c.n}`)

      const geo = await page.evaluate(() => {
        const dock = document.querySelector('.liquid-dock__glass').getBoundingClientRect()
        const cells = [...document.querySelectorAll('.page.is-visible .device-cell, .page:not(.wide-page) .device-cell')]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.bottom > 0 && r.top < innerHeight && r.width > 0)
        const probe = document.createElement('div')
        probe.style.cssText = 'position:fixed;padding-right:var(--safe-right)'
        document.body.append(probe)
        const safeRight = parseFloat(getComputedStyle(probe).paddingRight) || 0
        probe.remove()
        return {
          dock: { left: dock.left, right: dock.right, top: dock.top, bottom: dock.bottom },
          cells: cells.map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
          safeRight,
          hScroll: document.scrollingElement.scrollWidth > innerWidth + 1,
          vw: innerWidth,
        }
      })
      check(!geo.hScroll, `[${c.name}] horizontal page scroll`)
      if (c.side === 'right') {
        const gap = geo.vw - geo.safeRight - geo.dock.right
        check(gap >= 8 && gap <= 24, `[${c.name}] side dock ${gap.toFixed(1)} px from the safe edge (8–24 expected)`)
      }
      const hit = geo.cells.filter((r) => overlaps(r, geo.dock))
      // a bottom dock floats over the scrolling page by design; a side dock never covers tiles
      if (c.side !== 'bottom') check(hit.length === 0, `[${c.name}] ${hit.length} tile(s) under the side dock`)

      // same packing in every mode
      const first = await page.evaluate(() => document.querySelector('[data-page-id]')?.dataset.pageId || '')
      const cells = await cellsOf(page, n > 1 ? first : null)
      check(cells.join() === reference.join(), `[${c.name}] first page cells differ from the phone: ${cells.slice(0, 4).join(' ')}…`)

      if (n > 1) {
        // keyboard paging moves the view by one page; the dock marks every visible page
        const range = () => page.locator('[data-page-range]').innerText()
        const before = await range()
        const active = await page.locator('.liquid-dock__tab.is-active').count()
        check(active === n, `[${c.name}] dock marks ${active} pages, ${n} visible`)
        await page.keyboard.press('ArrowRight')
        await page.waitForTimeout(600)
        const after = await range()
        if (theme === 'light') console.log(`${c.name}: ArrowRight ${before.trim()} -> ${after.trim()}`)
        check(before !== after && after.trim().startsWith('2'), `[${c.name}] ArrowRight did not move by one page (${before} -> ${after})`)
        await page.keyboard.press('ArrowLeft')
        await page.waitForTimeout(600)
        check((await range()) === before, `[${c.name}] ArrowLeft did not move back`)
      }
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${c.name}-${theme}.png`) })

      // standby clock fits the screen
      await page.goto(`${BASE_URL}/?lang=cs&theme=${theme}&safe=${c.safe}&standby=1`)
      await page.locator('.standby .digits').waitFor({ timeout: 10_000 })
      await page.waitForTimeout(400)
      const fits = await page.evaluate(() => {
        const r = document.querySelector('.standby .digits').getBoundingClientRect()
        return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 100
      })
      check(fits, `[${c.name}] standby clock does not fit`)
      if (SHOTS && theme === 'dark') await page.screenshot({ path: join(SHOTS, `${c.name}-standby.png`) })
      await ctx.close()
    }
  }
  console.log(`reference first page (${firstPageId}): ${reference.length} tiles`)
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`\nWide layout test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Wide layout test passed.')
