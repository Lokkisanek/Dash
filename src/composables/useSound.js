/**
 * iOS-friendly tactile feedback via Web Audio API.
 * Synthesizes a short low-frequency pop/tick — no external audio files.
 */

let audioCtx = null
let unlocked = false

function getCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    audioCtx = new Ctx()
  }
  return audioCtx
}

/** Unlock audio on first user gesture (required by iOS Safari). */
export function unlockAudio() {
  const ctx = getCtx()
  if (!ctx || unlocked) return
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  // Silent buffer kickstarts the audio graph on iOS
  const buffer = ctx.createBuffer(1, 1, 22050)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start(0)
  unlocked = true
}

/**
 * Play a subtle tactile "pop/tick".
 * @param {'tap'|'snap'|'soft'} [variant='tap']
 */
export function playTick(variant = 'tap') {
  const ctx = getCtx()
  if (!ctx) return

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  const presets = {
    tap: { freq: 180, dur: 0.045, peak: 0.12, type: 'sine' },
    snap: { freq: 320, dur: 0.03, peak: 0.1, type: 'triangle' },
    soft: { freq: 140, dur: 0.06, peak: 0.08, type: 'sine' },
  }
  const p = presets[variant] || presets.tap

  osc.type = p.type
  osc.frequency.setValueAtTime(p.freq, now)
  osc.frequency.exponentialRampToValueAtTime(p.freq * 0.55, now + p.dur)

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(p.peak, now + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + p.dur)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + p.dur + 0.01)
}

export function useSound() {
  return { playTick, unlockAudio }
}
