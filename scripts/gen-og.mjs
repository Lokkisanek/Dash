#!/usr/bin/env node
/**
 * Share images, rendered from an inline HTML template with Chromium:
 *
 *   npm run og
 *
 *   public/og.png                 1200x630  Open Graph / Twitter card (served at /og.png)
 *   docs/img/social-preview.png   1280x640  GitHub Settings -> Social preview (uploaded by hand)
 *
 * Flat background: the dark tile of public/favicon.svg (#0a0a0f); wordmark
 * with the favicon itself; two existing demo screenshots from docs/img
 * (home-light.png, home-dark.png; `npm run screenshots` rebuilds them).
 * System fonts only, so the output does not depend on a web font download.
 */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_BYTES = 500 * 1024

const TAGLINE = 'An iOS-style wall and guest dashboard for Home Assistant, installable as a web app.'
const BG = '#0a0a0f' // public/favicon.svg background
const ACCENT = '#fbbf24' // public/favicon.svg stroke

const dataUrl = (file, type) => `data:${type};base64,${readFileSync(join(root, file)).toString('base64')}`
const favicon = dataUrl('public/favicon.svg', 'image/svg+xml')
const light = dataUrl('docs/img/home-light.png', 'image/png')
const dark = dataUrl('docs/img/home-dark.png', 'image/png')

const TARGETS = [
  { file: 'public/og.png', width: 1200, height: 630 },
  { file: 'docs/img/social-preview.png', width: 1280, height: 640 },
]

function template({ width, height }) {
  const phoneH = Math.round(height * 0.86)
  const phoneW = Math.round(phoneH * (780 / 1688))
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${width}px; height: ${height}px; background: ${BG}; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #ffffff;
    display: flex; align-items: center;
    padding: 0 ${Math.round(width * 0.06)}px;
  }
  .text { flex: 1; min-width: 0; padding-right: 32px; }
  .mark { display: flex; align-items: center; gap: 24px; }
  .mark img { width: 104px; height: 104px; }
  .mark span { font-size: 112px; font-weight: 800; letter-spacing: -4px; line-height: 1; }
  .tagline { margin-top: 36px; font-size: 38px; line-height: 1.25; font-weight: 600; color: #e5e5ea; max-width: 560px; }
  .meta { margin-top: 32px; font-size: 24px; color: ${ACCENT}; font-weight: 600; letter-spacing: 0.5px; }
  .phones { position: relative; width: ${Math.round(phoneW * 1.62)}px; height: ${phoneH}px; flex: none; }
  .phone {
    position: absolute; top: 0; width: ${phoneW}px; height: ${phoneH}px;
    border-radius: ${Math.round(phoneW * 0.13)}px; border: 6px solid #2c2c30;
    background: #000; overflow: hidden;
  }
  .phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .phone.back { left: 0; top: ${Math.round(phoneH * 0.06)}px; height: ${Math.round(phoneH * 0.94)}px; }
  .phone.front { right: 0; }
</style></head>
<body>
  <div class="text">
    <div class="mark"><img src="${favicon}" alt=""><span>dash</span></div>
    <p class="tagline">${TAGLINE}</p>
    <p class="meta">Open source · AGPL-3.0 · HACS</p>
  </div>
  <div class="phones">
    <div class="phone back"><img src="${dark}" alt=""></div>
    <div class="phone front"><img src="${light}" alt=""></div>
  </div>
</body></html>`
}

const browser = await chromium.launch()
try {
  for (const t of TARGETS) {
    const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 })
    await page.setContent(template(t), { waitUntil: 'load' })
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
    const out = join(root, t.file)
    await page.screenshot({ path: out, type: 'png' })
    await page.close()
    const size = statSync(out).size
    console.log(`${t.file}  ${t.width}x${t.height}  ${Math.round(size / 1024)} KB`)
    if (size > MAX_BYTES) {
      console.error(`${t.file} is over ${MAX_BYTES / 1024} KB; switch both images to JPEG (quality 88) and update the meta tags.`)
      process.exitCode = 1
    }
  }
} finally {
  await browser.close()
}
