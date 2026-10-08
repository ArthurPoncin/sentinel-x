import { STATUS_COLORS } from '@/shared/config/status-colors'

// The Operator's hands over the Twin, from a hand sensor on their desk: they steer the camera, and the Twin
// shows them in hologram in a corner of its view. Lengths are millimetres in the sensor's axes, it flat on the desk: x
// to the Operator's right, y up, z toward the Operator.

export type Point = readonly [x: number, y: number, z: number]

// How a hand steers the camera, each from -1 to 1 and 0 when it does not.
export interface HandSteer {
  // Positive with the hand to the Operator's right: the site turns that way, as under a drag.
  turn: number
  // Positive with the hand pulled toward the Operator: the camera comes down to the ground.
  tilt: number
  // Positive with the hand lowered: the camera comes closer.
  zoom: number
}

// What the hologram is lit in: the cold white of a hand that steers, the nominal green of one that says all
// is well, the critical red of one that sounds the Alarm.
export type HandTint = 'idle' | 'ok' | 'alarm'

export interface SensedHand {
  // Thumb to pinky, each from the wrist to the tip.
  fingers: readonly { joints: readonly Point[] }[]
  tint: HandTint
  // How far along what the hand is confirming is, 0 to 1: the hologram brightens with it.
  charge: number
}

// Where a hand that points a finger has its sight in the view, each from -1 to 1 (x to the right, y up),
// whether its thumb is drawn back, and where the tip of its index is over the sensor.
export interface HandAim {
  x: number
  y: number
  cocked: boolean
  from: Point
}

// A shot of that hand: where its sight was, and when, on whatever clock its sensor keeps. A new one is told
// by its time.
export interface HandShot {
  at: number
  x: number
  y: number
  from: Point
}

// Read by the Twin on every frame it draws, never held: all give what is true at that instant.
export interface OperatorHands {
  // Null while no hand steers: the camera is then the mouse's, or left to its orbit.
  steer(): HandSteer | null
  // How far apart two open hands are for how far they were as they took hold of the view: over 1 moved apart,
  // under it brought together. Null while they hold nothing.
  stretch(): number | null
  // Null while no hand aims, and until one has fired.
  aim(): HandAim | null
  shot(): HandShot | null
  hands(): readonly SensedHand[]
}

export const HAND_COLORS: Readonly<Record<HandTint, string>> = {
  idle: '#9fdcff',
  ok: STATUS_COLORS.nominal,
  alarm: STATUS_COLORS.critical,
}

// At full deflection: radians a second round the site, radians a second up or down, and the share of its
// distance the camera closes in a second.
export const TURN_SPEED = 1.5
export const TILT_SPEED = 0.8
export const ZOOM_SPEED = 0.9

// Where the camera stands around its target: its bearing round the vertical, its angle down from it, and how
// far it is.
export interface Stand {
  azimuth: number
  polar: number
  distance: number
}

export interface StandBounds {
  minPolar: number
  maxPolar: number
  minDistance: number
  maxDistance: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// Where the hand takes the camera in `delta` seconds, from where it stands, within the bounds a drag has.
export function steered(stand: Stand, steer: HandSteer, delta: number, bounds: StandBounds): Stand {
  return {
    azimuth: stand.azimuth - steer.turn * TURN_SPEED * delta,
    polar: clamp(stand.polar + steer.tilt * TILT_SPEED * delta, bounds.minPolar, bounds.maxPolar),
    distance: clamp(stand.distance * Math.exp(-steer.zoom * ZOOM_SPEED * delta), bounds.minDistance, bounds.maxDistance),
  }
}

// How much closer the camera comes for hands moved twice as far apart: a little more than twice, the sensor
// does not see them much further apart than that.
export const STRETCH_POWER = 1.4

// How far the camera stands with two hands at `stretch`, from where it stood as they took hold: closer as
// they move apart, as two fingers do on a screen, within the bounds a drag has.
export function stretched(held: number, stretch: number, bounds: Pick<StandBounds, 'minDistance' | 'maxDistance'>): number {
  return clamp(held / Math.max(stretch, 1e-3) ** STRETCH_POWER, bounds.minDistance, bounds.maxDistance)
}

// The hologram rides with the camera, in the lower left of its view and clear of the Outpost, whatever the
// zoom: scene units for a millimetre, how far in front of the camera it floats, and the height over the sensor
// its centre shows.
export const HOLOGRAM = {
  scale: 0.0018,
  depth: 2,
  rest: 200,
  // Where its centre is from the middle of the view, as shares of the half-width and of the half-height.
  across: -0.6,
  up: -0.28,
  // Radians it leans back by: seen from above as much as from the front, so that a flat hand shows its
  // fingers and a thumb held up still points up.
  lean: 0.9,
  // Of a bone and of a joint, in scene units.
  bone: 0.005,
  joint: 0.0095,
  // The most hands shown: the Operator has two.
  most: 2,
} as const

// Where the hologram's centre is in the camera's own frame, for its vertical field of view in degrees and the
// shape of its frame (width / height): x to the right, y up, the camera looking down -z.
export function hologramAnchor(fieldOfView: number, aspect: number): [number, number, number] {
  const halfHeight = HOLOGRAM.depth * Math.tan((fieldOfView * Math.PI) / 360)
  return [HOLOGRAM.across * halfHeight * aspect, HOLOGRAM.up * halfHeight, -HOLOGRAM.depth]
}

// A sensed point in the hologram's own frame, before it leans back: x to the right of the screen, y up, z
// toward the camera.
export function hologramPoint([x, y, z]: Point): [number, number, number] {
  return [x * HOLOGRAM.scale, (y - HOLOGRAM.rest) * HOLOGRAM.scale, z * HOLOGRAM.scale]
}

// The bones the hologram draws for a hand, as pairs of sensed points: each finger from its knuckle out, the
// thumb from its base, and the palm's outline, from the wrist round the knuckles.
export function handBones(hand: SensedHand): [Point, Point][] {
  const bones: [Point, Point][] = []
  const link = (from: Point | undefined, to: Point | undefined) => {
    if (from && to) bones.push([from, to])
  }
  for (const { joints } of hand.fingers) {
    for (let index = 1; index < joints.length - 1; index++) link(joints[index], joints[index + 1])
  }
  const knuckles = hand.fingers.map(({ joints }) => joints[1])
  for (let index = 1; index < knuckles.length - 1; index++) link(knuckles[index], knuckles[index + 1])
  const wrist = (finger: number) => hand.fingers[finger]?.joints[0]
  link(wrist(0), knuckles[0])
  link(wrist(1), knuckles[1])
  link(wrist(4), knuckles[4])
  link(wrist(1), wrist(4))
  return bones
}

// The joints it marks: every one of a finger past its base, and the two ends of the wrist.
export function handJoints(hand: SensedHand): Point[] {
  const joints = hand.fingers.flatMap((finger) => finger.joints.slice(1))
  for (const finger of [1, 4]) {
    const wrist = hand.fingers[finger]?.joints[0]
    if (wrist) joints.push(wrist)
  }
  return joints
}

// The most bones and joints a hand has: what the hologram allocates for each.
export const MOST_BONES = 5 * 3 + 3 + 4
export const MOST_JOINTS = 5 * 4 + 2
