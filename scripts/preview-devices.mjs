/**
 * The HA panel's live preview with device presets (scripts/panel-harness/,
 * mock dashboard in the iframe): the iframe has the preset's real CSS px size,
 * rotation swaps it, a custom size works and is validated, the choice is
 * remembered, simulated insets reach the page, wide sizes put pages side by
 * side with the editor's tile positions. The preview channel is refused from
 * an untrusted sender and in a top-level page.
 *
 *   node scripts/preview-devices.mjs   # BASE_URL (mock build) defaults to http://localhost:4173
 *   SHOTS=dir node scripts/preview-devices.mjs
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
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'cs-CZ' })
  const page = await context.newPage()
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`))
  await page.goto(`${harness.url}/scripts/panel-harness/?app=${encodeURIComponent(`${BASE_URL}/?lang=cs`)}`)
  const iframe = page.locator('iframe[title="Guest dashboard live preview"]')
  const frame = page.frameLocator('iframe[title="Guest dashboard live preview"]')
  await frame.locator('[data-tile-id="switch.koupelna_boiler"]').first().waitFor({ timeout: 15_000 })
  const size = () => iframe.evaluate((el) => [el.clientWidth, el.clientHeight].join('x'))
  const inner = async (fn) => (await (await iframe.elementHandle()).contentFrame()).evaluate(fn)
  const settle = () => page.waitForTimeout(1200)

  check((await size()) === '393x852', `default iPhone 15 Pro: ${await size()}`)
  const groups = await page.locator('#previewDevice optgroup').evaluateAll((els) => els.map((e) => e.label))
  check(groups.join() === 'Telefony,Tablety,Nástěnné displeje,Vlastní', `device groups: ${groups}`)
  check((await page.locator('#previewDevice option').count()) >= 15, 'fewer than 15 device options')

  // tablet: the iframe has the preset's CSS px size, rotation swaps it
  await page.locator('#previewDevice').selectOption('ipad-pro-11')
  await settle()
  check((await size()) === '834x1194', `iPad Pro 11 portrait: ${await size()}`)
  check((await inner(() => document.querySelector('.dashboard-shell').dataset.layoutMode)) === 'tablet-portrait', 'tablet portrait mode in the frame')
  await page.locator('#rotatePreview').click()
  await settle()
  check((await size()) === '1194x834', `iPad Pro 11 landscape: ${await size()}`)
  const wide = await inner(() => ({
    mode: document.querySelector('.dashboard-shell').dataset.layoutMode,
    n: Number(document.querySelector('.dashboard-shell').dataset.pagesPerView),
    cells: [...document.querySelectorAll('[data-page-id="obyvak"] [data-tile-grid] > .device-cell')].map((e) =>
      [e.dataset.tileId, e.dataset.col, e.dataset.row, e.dataset.w, e.dataset.h].join(':'),
    ),
  }))
  console.log(`iPad Pro 11 landscape: ${wide.mode}, ${wide.n} pages side by side`)
  check(wide.mode === 'tablet-landscape' && wide.n === 2, `landscape tablet: ${wide.mode}, ${wide.n} pages`)
  await page.locator('[data-tab="pages"]').click()
  const editor = await page.locator('#ccGrid .cc-tile').evaluateAll((els) =>
    els.map((e) => [e.dataset.tileId, e.dataset.col, e.dataset.row, e.dataset.w, e.dataset.h].join(':')),
  )
  check(editor.join() === wide.cells.join(), `wide preview cells differ from the editor: ${wide.cells.join(' ')}`)
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'preview-tablet-landscape.png') })

  // custom size 700 × 500 with insets; an invalid size is refused with a message
  await page.locator('#previewDevice').selectOption('custom')
  await page.locator('#rotatePreview').click()
  await settle()
  await page.locator('#customW').fill('700')
  await page.locator('#customW').dispatchEvent('change')
  await page.locator('#customH').fill('500')
  await page.locator('#customH').dispatchEvent('change')
  await settle()
  check((await size()) === '700x500', `custom 700 × 500: ${await size()}`)
  await page.locator('#customW').fill('120')
  await page.locator('#customW').dispatchEvent('change')
  check(await page.locator('#customError').isVisible(), 'no message for a 120 px width')
  check((await size()) === '700x500', 'invalid width was applied')
  await page.locator('#customW').fill('700')
  await page.locator('#customW').dispatchEvent('change')
  await page.locator('#customSafeBox summary').click()
  await page.locator('[data-safe="t"]').fill('30')
  await page.locator('[data-safe="t"]').dispatchEvent('change')
  await settle()
  const top = await inner(() => getComputedStyle(document.documentElement).getPropertyValue('--frame-safe-top').trim())
  check(top === '30px', `custom top inset reached the page as ${top}`)
  await page.locator('#customSwap').click()
  await settle()
  check((await size()) === '500x700', `swap: ${await size()}`)

  // 100 %: real size, the column scrolls; the choice survives a reload
  await page.locator('#previewScale [data-scale="100"]').click()
  check(await page.locator('#previewStage.actual').count() === 1, '100 % mode not applied')
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'preview-custom.png') })
  await page.reload()
  await frame.locator('[data-tile-grid] .device-cell').first().waitFor({ timeout: 15_000 })
  await settle()
  check((await page.locator('#previewDevice').inputValue()) === 'custom', 'device choice not remembered')
  check((await size()) === '500x700', `size after reload: ${await size()}`)
  check(await page.locator('#previewStage.actual').count() === 1, 'scale not remembered')
  await page.locator('#previewScale [data-scale="fit"]').click()
  await page.locator('#previewDevice').selectOption('wall-1024x600')
  await settle()
  check((await size()) === '1024x600', `wall display shown wide: ${await size()}`)
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'preview-wall.png') })
  await context.close()

  // the preview channel: ignored from a parent whose origin is not trusted ...
  const c2 = await browser.newContext()
  const p2 = await c2.newPage()
  await p2.setContent(`<iframe referrerpolicy="no-referrer" src="${BASE_URL}/?lang=cs" style="width:390px;height:700px"></iframe>`)
  const f2 = p2.frameLocator('iframe')
  await f2.locator('[data-tile-grid] .device-cell').first().waitFor({ timeout: 15_000 })
  await p2.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'dash-preview', safe: { t: 77 } }, '*'))
  await p2.waitForTimeout(400)
  const untrusted = await (await p2.locator('iframe').elementHandle()).contentFrame()
  const t2 = await untrusted.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--frame-safe-top').trim())
  check(t2 !== '77px', 'an untrusted parent set the insets')
  // ... and never honoured by a top-level page
  await p2.goto(`${BASE_URL}/?lang=cs`)
  await p2.locator('[data-tile-grid] .device-cell').first().waitFor({ timeout: 15_000 })
  await p2.evaluate(() => window.postMessage({ type: 'dash-preview', safe: { t: 66 } }, '*'))
  await p2.waitForTimeout(300)
  const t3 = await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--frame-safe-top').trim())
  check(t3 !== '66px', 'a top-level page honoured a preview message')
  await c2.close()
} finally {
  await browser.close()
  await harness.close()
}

if (problems.length) {
  console.error(`\nPreview device test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Preview device test passed.')
