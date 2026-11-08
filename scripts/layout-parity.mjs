/**
 * Layout parity: the HA panel editor and the dashboard in its live preview
 * place the same tiles on the same cells (shared/layout.mjs). Runs the panel
 * in scripts/panel-harness/ with a mock-mode dashboard (scripts/smoke.mjs
 * explains the mock build) in the preview iframe.
 *
 *   node scripts/layout-parity.mjs     # BASE_URL (mock dashboard) defaults to http://localhost:4173
 *   SHOTS=dir node scripts/layout-parity.mjs
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

const readCells = (locator) =>
  locator.evaluateAll((els) => els.map((e) => [e.dataset.tileId, +e.dataset.col, +e.dataset.row, +e.dataset.w, +e.dataset.h].join(':')))

const harness = await serveHarness()
const browser = await chromium.launch()
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'cs-CZ' })
    const page = await context.newPage()
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`))
    await page.goto(`${harness.url}/scripts/panel-harness/?theme=${theme}&app=${encodeURIComponent(`${BASE_URL}/?lang=cs&theme=${theme}`)}`)
    await page.locator('[data-tab="pages"]').click()
    const editor = page.locator('#ccGrid .cc-tile')
    await editor.first().waitFor()
    const preview = page.frameLocator('iframe[title="Guest dashboard live preview"]')
    const app = preview.locator('[data-tile-grid] .device-cell')
    await app.first().waitFor({ timeout: 15_000 })

    const same = async (label) => {
      // the preview follows the draft within a frame or two
      let a = []
      let b = []
      for (let i = 0; i < 20; i += 1) {
        a = await readCells(editor)
        b = await readCells(app)
        if (a.join() === b.join()) break
        await page.waitForTimeout(100)
      }
      check(a.length > 0 && a.join() === b.join(), `${theme} ${label}: editor ${a.join(' ')} != app ${b.join(' ')}`)
      return a
    }

    const initial = await same('initial')
    if (theme === 'light') console.log('cells:', initial.join(' '))
    // the fixture from tests/js/layout.test.js: scenes stay in their section
    check(
      initial.slice(0, 5).join(' ') === '#0:1:1:4:1 scene.vecer:1:2:1:1 scene.kino:2:2:1:1 scene.film:3:2:1:1 switch.obyvak_tv:4:2:1:1',
      `${theme}: first section ${initial.slice(0, 5).join(' ')}`,
    )
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: join(SHOTS, `parity-${theme}.png`) })
    }

    // drag the 1x1 boiler switch (row 4, col 4) onto row 2, col 1
    const boiler = page.locator('#ccGrid .cc-tile[data-tile-id="switch.koupelna_boiler"]')
    const target = page.locator('#ccGrid .cc-tile[data-tile-id="scene.vecer"]')
    const from = await boiler.boundingBox()
    const to = await target.boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    const steps = 12
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(
        from.x + from.width / 2 + ((to.x - from.x) * i) / steps,
        from.y + from.height / 2 + ((to.y - from.y) * i) / steps,
      )
      await page.waitForTimeout(30)
    }
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(500)
    const moved = await same('after drag')
    check(moved.includes('switch.koupelna_boiler:1:2:1:1'), `${theme}: dragged tile not on row 2, col 1: ${moved.join(' ')}`)

    if (theme === 'light') {
      // tiles without an entity are named by their type, never by an id
      await page.locator('#pagePills [data-page="1"]').click()
      await page.locator('#ccGrid .cc-tile').first().waitFor()
      const RAW_ID = /^[a-z_]+-[0-9a-f]{8}$/
      const names = await page.locator('#ccGrid .cc-tile').evaluateAll((els) =>
        els.flatMap((e) => [e.getAttribute('title'), ...[...e.querySelectorAll('.cc-lbl, input')].map((x) => x.value ?? x.textContent)]).filter(Boolean),
      )
      for (const tile of await page.locator('#ccGrid .cc-tile').all()) {
        await tile.click()
        names.push(await page.locator('.inspector-head strong').innerText())
      }
      console.log('entity-less names:', [...new Set(names)].join(', '))
      check(names.length >= 7 && !names.some((n) => RAW_ID.test(n.trim())), `raw id shown as a tile name: ${names.join(', ')}`)
      await page.locator('#pagePills [data-page="0"]').click()
      await editor.first().waitFor()

      // saved order survives a reload
      await page.locator('#save').click()
      await page.waitForTimeout(300)
      await page.reload()
      await page.locator('[data-tab="pages"]').click()
      await editor.first().waitFor()
      const reloaded = await readCells(editor)
      check(reloaded.join() === moved.join(), `order did not persist: ${reloaded.join(' ')}`)
      await same('after reload')
    }
    await context.close()
  }
} finally {
  await browser.close()
  await harness.close()
}

if (problems.length) {
  console.error(`\nLayout parity test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Layout parity test passed.')
