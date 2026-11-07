#!/usr/bin/env node
/**
 * Fails when a generated file differs from what its generator produces now,
 * e.g. shared/tiles.json was edited without running `npm run gen:tiles`.
 * Generators render into memory; nothing in the working tree is written.
 * Line endings are ignored (Windows checkouts use CRLF).
 *
 *   node scripts/check-generated.mjs   (npm run check:generated)
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { generateTiles } from './gen-tiles.mjs'
import { generateIcons } from './gen-icons.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lf = (s) => s.replace(/\r\n/g, '\n')

const generators = [
  ['gen:tiles', generateTiles],
  ['gen:icons', generateIcons],
]

const stale = []
let count = 0
for (const [script, generate] of generators) {
  for (const [rel, content] of Object.entries(generate())) {
    count += 1
    const path = join(root, rel)
    const current = existsSync(path) ? lf(readFileSync(path, 'utf8')) : null
    if (current !== lf(content)) stale.push(`${rel} (run npm run ${script})`)
  }
}

if (stale.length) {
  console.error(`Generated files are out of date:\n  ${stale.join('\n  ')}`)
  process.exit(1)
}
console.log(`Generated files are up to date (${count} files).`)
