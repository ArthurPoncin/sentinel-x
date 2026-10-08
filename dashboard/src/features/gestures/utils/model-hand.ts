import type { Hand, Vec3 } from '../api/hand-frame'

// Hands made up to show a gesture, as the sensor would see them: what the tutorial draws beside each one. The
// same shape as the hand bridge's simulated hand (leap/src/simulate.ts), which the dashboard cannot import.

// The poses the tutorial shows. `point` is a hand that aims, its thumb drawn back, and `fire` the same hand once
// its thumb has come down along the index.
export type ModelPose = 'flat' | 'fist' | 'edge' | 'thumb-up' | 'thumb-down' | 'point' | 'fire'

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, by: number): Vec3 => [a[0] * by, a[1] * by, a[2] * by]

// A right hand's axes: where its fingers point, where its thumb is, and where its palm faces.
interface Axes {
  forward: Vec3
  side: Vec3
  normal: Vec3
}

// Flat over the sensor, fingers away from the Operator, thumb to the left.
const FLAT: Axes = { forward: [0, 0, -1], side: [-1, 0, 0], normal: [0, -1, 0] }
const AXES: Record<ModelPose, Axes> = {
  flat: FLAT,
  fist: FLAT,
  point: FLAT,
  fire: FLAT,
  // On its edge, as a page is turned: thumb up, palm to the left.
  edge: { forward: [0, 0, -1], side: [0, 1, 0], normal: [-1, 0, 0] },
  'thumb-up': { forward: [-1, 0, 0], side: [0, 1, 0], normal: [0, 0, 1] },
  'thumb-down': { forward: [-1, 0, 0], side: [0, -1, 0], normal: [0, 0, -1] },
}

// Each finger of a right hand, from the palm's centre in millimetres: where its knuckle is, along the hand
// and across it (toward the thumb), how long its three last bones are, and how far it leans off the hand's
// length, in radians.
const FINGERS = [
  { knuckle: [10, 38], bones: [42, 30, 22], lean: 0.9 },
  { knuckle: [42, 22], bones: [40, 24, 18], lean: 0.12 },
  { knuckle: [46, 2], bones: [45, 28, 18], lean: 0 },
  { knuckle: [42, -17], bones: [41, 26, 18], lean: -0.1 },
  { knuckle: [34, -34], bones: [32, 19, 16], lean: -0.22 },
] as const
const WRIST = -55
// How far from the hand's length a thumb held up or down stands: almost square to it.
const THUMB_RAISED = 1.4
// And the thumb of a hand that points, drawn back off its index like a hammer.
const THUMB_BACK = 1.2
// And once it has fired: the hammer down, along the index.
const THUMB_FIRED = 0.2
// How a thumb leans in a pose that sets it another way than a hand at rest.
const THUMB: Partial<Record<ModelPose, number>> = { 'thumb-up': THUMB_RAISED, 'thumb-down': THUMB_RAISED, point: THUMB_BACK, fire: THUMB_FIRED }

// Which fingers are folded in each pose, thumb first.
const CURLED: Record<ModelPose, readonly boolean[]> = {
  flat: [false, false, false, false, false],
  edge: [false, false, false, false, false],
  fist: [true, true, true, true, true],
  point: [false, false, true, true, true],
  fire: [false, false, true, true, true],
  'thumb-up': [false, true, true, true, true],
  'thumb-down': [false, true, true, true, true],
}

// A hand in `pose`, its palm at `palm`. A left one is the right one seen in a mirror.
export function modelHand(pose: ModelPose, { palm = [0, 200, 0], side = 'right', id = 1 }: { palm?: Vec3; side?: Hand['side']; id?: number } = {}): Hand {
  const mirror = side === 'left' && AXES[pose] === FLAT ? -1 : 1
  const axes: Axes = { ...AXES[pose], side: scale(AXES[pose].side, mirror) }
  const at = (along: number, across: number, down = 0): Vec3 =>
    add(palm, add(add(scale(axes.forward, along), scale(axes.side, across)), scale(axes.normal, down)))

  const finger = (index: number) => {
    const { knuckle, bones, lean: resting } = FINGERS[index] as (typeof FINGERS)[number]
    const lean = index === 0 ? (THUMB[pose] ?? resting) : resting
    const curled = CURLED[pose][index] ?? false
    const joints: Vec3[] = [at(WRIST, knuckle[1] * 0.4), at(knuckle[0], knuckle[1])]
    // A straight finger goes on from its knuckle, leaning the way it is set on the hand; a folded one turns
    // into the palm a bone at a time.
    let [along, across, down] = [knuckle[0], knuckle[1], 0]
    for (const [bone, length] of bones.entries()) {
      if (curled) {
        const fold = ((bone + 1) * Math.PI) / 2.6
        along += Math.cos(fold) * length
        down += Math.sin(fold) * length
      } else {
        along += Math.cos(lean) * length
        across += Math.sin(lean) * length
      }
      joints.push(at(along, across, down))
    }
    return { extended: !curled, joints } as Hand['fingers'][number]
  }

  return {
    id,
    side,
    palm,
    normal: axes.normal,
    velocity: [0, 0, 0],
    grab: pose === 'flat' || pose === 'edge' ? 0 : 1,
    pinch: 0,
    fingers: [finger(0), finger(1), finger(2), finger(3), finger(4)],
  }
}
