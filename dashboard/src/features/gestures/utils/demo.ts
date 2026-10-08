import type { Hand, Vec3 } from '../api/hand-frame'
import { HOLD } from './interpret'
import { modelHand } from './model-hand'
import { NEUTRAL } from './steer'

// The hands of a lesson move: each gesture is played over and over beside its words, by made-up hands. What is
// here says where they are at each instant, for whoever draws them.

// What is drawn at an instant: the hands, how far along a thumb held is (0 to 1, null when none is), and how
// bright what just happened still is, from 1 down to 0: a thumb that came through, a shot.
export interface Shown {
  hands: readonly Hand[]
  hold: number | null
  flash: number
}

// A gesture played in a loop, by the seconds since it started. At 0 the hand is in the pose the lesson is about:
// what is drawn for whoever asked for no motion.
export type Demo = (seconds: number) => Shown

const TURN = 2 * Math.PI
const [X, Y, Z] = NEUTRAL

// 0 before `from`, 1 after `to`, and eased in between: a hand starts and stops gently.
function ramp(at: number, from: number, to: number): number {
  const share = Math.min(1, Math.max(0, (at - from) / (to - from)))
  return share * share * (3 - 2 * share)
}

// Written so that it is `from` itself at 0 and `to` itself at 1, to the last digit.
const between = (from: number, to: number, share: number) => from * (1 - share) + to * share
const mix = (from: Vec3, to: Vec3, share: number): Vec3 => [between(from[0], to[0], share), between(from[1], to[1], share), between(from[2], to[2], share)]

// A hand on its way from one pose to another, `share` of the way there: each joint in a straight line.
export function blend(from: Hand, to: Hand, share: number): Hand {
  const fingers = from.fingers.map((finger, index) => {
    const other = to.fingers[index] as Hand['fingers'][number]
    return {
      extended: share < 0.5 ? finger.extended : other.extended,
      joints: finger.joints.map((joint, at) => mix(joint, other.joints[at] as Vec3, share)),
    }
  }) as Hand['fingers']
  return {
    ...from,
    palm: mix(from.palm, to.palm, share),
    normal: mix(from.normal, to.normal, share),
    grab: between(from.grab, to.grab, share),
    fingers,
  }
}

const still = (hands: readonly Hand[]): Shown => ({ hands, hold: null, flash: 0 })

// A flat hand drifts to each side and back and forth round the rest: the joystick.
const flat: Demo = (seconds) => {
  const palm: Vec3 = [X + 80 * Math.sin((seconds * TURN) / 6), Y, Z + 40 * Math.sin((seconds * TURN) / 3)]
  return still([modelHand('flat', { palm })])
}

// Two open hands move apart, then together.
const spread: Demo = (seconds) => {
  const half = 85 + 45 * (0.5 - 0.5 * Math.cos((seconds * TURN) / 4))
  return still([modelHand('flat', { palm: [X + half, Y, Z] }), modelHand('flat', { palm: [X - half, Y, Z], side: 'left', id: 2 })])
}

// A fist goes to the right, then to the left, as it winds a replay, then opens and closes again.
const fist: Demo = (seconds) => {
  const at = seconds % 6
  const palm: Vec3 = [X + (at < 4 ? 90 * Math.sin((at * TURN) / 4) : 0), Y, Z]
  const open = ramp(at, 4.2, 4.7) - ramp(at, 5.2, 5.7)
  return still([blend(modelHand('fist', { palm }), modelHand('flat', { palm }), open)])
}

// A hand on its edge is swept across the sensor, waits, and is swept back.
const edge: Demo = (seconds) => {
  const at = seconds % 3.6
  const side = 1 - 2 * ramp(at, 0.7, 1.1) + 2 * ramp(at, 2.5, 2.9)
  return still([modelHand('edge', { palm: [X + 90 * side, Y, Z] })])
}

// How long a thumb that came through stays lit, then how long before it is held again.
const LIT = 0.8
const REST = 0.6

// A thumb is held for as long as it must be, comes through, and starts again.
const thumb =
  (pose: 'thumb-up' | 'thumb-down'): Demo =>
  (seconds) => {
    const at = seconds % (HOLD + LIT + REST)
    const hands = [modelHand(pose)]
    if (at < HOLD) return { hands, hold: at / HOLD, flash: 0 }
    if (at < HOLD + LIT) return { hands, hold: 1, flash: 1 - (at - HOLD) / LIT }
    return still(hands)
  }

// A pointed index moves the sight about: to each side, up and down.
const aim: Demo = (seconds) => {
  const palm: Vec3 = [X + 70 * Math.sin((seconds * TURN) / 5), Y + 28 * Math.sin((seconds * TURN) / 2.5), Z]
  return still([modelHand('point', { palm })])
}

// When the hammer starts down, when the shot goes off, and how long it stays lit.
const FIRE = { pull: 0.9, shot: 1.02, lit: 0.5 } as const

// The thumb drawn back comes down along the index: the shot goes off, the hand kicks, and the thumb is drawn
// back again.
const pistol: Demo = (seconds) => {
  const at = seconds % 2.6
  const flash = at >= FIRE.shot ? Math.max(0, 1 - (at - FIRE.shot) / FIRE.lit) : 0
  const palm: Vec3 = [X, Y + 14 * flash, Z]
  const down = ramp(at, FIRE.pull, FIRE.shot) - ramp(at, 1.7, 2.1)
  return { hands: [blend(modelHand('point', { palm }), modelHand('fire', { palm }), down)], hold: null, flash }
}

// What is drawn for a gesture nobody was told: no hand at all.
const untold: Demo = () => still([])

export const DEMOS = { flat, spread, fist, edge, 'thumb-up': thumb('thumb-up'), 'thumb-down': thumb('thumb-down'), aim, pistol, untold } as const
