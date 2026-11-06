#!/usr/bin/env node
/**
 * Fails when the three version fields disagree:
 *   package.json "version"
 *   custom_components/guest_ha_dashboard/manifest.json "version"
 *   custom_components/guest_ha_dashboard/const.py VERSION
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

const sources = {
  'package.json': JSON.parse(read('package.json')).version,
  'custom_components/guest_ha_dashboard/manifest.json': JSON.parse(
    read('custom_components/guest_ha_dashboard/manifest.json'),
  ).version,
  'custom_components/guest_ha_dashboard/const.py': read(
    'custom_components/guest_ha_dashboard/const.py',
  ).match(/^VERSION\s*=\s*["']([^"']+)["']/m)?.[1],
}

const missing = Object.entries(sources).filter(([, v]) => !v)
if (missing.length) {
  console.error(`Version not found in: ${missing.map(([f]) => f).join(', ')}`)
  process.exit(1)
}

const values = new Set(Object.values(sources))
if (values.size !== 1) {
  console.error('Version mismatch:')
  for (const [file, v] of Object.entries(sources)) console.error(`  ${v.padEnd(12)} ${file}`)
  process.exit(1)
}

console.log(`Versions match: ${[...values][0]}`)
