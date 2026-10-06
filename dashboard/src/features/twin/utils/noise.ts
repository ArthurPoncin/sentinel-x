import type { Frame } from '@/shared/contract'
import { ENCLOSURE_SHAPE } from './enclosure-parts'
import { SITE } from './site'

// Seconds a wave takes to spread over the socle and fade out. A `noise` Alert can last a single cycle: the
// wave does not wait for its `cleared`, it always plays to its end.
export const WAVE_LIFE = 1.5
// Waves drawn at once. A clap a second, as fast as the Sentinel raises them, leaves at most two on the socle.
export const MAX_WAVES = 4
// How far the quietest wave goes, as a share of the way the loudest one does: even a faint one leaves the
// Enclosure and is seen.
export const QUIET_REACH = 0.3
// How bright the quietest wave is at its brightest, as a share of the loudest one.
export const QUIET_GLOW = 0.4
// Where a wave starts: the foot of the Enclosure's mast, on the ground.
export const WAVE_START = ENCLOSURE_SHAPE.foot * ENCLOSURE_SHAPE.scale
// How far the loudest wave goes: to the point of the socle's rim farthest from the Enclosure, so that it
// crosses the whole socle.
export const WAVE_REACH = SITE.socle.radius + Math.hypot(SITE.enclosure.x, SITE.enclosure.z)
// How wide the wave's band is as it leaves the Enclosure, and once it has spread: it widens as it goes.
export const WAVE_WIDTH = [0.08, 0.4] as const

// A wave on the socle: when it left the Enclosure, in seconds on a clock that only goes forward, and how
// loud the clap that sent it was, 0–1.
export interface Wave {
  startedAt: number
  amplitude: number
}

// The frames that came after `seen`, both a history of the feed's frames, oldest first. A history that does
// not follow on from `seen` (another feed, or one whose last frame is long gone) holds nothing new: what was
// before is not replayed.
export function framesSince(seen: readonly Frame[], frames: readonly Frame[]): readonly Frame[] {
  if (frames === seen) return []
  const last = seen.at(-1)
  if (last === undefined) return frames
  const index = frames.lastIndexOf(last)
  return index === -1 ? [] : frames.slice(index + 1)
}

// How loud the clap a `noise` Alert was raised on is, 0–1: its `value`, the share of the cycle the sound
// sensor heard sound. An Alert that does not say is taken for a loud one.
export function amplitudeOf(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 1
  return Math.min(1, Math.max(0, value))
}

// The claps among `frames`: one for each `noise` Alert raised, with how loud it was, in the order they came.
// A `cleared` sends none, and neither does any other kind.
export function clapsIn(frames: readonly Frame[]): number[] {
  return frames.flatMap((frame) =>
    frame.type === 'alert' && frame.payload.kind === 'noise' && frame.payload.state === 'raised'
      ? [amplitudeOf(frame.payload.value)]
      : [],
  )
}

// The waves on the socle at `now`: those of `waves` still spreading, and one more leaving the Enclosure for
// each of `claps`. A wave never cuts another: each plays to its end. Past MAX_WAVES, the oldest go first.
export function wavesAt(waves: readonly Wave[], claps: readonly number[], now: number): readonly Wave[] {
  const going = waves.filter((wave) => now < wave.startedAt + WAVE_LIFE)
  if (claps.length === 0 && going.length === waves.length) return waves
  return [...going, ...claps.map((amplitude) => ({ startedAt: now, amplitude }))].slice(-MAX_WAVES)
}

// A wave as it shows: the radius of its band around the Enclosure, how wide that band is, and how bright,
// 0–1, all in scene units.
export interface WaveShape {
  radius: number
  width: number
  glow: number
}

const smoothstep = (share: number) => {
  const held = Math.min(1, Math.max(0, share))
  return held * held * (3 - 2 * held)
}

// A wave `elapsed` seconds after it left the Enclosure, for a clap `amplitude` loud, 0–1, or null before it
// leaves and once it is gone. Fast as it leaves, slower as it spreads; it lights up within its first tenth
// and fades out over the rest, all the way to nothing as its life ends, so it goes without a cut. A louder
// clap goes further and shines brighter.
export function waveShape(elapsed: number, amplitude: number): WaveShape | null {
  if (elapsed < 0 || elapsed >= WAVE_LIFE) return null
  const age = elapsed / WAVE_LIFE
  const loud = amplitudeOf(amplitude)
  const reach = WAVE_REACH * (QUIET_REACH + (1 - QUIET_REACH) * loud)
  const spread = 1 - (1 - age) ** 3

  return {
    radius: WAVE_START + (reach - WAVE_START) * spread,
    width: WAVE_WIDTH[0] + (WAVE_WIDTH[1] - WAVE_WIDTH[0]) * spread,
    glow: (QUIET_GLOW + (1 - QUIET_GLOW) * loud) * smoothstep(age / 0.1) * (1 - age) ** 1.5,
  }
}
