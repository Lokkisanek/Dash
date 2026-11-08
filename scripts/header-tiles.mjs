/**
 * Header-family tiles against a mock-mode build (see scripts/smoke.mjs):
 * the demo header tile in every style, light and dark, with readable text.
 *
 *   node scripts/header-tiles.mjs     # BASE_URL defaults to http://localhost:4173
 *   SHOTS=dir node scripts/header-tiles.mjs   # also keep the screenshots
 *
 * `?headerStyle=` (demo builds only) switches the demo header tile's style.
 * Text contrast is measured against the tile surface (card) or the wallpaper's
 * base colour (styles without a surface). Glass is translucent; its text uses
 * the theme colour and is checked against the wallpaper base colour as well.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || ''
const STYLES = ['card', 'plain', 'lockscreen', 'compact', 'glass']
const problems = []

const browser = await chromium.launch()
try {
  for (const theme of ['light', 'dark']) {
    for (const style of STYLES) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
      const page = await context.newPage()
      const label = `${style}/${theme}`
      page.on('pageerror', (err) => problems.push(`[${label}] page error: ${err.message}`))
      page.on('console', (msg) => {
        if (msg.type() === 'error') problems.push(`[${label}] console error: ${msg.text()}`)
      })
      await page.goto(`${BASE_URL}/?lang=cs&theme=${theme}&safe=59,34&headerStyle=${style}`)
      const tile = page.locator(`[data-info="header"][data-variant="${style}"]`)
      await tile.waitFor({ state: 'visible', timeout: 15_000 })
      await page.waitForTimeout(400)

      const info = await tile.evaluate((el) => {
        // rgb()/rgba() in 0–255, or color(srgb r g b / a) in 0–1 (what color-mix() computes to)
        const parse = (c) => {
          const n = (c.match(/[\d.]+/g) || []).map(Number)
          const srgb = c.startsWith('color(')
          const rgb = n.slice(0, 3).map((v) => (srgb ? v * 255 : v))
          return [...rgb, n.length > 3 ? n[3] : 1]
        }
        const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]))
        const lum = ([r, g, b]) => {
          const ch = (v) => {
            const s = v / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
        }
        const ratio = (a, b) => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
          return (hi + 0.05) / (lo + 0.05)
        }
        const surface = getComputedStyle(el).backgroundColor
        const sp = parse(surface)
        const opaque = sp[3] === 1
        const wallpaper = parse(getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim()
          .replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`))
        const back = opaque ? sp : wallpaper
        // visible text only (the Wi-Fi card is a closed <dialog> inside the tile)
        const texts = [...el.querySelectorAll('p, span')].filter(
          (n) => n.childElementCount === 0 && n.textContent.trim() && !n.closest('dialog') && n.checkVisibility(),
        )
        const worst = Math.min(...texts.map((n) => ratio(over(parse(getComputedStyle(n).color), back), back)))
        return { text: el.innerText.replace(/\s+/g, ' ').trim(), worst, opaque, count: texts.length }
      })
      if (!info.count) problems.push(`[${label}] header shows no text`)
      // large text (the time, the temperature) needs 3:1; secondary text uses 58 % ink
      if (info.worst < 3) problems.push(`[${label}] text contrast ${info.worst.toFixed(2)} < 3`)
      const badge = await page.locator('[data-connection-badge]').isVisible()
      if (!badge) problems.push(`[${label}] demo connection badge missing`)
      console.log(`${label}: "${info.text.slice(0, 60)}" contrast ≥ ${info.worst.toFixed(2)}`)
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true })
        await page.screenshot({ path: join(SHOTS, `header-${style}-${theme}.png`) })
      }
      await context.close()
    }
  }

  // Compact: the time always leads (also for a header migrated with showTime off)
  // and a narrow screen cuts the weather, never the time
  for (const [width, query] of [[390, ''], [320, '&headerShowTime=0']]) {
    const context = await browser.newContext({ viewport: { width, height: 700 }, locale: 'cs-CZ' })
    const page = await context.newPage()
    await page.goto(`${BASE_URL}/?lang=cs&safe=59,34&headerStyle=compact${query}`)
    const line = page.locator('[data-info="header"][data-variant="compact"] .compact-line')
    await line.waitFor({ state: 'visible', timeout: 15_000 })
    const r = await line.evaluate((el) => {
      const time = el.querySelector('[data-compact-time]')
      const rest = el.querySelector('.compact-text')
      return {
        text: el.innerText.replace(/\s+/g, ' ').trim(),
        timeWhole: time ? time.scrollWidth <= time.clientWidth + 0.5 : false,
        lineFits: el.scrollWidth <= el.clientWidth + 0.5,
        restCut: rest ? rest.scrollWidth > rest.clientWidth + 0.5 : false,
      }
    })
    console.log(`compact ${width}px${query}: "${r.text}"${r.restCut ? ' (weather cut)' : ''}`)
    if (!/^\d{1,2}:\d{2} · /.test(r.text)) problems.push(`[compact ${width}] line does not start with the time: "${r.text}"`)
    if (!r.timeWhole || !r.lineFits) problems.push(`[compact ${width}] time clipped or line overflows`)
    await context.close()
  }

  // Guest pass: header tile without entity reaches the guest, Wi-Fi button works
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'cs-CZ' })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/?lang=cs&guest=1`)
  await page.locator('[data-info="header"]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[data-info="header"] button[aria-label="Wi-Fi"]').click()
  await page.getByText('Guest-Home').first().waitFor({ state: 'visible', timeout: 5_000 })
  console.log('guest: header tile shown, Wi-Fi card opens')
  await context.close()
} finally {
  await browser.close()
}

if (problems.length) {
  console.error(`\nHeader tile test failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Header tile test passed.')
