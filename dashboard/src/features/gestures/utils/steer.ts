import type { Vec3 } from '../api/hand-frame'

// A flat hand over the sensor is a joystick: still at the middle, it moves the camera the faster the further
// from it. Millimetres, in the sensor's axes.

// Where the hand rests: over the sensor's centre, a hand's width above it.
export const NEUTRAL: Vec3 = [0, 200, 0]
// Around the rest, on each axis, the hand moves nothing: nobody holds a hand perfectly still.
export const DEAD_ZONE = 35
// From the rest, where an axis is at its full speed.
export const FULL = { x: 130, y: 100, z: 110 } as const

// How the hand steers, each from -1 to 1 and 0 when it does not.
export interface Steer {
  // Positive with the hand to the Operator's right.
  turn: number
  // Positive with the hand pulled toward the Operator.
  tilt: number
  // Positive with the hand lowered toward the sensor.
  zoom: number
}

// An axis of the joystick: 0 inside the dead zone, then eased up to 1 at `full`, so the first millimetres out
// of the dead zone are slow ones.
export function axis(offset: number, full: number): number {
  const out = Math.abs(offset) - DEAD_ZONE
  if (out <= 0) return 0
  const share = Math.min(1, out / (full - DEAD_ZONE))
  return Math.sign(offset) * share * share
}

export function steerOf(palm: Vec3): Steer {
  return {
    turn: axis(palm[0] - NEUTRAL[0], FULL.x),
    tilt: axis(palm[2] - NEUTRAL[2], FULL.z),
    zoom: axis(NEUTRAL[1] - palm[1], FULL.y),
  }
}

// A fist winds a replay: to the right forward, to the left back, -1 to 1.
export function windOf(palm: Vec3): number {
  return axis(palm[0] - NEUTRAL[0], FULL.x)
}

// A hand that aims moves a sight over the screen as a mouse would in the air: the tip of its index over the
// sensor's centre is the middle of the view, `AIM` millimetres to a side or up its edge. Where the index points
// is left out of it: turned by a few degrees, it would throw the sight across the screen.
export const AIM = { x: 140, y: 90, rest: 210 } as const
// The sight stops short of the edges: it stays whole on screen.
export const AIM_EDGE = 0.92

// Where the sight is in the view, each from -1 to 1: x to the right, y up.
export function aimOf(tip: Vec3): [x: number, y: number] {
  const within = (share: number) => Math.min(AIM_EDGE, Math.max(-AIM_EDGE, share))
  return [within(tip[0] / AIM.x), within((tip[1] - AIM.rest) / AIM.y)]
}

// Two open hands hold the view between them: how far apart their palms are, in millimetres.
export function gapOf(one: Vec3, other: Vec3): number {
  return Math.hypot(one[0] - other[0], one[1] - other[1], one[2] - other[2])
}
