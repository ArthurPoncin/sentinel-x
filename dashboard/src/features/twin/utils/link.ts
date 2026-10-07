import type { Frame } from '@/shared/contract'

// Seconds an impulse takes to rise over the antenna and fade out. Shorter than the second between two
// snapshots of telemetry: one is gone before the next leaves, and the link is seen to beat.
export const IMPULSE_LIFE = 0.9
// Impulses drawn at once. A replay sought forward, or frames closer than a second, leave two at most.
export const MAX_IMPULSES = 3
// How far over the antenna's tip an impulse rises, at the Enclosure's scale 1: little, as the camera frames
// the Enclosure with little room above its roof, which the tip stands just over.
export const IMPULSE_RISE = 0.22
// The radius of an impulse's ring as it leaves the tip, and once it has risen: it widens as it goes.
export const IMPULSE_RADIUS = [0.025, 0.1] as const

// An impulse over the antenna: when it left its tip, in seconds on a clock that only goes forward.
export interface Impulse {
  startedAt: number
}

// Whether a frame of telemetry is among `frames`: what the link carries from the Sentinel, a snapshot a
// second. An Alert is not one, and neither is the Status the Command Post works out.
export function telemetryIn(frames: readonly Frame[]): boolean {
  return frames.some((frame) => frame.type === 'telemetry')
}

// The impulses over the antenna at `now`: those of `impulses` still rising, and one more leaving the tip if
// telemetry was `received`. Frames that come in at the same instant leave the one impulse: several at the
// same place would only be a brighter one. An impulse never cuts another: each plays to its end. Past
// MAX_IMPULSES, the oldest go first. While the link is not `live`, the signal lost, there is none at all, and
// what was received then leaves none later.
export function impulsesAt(
  impulses: readonly Impulse[],
  received: boolean,
  live: boolean,
  now: number,
): readonly Impulse[] {
  if (!live) return impulses.length === 0 ? impulses : []
  const going = impulses.filter((impulse) => now < impulse.startedAt + IMPULSE_LIFE)
  if (!received) return going.length === impulses.length ? impulses : going
  return [...going, { startedAt: now }].slice(-MAX_IMPULSES)
}

// An impulse as it shows: how far over the antenna's tip it is, the radius of its ring, both at the
// Enclosure's scale 1, and how bright, 0–1.
export interface ImpulseShape {
  height: number
  radius: number
  glow: number
}

const smoothstep = (share: number) => {
  const held = Math.min(1, Math.max(0, share))
  return held * held * (3 - 2 * held)
}

// An impulse `elapsed` seconds after it left the antenna's tip, or null before it leaves and once it is gone.
// Fast as it leaves, slower as it rises; it lights up within its first tenth and fades out over the rest, all
// the way to nothing as its life ends, so it goes without a cut.
export function impulseShape(elapsed: number): ImpulseShape | null {
  if (elapsed < 0 || elapsed >= IMPULSE_LIFE) return null
  const age = elapsed / IMPULSE_LIFE
  const risen = 1 - (1 - age) ** 2

  return {
    height: IMPULSE_RISE * risen,
    radius: IMPULSE_RADIUS[0] + (IMPULSE_RADIUS[1] - IMPULSE_RADIUS[0]) * risen,
    glow: smoothstep(age / 0.1) * (1 - age) ** 1.5,
  }
}
