import { describe, it, expect } from 'vitest'
import { classifyViewport, dockSideFor, pagesPerViewFor, SIDE_DOCK_SPACE } from '../../src/lib/layoutMode.js'

describe('layout mode', () => {
  it('classifies phones, tablets and desktops by the short side', () => {
    expect(classifyViewport(390, 844)).toBe('phone-portrait')
    expect(classifyViewport(844, 390)).toBe('phone-landscape')
    expect(classifyViewport(820, 1180)).toBe('tablet-portrait')
    expect(classifyViewport(1280, 800)).toBe('tablet-landscape')
    expect(classifyViewport(1920, 1080)).toBe('desktop')
    expect(classifyViewport(1024, 600)).toBe('tablet-landscape')
  })

  it('puts the dock on the right for a phone in landscape unless set', () => {
    expect(dockSideFor('phone-landscape', 'auto')).toBe('right')
    expect(dockSideFor('tablet-landscape', 'auto')).toBe('bottom')
    expect(dockSideFor('phone-landscape', 'bottom')).toBe('bottom')
    expect(dockSideFor('phone-portrait', 'left')).toBe('left')
    expect(dockSideFor('desktop', 'nonsense')).toBe('bottom')
  })

  it('shows floor(width / 420) pages, 1 to 4, never more than there are', () => {
    expect(pagesPerViewFor(374, 'auto')).toBe(1)
    expect(pagesPerViewFor(1264, 'auto')).toBe(3)
    expect(pagesPerViewFor(1904, 'auto')).toBe(4)
    expect(pagesPerViewFor(5000, 'auto')).toBe(4)
    expect(pagesPerViewFor(1264, 'single')).toBe(1)
    expect(pagesPerViewFor(1264, 'auto', 2)).toBe(2)
    expect(pagesPerViewFor(844 - 118 - SIDE_DOCK_SPACE - 16, 'auto')).toBe(1)
  })
})
