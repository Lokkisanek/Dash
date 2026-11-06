#!/usr/bin/env node
/**
 * Renders the integration brand icons from public/favicon.svg.
 * Home Assistant (2026.3+) and HACS read them from
 * custom_components/guest_ha_dashboard/brand/.
 *
 *   npm run brand
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')
const outDir = join(root, 'custom_components/guest_ha_dashboard/brand')
mkdirSync(outDir, { recursive: true })

// icon.png 256x256 and icon@2x.png 512x512, transparent outside the rounded square
const targets = [
  ['icon.png', 256],
  ['icon@2x.png', 512],
]

const browser = await chromium.launch()
try {
  for (const [file, size] of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `) +
        `</body></html>`,
    )
    await page.screenshot({ path: join(outDir, file), omitBackground: true })
    await page.close()
    console.log(`brand/${file} (${size}x${size})`)
  }
} finally {
  await browser.close()
}
