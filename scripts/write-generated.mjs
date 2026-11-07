import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Write a generated file, keeping the line endings the existing copy has
 * (Windows checkouts use CRLF; the repository stores LF either way).
 */
export function writeGenerated(path, content) {
  const lf = content.replace(/\r\n/g, '\n')
  const crlf = existsSync(path) && readFileSync(path, 'utf8').includes('\r\n')
  writeFileSync(path, crlf ? lf.replace(/\n/g, '\r\n') : lf)
}
