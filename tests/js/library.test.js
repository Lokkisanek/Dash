import { describe, it, expect } from 'vitest'
import { statusBadge, viewReleases, formatSize, formatEta, sortActivity } from '../../src/lib/library/releases.js'

const R = [
  { guid: 'a', title: 'Film.2160p.WEB', indexer: 'X', seeders: 10, size: 18e9, customFormatScore: 250, quality: 'WEBDL-2160p', languages: ['Czech'] },
  { guid: 'b', title: 'Film.1080p.BluRay', indexer: 'Y', seeders: 300, size: 9e9, customFormatScore: 120, quality: 'Bluray-1080p', languages: ['English'] },
  { guid: 'c', title: 'Film.720p', indexer: 'Y', seeders: 900, size: 1e9, customFormatScore: -50, rejected: true, rejections: ['x'] },
]

describe('status badges', () => {
  it('maps every status and clamps the percent', () => {
    expect(statusBadge({ status: 'downloading', percent: 133.4 })).toMatchObject({ key: 'libStatus_downloading', percent: 100, tone: 'info' })
    expect(statusBadge({ status: 'available' }).percent).toBeNull()
    expect(statusBadge({ status: 'weird' }).status).toBe('unrequested')
    expect(statusBadge(null).status).toBe('unrequested')
  })
})

describe('release picker', () => {
  it('sorts by seeders, size or score and hides rejected by default', () => {
    expect(viewReleases(R).map((r) => r.guid)).toEqual(['b', 'a'])
    expect(viewReleases(R, { sort: 'size' }).map((r) => r.guid)).toEqual(['a', 'b'])
    expect(viewReleases(R, { sort: 'score' }).map((r) => r.guid)).toEqual(['a', 'b'])
    expect(viewReleases(R, { showRejected: true }).map((r) => r.guid)).toEqual(['c', 'b', 'a'])
  })

  it('filters by title, indexer, quality and language', () => {
    expect(viewReleases(R, { filter: 'czech' }).map((r) => r.guid)).toEqual(['a'])
    expect(viewReleases(R, { filter: 'bluray' }).map((r) => r.guid)).toEqual(['b'])
    expect(viewReleases(R, { filter: 'nothing' })).toEqual([])
    expect(viewReleases(null)).toEqual([])
  })

  it('formats sizes and times', () => {
    expect(formatSize(18e9)).toBe('18 GB')
    expect(formatSize(1.4e9)).toBe('1.4 GB')
    expect(formatSize(0)).toBe('–')
    expect(formatEta(3900)).toBe('1 h 5 min')
    expect(formatEta(8640000)).toBe('')
  })

  it('lists active downloads first', () => {
    expect(sortActivity([{ id: 1, speed: 0, progress: 10 }, { id: 2, speed: 5, progress: 90 }]).map((i) => i.id)).toEqual([2, 1])
  })
})
