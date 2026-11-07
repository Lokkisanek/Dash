/**
 * Stage 2 tiles against a mock-mode build (see scripts/smoke.mjs): scenes,
 * sensors, binary sensors, generic entities, fans, the long-press light sheet
 * and dash light groups.
 *
 *   node scripts/stage2-tiles.mjs     # BASE_URL defaults to http://localhost:4173
 *   SHOTS=dir node scripts/stage2-tiles.mjs
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

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ', hasTouch: false })
const page = await context.newPage()
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`)
})

const cell = (id, type) => page.locator(`.device-cell[data-entity="${id}"]${type ? `[data-type="${type}"]` : ''}`).first()
const goPage = async (label) => {
  await page.locator('nav.liquid-dock__nav button', { hasText: label }).click()
  await page.waitForTimeout(700)
}
const longPress = async (locator, ms = 650, moveBy = 0) => {
  const box = await locator.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  if (moveBy) await page.mouse.move(x + moveBy, y, { steps: 4 })
  await page.waitForTimeout(ms)
  await page.mouse.up()
  await page.waitForTimeout(250)
}
const sheet = page.locator('[data-light-sheet]')
const sheetControls = () => sheet.locator('[data-ctl]').evaluateAll((els) => els.map((e) => e.dataset.ctl))

try {
  await page.goto(`${BASE_URL}/?lang=cs&safe=59,34`)
  await page.locator('nav.liquid-dock__nav button').first().waitFor({ state: 'visible', timeout: 15_000 })

  // ── long-press light sheet (Obývák) ──────────────────────────────────────
  await longPress(cell('light.obyvak_led_pas'))
  await sheet.waitFor({ state: 'visible', timeout: 3000 })
  const full = await sheetControls()
  console.log('full light sheet:', full.join(', '))
  check(full.join(',') === 'brightness,color_temp,color,effects', `full light controls: ${full}`)
  check(await sheet.getAttribute('role') === 'dialog' && (await sheet.getAttribute('aria-modal')) === 'true', 'sheet is a modal dialog')
  // focus is trapped: 30 tabs later focus is still inside
  for (let i = 0; i < 30; i++) await page.keyboard.press('Tab')
  check(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-light-sheet]'))), 'focus left the sheet')
  await sheet.locator('.chip', { hasText: 'Duha' }).click()
  await sheet.locator('.swatch').nth(7).click()
  await shot(page, 'light-sheet-full')
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden', timeout: 2000 })
  // the tap that ended the long-press did not toggle the light
  const ledOn = await page.evaluate(() => document.querySelector('.device-cell[data-entity="light.obyvak_led_pas"]')?.innerText)
  console.log('LED after sheet:', JSON.stringify(ledOn))

  // brightness-only light: only the brightness slider
  await longPress(cell('light.obyvak_lampa'))
  await sheet.waitFor({ state: 'visible', timeout: 3000 })
  const dim = await sheetControls()
  check(dim.join(',') === 'brightness', `brightness-only controls: ${dim}`)
  await sheet.locator('button.close').click()
  await sheet.waitFor({ state: 'hidden', timeout: 2000 })

  // moving 20 px before 420 ms: no sheet
  await longPress(cell('light.obyvak_led_pas'), 650, 20)
  check(!(await sheet.isVisible()), 'sheet opened although the pointer moved 20 px')

  // a plain tap still toggles and opens nothing
  const before = await cell('light.obyvak_lampa').innerText()
  await cell('light.obyvak_lampa').click()
  await page.waitForTimeout(300)
  check(!(await sheet.isVisible()), 'tap opened the sheet')
  check((await cell('light.obyvak_lampa').innerText()) !== before, 'tap did not toggle the lamp')

  // ── on/off light and HA light group (Chodba) ─────────────────────────────
  await goPage('Chodba')
  check(!(await cell('light.chodba_vstup').evaluate((el) => el.classList.contains('has-sheet'))), 'on/off light offers a long-press sheet')
  await longPress(cell('light.chodba_vstup'))
  check(!(await sheet.isVisible()), 'on/off light opened a sheet')
  check((await cell('light.chodba_skupina').innerText()).includes('Chodba vše'), 'HA light group tile renders')

  // ── dash light group (Ložnice) ───────────────────────────────────────────
  await goPage('Ložnice')
  const group = cell('light_group-5a6b7c8d', 'light_group')
  await group.scrollIntoViewIfNeeded()
  const g0 = await group.innerText()
  await group.click()
  await page.waitForTimeout(400)
  const g1 = await group.innerText()
  console.log('group before/after tap:', JSON.stringify(g0), JSON.stringify(g1))
  check(g0 !== g1, 'group tap changed nothing')
  // set one member warmer than the others, the group shows "Různé"
  await longPress(cell('light.loznice_nocni_leva'))
  await sheet.waitFor({ state: 'visible', timeout: 3000 })
  await sheet.locator('.preset', { hasText: 'Studená' }).click()
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
  await longPress(group)
  await sheet.waitFor({ state: 'visible', timeout: 3000 })
  const groupText = await sheet.innerText()
  check(groupText.includes('3 světla'), 'group sheet names its 3 lights')
  check(groupText.includes('Různé'), 'group sheet shows mixed colour temperature')
  await shot(page, 'light-group-sheet')
  await page.keyboard.press('Escape')

  // fan
  const fan = cell('fan.loznice', 'fan')
  await fan.scrollIntoViewIfNeeded()
  const osc = fan.locator('.fan-osc')
  await osc.click()
  await page.waitForTimeout(200)
  check((await osc.getAttribute('aria-pressed')) === 'true', 'fan oscillate did not switch on')
  await shot(page, 'fan-and-group')

  // ── read-only tiles and scenes (Přehled) ─────────────────────────────────
  await goPage('Přehled')
  const text = async (id, type) => (await cell(id, type).innerText()).replace(/\s+/g, ' ').trim()
  const temp = await text('sensor.obyvak_teplota')
  const door = await text('binary_sensor.vchodove_dvere')
  const motion = await text('binary_sensor.chodba_pohyb')
  const sun = await page.locator('.device-cell[data-entity="sun.sun"]').first().innerText()
  const elev = await page.locator('.device-cell[data-entity="sun.sun"]').nth(1).innerText()
  console.log('sensor:', temp, '| door:', door, '| motion:', motion, '| sun:', sun.replace(/\s+/g, ' '), '| elevation:', elev.replace(/\s+/g, ' '))
  check(temp.includes('22,4') && temp.includes('°C'), `sensor value: ${temp}`)
  check(door.includes('Zavřeno'), `door wording: ${door}`)
  check(motion.includes('Pohyb'), `motion wording: ${motion}`)
  check(sun.includes('Nad obzorem'), `generic entity state: ${sun}`)
  check(elev.includes('18,4'), `generic entity attribute: ${elev}`)
  await cell('scene.vecer').locator('button').click()
  await page.waitForTimeout(150)
  check(await cell('scene.vecer').locator('.is-done').count() === 1, 'scene shows no confirmation')
  check((await cell('scene.vecer').innerText()).includes('Scéna aktivována'), 'scene not announced')
  await shot(page, 'overview-tiles')
  await page.waitForTimeout(1300)
  check(await cell('scene.vecer').locator('.is-done').count() === 0, 'scene confirmation did not go away')

  // ── guest pass: capabilities from the profile ────────────────────────────
  const guest = await context.newPage()
  await guest.goto(`${BASE_URL}/?lang=cs&guest=1`)
  await guest.locator('nav.liquid-dock__nav button').first().waitFor({ state: 'visible', timeout: 15_000 })
  const gcell = guest.locator('.device-cell[data-entity="light.obyvak_led_pas"]')
  const box = await gcell.boundingBox()
  await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await guest.mouse.down()
  await guest.waitForTimeout(650)
  await guest.mouse.up()
  const gsheet = guest.locator('[data-light-sheet]')
  await gsheet.waitFor({ state: 'visible', timeout: 3000 })
  const gctl = await gsheet.locator('[data-ctl]').evaluateAll((els) => els.map((e) => e.dataset.ctl))
  console.log('guest sheet (effects off in the demo profile):', gctl.join(', '))
  check(gctl.join(',') === 'brightness,color_temp,color', `guest controls: ${gctl}`)
  await guest.close()
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`\nStage 2 tile test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Stage 2 tile test passed.')
