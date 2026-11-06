#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section for one version (without its heading).
 * Exits non-zero when the section is missing or empty.
 *
 *   node scripts/changelog-section.mjs 2.0.0
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const version = (process.argv[2] || '').replace(/^v/, '')
if (!version) {
  console.error('Usage: node scripts/changelog-section.mjs <version>')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const start = lines.findIndex((l) => new RegExp(`^## \\[${escaped}\\]`).test(l))
if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section`)
  process.exit(1)
}

const body = []
for (const line of lines.slice(start + 1)) {
  if (/^## \[/.test(line) || /^\[[^\]]+\]:\s/.test(line)) break
  body.push(line)
}

const text = body.join('\n').trim()
if (!text) {
  console.error(`CHANGELOG.md section for ${version} is empty`)
  process.exit(1)
}
console.log(text)
