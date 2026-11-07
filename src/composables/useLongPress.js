/**
 * Long-press on a tile, agreed with page swiping and scrolling:
 *   - fires after `delay` ms (420) of a still pointer
 *   - cancelled when the pointer moves more than `slop` px (8; the pager starts
 *     a horizontal swipe at 10 px, vertical scrolling at 10 px), on
 *     pointercancel, and on any scroll (capture listener on window)
 *   - right-click (contextmenu) and Shift+Enter open at once
 *   - the tap that ends a long-press does not reach the tile: the wrapper eats
 *     the following click, and tiles that act on pointerup ask `consume()`
 * `armed()` lets the caller switch it off (lights that only do on/off).
 */
export function useLongPress(open, { delay = 420, slop = 8, armed = () => true } = {}) {
  let timer = null
  let start = null
  let fired = false

  function stopWatching() {
    clearTimeout(timer)
    timer = null
    start = null
    window.removeEventListener('scroll', cancel, true)
  }

  function cancel() {
    stopWatching()
  }

  function onPointerDown(e) {
    fired = false
    if (!armed()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    start = { x: e.clientX, y: e.clientY }
    clearTimeout(timer)
    timer = setTimeout(() => {
      stopWatching()
      fired = true
      navigator.vibrate?.(8)
      open()
    }, delay)
    window.addEventListener('scroll', cancel, true)
  }

  function onPointerMove(e) {
    if (!start) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > slop) cancel()
  }

  function onContextMenu(e) {
    if (!armed()) return
    e.preventDefault()
    stopWatching()
    if (!fired) {
      fired = true
      open()
    }
  }

  function onClickCapture(e) {
    if (!fired) return
    fired = false
    e.stopPropagation()
    e.preventDefault()
  }

  function onKeydown(e) {
    if (!armed() || e.key !== 'Enter' || !e.shiftKey) return
    e.preventDefault()
    open()
  }

  return {
    /** True once after a long-press: the tile must not toggle on this pointerup. */
    consume: () => fired,
    isFired: () => fired,
    handlers: {
      onPointerdown: onPointerDown,
      onPointermove: onPointerMove,
      onPointerup: cancel,
      onPointercancel: cancel,
      onContextmenu: onContextMenu,
      onClickCapture,
      onKeydown,
    },
  }
}
