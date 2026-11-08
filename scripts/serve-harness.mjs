/**
 * Static server for scripts/panel-harness/ (browser tests of the HA panel):
 * serves the repository root read-only on 127.0.0.1. Test helper only.
 *
 *   import { serveHarness } from './serve-harness.mjs'
 *   const { url, close } = await serveHarness()   // url = http://127.0.0.1:<port>
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' }

export function serveHarness(port = 0) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path))
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })
    })
  })
}
