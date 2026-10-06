import { FIGURE } from './figure'

// How far the figurine goes in one cycle of its walk, a step of each leg, in scene units: four fifths of its
// height, a walker's stride.
export const STRIDE = 0.36

// How it stands at rest: its forearms a little forward, which tells its front from its back. In radians.
export const REST_BEND = 0.3

const WALK = {
  // How high the foot that swings forward is lifted as it passes the other, in scene units.
  lift: 0.03,
  // The share of its length the leg it stands on keeps folded: it never locks straight.
  soft: 0.01,
  // How far each arm swings either way of where it hangs, and how much more its elbow bends as it comes
  // forward. In radians.
  arm: { swing: 0.5, bend: 0.4 },
} as const

// An arm or a leg in a pose, in radians: how far forward of straight down it swings from the joint it hangs
// from, and how far its second segment is folded on the first, a knee backward, an elbow forward.
export interface LimbPose {
  swing: number
  bend: number
}

// The figurine's pose: how far its hips come down from where they are at rest, in scene units, and its limbs,
// left then right.
export interface Pose {
  drop: number
  legs: readonly [left: LimbPose, right: LimbPose]
  arms: readonly [left: LimbPose, right: LimbPose]
}

// Where the figurine is in its walk cycle once it has walked `walked` scene units: a whole number at each
// cycle. It goes by the ground covered, not by the time: the foot on the ground stays where it was put down,
// at any pace and any frame rate, and a figurine that does not move takes no step.
export function walkPhase(walked: number): number {
  return walked / STRIDE
}

// Where a foot is at `phase` of its own cycle, from under its hip: how far ahead, and how high off the ground.
// For half the cycle it is planted, and goes back as fast as the figurine goes forward; for the other half it
// is lifted and swung forward again.
function footAt(phase: number, taken: number): { ahead: number; lift: number; planted: boolean } {
  // From a quarter of a cycle before it is under its hip, on the ground, to three quarters after.
  const turn = phase - Math.floor(phase + 0.25)
  if (turn < 0.25) return { ahead: -turn * STRIDE * taken, lift: 0, planted: true }
  const swung = (turn - 0.25) * 2 * Math.PI
  return {
    ahead: (-STRIDE / 4) * taken * Math.cos(swung),
    lift: WALK.lift * taken * Math.sin(swung),
    planted: false,
  }
}

const within = (value: number) => Math.min(1, Math.max(-1, value))

// The leg whose foot is `ahead` of its hip and `below` it: its two segments, folded at the knee to reach it.
function legTo(ahead: number, below: number): LimbPose {
  const thigh = FIGURE.thigh.length
  const shin = FIGURE.shin.length
  const reach = Math.min(Math.hypot(ahead, below), thigh + shin)
  // The triangle of the hip, the knee and the foot: its angle at the knee, and at the hip.
  const knee = Math.acos(within((thigh ** 2 + shin ** 2 - reach ** 2) / (2 * thigh * shin)))
  const hip = Math.acos(within((thigh ** 2 + reach ** 2 - shin ** 2) / (2 * thigh * reach)))
  return { swing: Math.atan2(ahead, below) + hip, bend: Math.PI - knee }
}

// The arm that is `lead` of its swing forward, -1 to 1: its elbow folds as it comes forward.
function armAt(lead: number, taken: number): LimbPose {
  return { swing: WALK.arm.swing * taken * lead, bend: REST_BEND + (WALK.arm.bend * taken * (1 + lead)) / 2 }
}

// The figurine's pose at `phase` of its walk cycle, which starts over at each whole number: its left foot
// under its hips, on the ground, as the right one passes it. Arms and legs go in opposition: each leg half a
// cycle from the other, each arm forward as the leg of its side is back. `share` is how much of its stride it
// takes, 0 to 1: at 0 it stands at rest, whatever the phase, and it gets into its stride and out of it
// without a jump. Pure: the same phase is the same pose.
export function walkCycle(phase: number, share = 1): Pose {
  const taken = Math.min(1, Math.max(0, share))
  const left = footAt(phase, taken)
  const right = footAt(phase + 0.5, taken)
  // The hips ride over the leg it stands on, which is all but straight: highest as they pass over its foot.
  const standing = left.planted ? left : right
  const whole = FIGURE.thigh.length + FIGURE.shin.length
  const hips = Math.sqrt((whole * (1 - WALK.soft * taken)) ** 2 - standing.ahead ** 2)
  const lead = Math.sin(2 * Math.PI * phase)

  return {
    drop: whole - hips,
    legs: [legTo(left.ahead, hips - left.lift), legTo(right.ahead, hips - right.lift)],
    arms: [armAt(lead, taken), armAt(-lead, taken)],
  }
}

// The bearing `share` of the way from `from` round to `to`, by the shortest way.
export function turnedTo(from: number, to: number, share: number): number {
  const round = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + round * share
}
