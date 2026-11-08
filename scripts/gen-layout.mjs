/**
 * Copies the shared tile layout (shared/layout.mjs) into the HA panel as
 * www/layout.js, so the editor packs tiles with exactly the same code as the
 * guest app (which imports shared/layout.mjs directly).
 *
 *   node scripts/gen-layout.mjs        (npm run gen:layout)
 *
 * scripts/check-generated.mjs imports generateLayout() and compares the output
 * with the committed file.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { writeGenerated } from './write-generated.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const LAYOUT_SOURCE = 'shared/layout.mjs'
export const LAYOUT_OUTPUT = 'custom_components/guest_ha_dashboard/www/layout.js'

export function generateLayout() {
  const source = readFileSync(join(root, LAYOUT_SOURCE), 'utf8').replace(/\r\n/g, '\n')
  const header = `// Generated from ${LAYOUT_SOURCE} by scripts/gen-layout.mjs. Do not edit.\n`
  return { [LAYOUT_OUTPUT]: header + source }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  for (const [rel, content] of Object.entries(generateLayout())) {
    writeGenerated(join(root, rel), content)
    console.log(`wrote ${rel}`)
  }
}
