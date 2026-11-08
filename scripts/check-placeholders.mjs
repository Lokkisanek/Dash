#!/usr/bin/env node
/**
 * Fails while owner placeholders are left in tracked files:
 *   CONTACT_EMAIL  the contact address, to be filled in before promotion
 *   TODO(owner)    a decision only the maintainer can make
 * Not part of CI on purpose: run `npm run check:placeholders` before publishing.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const self = 'scripts/check-placeholders.mjs'
// split so this file does not match itself
const MARKERS = ['CONTACT_' + 'EMAIL', 'TODO' + '(owner)']

// tracked files plus new, not yet committed ones (minus .gitignore'd)
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter((f) => f && f !== self)

const hits = []
for (const file of new Set(files)) {
  let text
  try {
    text = readFileSync(resolve(root, file), 'utf8')
  } catch {
    continue // deleted in the working tree
  }
  if (text.includes('\0')) continue // binary
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of MARKERS) if (line.includes(m)) hits.push(`${file}:${i + 1}: ${m}`)
  })
}

if (hits.length) {
  console.error(`Owner placeholders left (${hits.length}):`)
  for (const h of hits) console.error(`  ${h}`)
  process.exit(1)
}
console.log('No owner placeholders left.')
