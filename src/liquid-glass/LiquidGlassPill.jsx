import { useEffect, useRef } from 'react'
import { mountLiquidGlassPill, PILL_DEFAULTS } from '../lib/liquidGlass.js'

export { PILL_DEFAULTS }

/**
 * Full-bleed WebGL liquid glass pill (archisvaze/liquid-glass shader).
 */
export default function LiquidGlassPill({
  width = PILL_DEFAULTS.width,
  height = PILL_DEFAULTS.height,
  radius = PILL_DEFAULTS.radius,
  bottom = 28,
  mood = 'vivid',
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    let handle
    try {
      handle = mountLiquidGlassPill(wrap, canvas, {
        width,
        height,
        radius,
        bottom,
        mood,
      })
    } catch (err) {
      console.warn('[LiquidGlassPill] WebGL unavailable:', err)
    }

    return () => handle?.destroy()
  }, [width, height, radius, bottom, mood])

  return (
    <div ref={wrapRef} className="liquid-gl-wrap" aria-hidden="true">
      <canvas ref={canvasRef} className="liquid-gl-canvas" />
    </div>
  )
}
