import type { Finger, Hand, Vec3 } from './protocol.js'

// A hand made up, for a dashboard to answer to without a sensor: `npm run simulate`. It plays one script over
// and over, each pose long enough for the dashboard to act on it.

export type Pose = 'open' | 'fist' | 'thumb-up' | 'thumb-down' | 'page'

interface Step {
  pose: Pose
  seconds: number
  // Where the palm goes during the step, in millimetres: from one to the other, eased.
  from: Vec3
  to: Vec3
}

const REST: Vec3 = [0, 200, 0]

// Steers the camera each way, turns the page to the other screen and back, silences the Alarm, sounds it,
// silences it again, then lets the sensor see nothing for a while.
export const SCRIPT: readonly Step[] = [
  { pose: 'open', seconds: 2, from: REST, to: REST },
  { pose: 'open', seconds: 3, from: REST, to: [110, 200, 0] },
  { pose: 'open', seconds: 3, from: [110, 200, 0], to: [-110, 200, 0] },
  { pose: 'open', seconds: 2, from: [-110, 200, 0], to: [0, 120, 0] },
  { pose: 'open', seconds: 2, from: [0, 120, 0], to: [0, 290, 0] },
  { pose: 'open', seconds: 2, from: [0, 290, 0], to: [0, 200, 90] },
  { pose: 'open', seconds: 1, from: [0, 200, 90], to: REST },
  { pose: 'fist', seconds: 3, from: REST, to: [90, 200, 0] },
  { pose: 'thumb-up', seconds: 3, from: REST, to: REST },
  { pose: 'open', seconds: 1, from: REST, to: REST },
  { pose: 'thumb-down', seconds: 3, from: REST, to: REST },
  { pose: 'open', seconds: 1, from: REST, to: REST },
  { pose: 'thumb-up', seconds: 3, from: REST, to: REST },
  { pose: 'page', seconds: 0.4, from: [140, 200, 0], to: [-140, 200, 0] },
  { pose: 'open', seconds: 3, from: REST, to: REST },
  { pose: 'page', seconds: 0.4, from: [-140, 200, 0], to: [140, 200, 0] },
]
// Seconds without a hand at the end of each round.
export const PAUSE = 2
export const ROUND = SCRIPT.reduce((total, step) => total + step.seconds, PAUSE)

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, by: number): Vec3 => [a[0] * by, a[1] * by, a[2] * by]
const mix = (a: Vec3, b: Vec3, share: number): Vec3 => add(scale(a, 1 - share), scale(b, share))
const rounded = (a: Vec3): Vec3 => [Math.round(a[0] * 10) / 10, Math.round(a[1] * 10) / 10, Math.round(a[2] * 10) / 10]
const smooth = (share: number) => share * share * (3 - 2 * share)

// A right hand's axes: where its fingers point, where its thumb is, and where its palm faces.
interface Axes {
  forward: Vec3
  side: Vec3
  normal: Vec3
}

// Flat over the sensor, fingers away from the Operator, thumb to the left.
const FLAT: Axes = { forward: [0, 0, -1], side: [-1, 0, 0], normal: [0, -1, 0] }
const AXES: Record<Pose, Axes> = {
  open: FLAT,
  fist: FLAT,
  // On its edge, as a page is turned: thumb up, palm to the left.
  page: { forward: [0, 0, -1], side: [0, 1, 0], normal: [-1, 0, 0] },
  'thumb-up': { forward: [-1, 0, 0], side: [0, 1, 0], normal: [0, 0, 1] },
  'thumb-down': { forward: [-1, 0, 0], side: [0, -1, 0], normal: [0, 0, -1] },
}

// Each finger of a right hand, from the palm's centre in millimetres: where its knuckle is, along the hand
// and across it (toward the thumb), and how long its three last bones are.
const FINGERS = [
  { knuckle: [10, 38], bones: [0, 42, 30, 22], lean: 0.9 },
  { knuckle: [42, 22], bones: [0, 40, 24, 18], lean: 0.12 },
  { knuckle: [46, 2], bones: [0, 45, 28, 18], lean: 0 },
  { knuckle: [42, -17], bones: [0, 41, 26, 18], lean: -0.1 },
  { knuckle: [34, -34], bones: [0, 32, 19, 16], lean: -0.22 },
] as const
const WRIST = -55

// How far from the hand's length a thumb held up or down stands: almost square to it.
const THUMB_RAISED = 1.4

function finger(index: number, palm: Vec3, axes: Axes, curled: boolean, raised = false): Finger {
  const { knuckle, bones } = FINGERS[index] as (typeof FINGERS)[number]
  const lean = raised ? THUMB_RAISED : (FINGERS[index] as (typeof FINGERS)[number]).lean
  const at = (along: number, across: number, down = 0): Vec3 =>
    add(palm, add(add(scale(axes.forward, along), scale(axes.side, across)), scale(axes.normal, down)))
  const base = at(WRIST, knuckle[1] * 0.4)
  const joints: Vec3[] = [base, at(knuckle[0], knuckle[1])]
  // A straight finger goes on from its knuckle, leaning the way it is set on the hand; a curled one folds
  // into the palm a bone at a time.
  let [along, across, down] = [knuckle[0], knuckle[1], 0]
  for (const [bone, length] of bones.slice(1).entries()) {
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
  return { extended: !curled, joints: joints.map(rounded) as Finger['joints'] }
}

// The hand the script shows `seconds` after it started, or none during its pause.
export function simulatedHands(seconds: number): Hand[] {
  let left = ((seconds % ROUND) + ROUND) % ROUND
  for (const step of SCRIPT) {
    if (left >= step.seconds) {
      left -= step.seconds
      continue
    }
    const share = left / step.seconds
    const palm = mix(step.from, step.to, smooth(share))
    // The speed of an eased move: its length over its time, by the slope of the easing.
    const speed = (6 * share * (1 - share)) / step.seconds
    const axes = AXES[step.pose]
    const curled = (index: number) => step.pose === 'fist' || (index > 0 && step.pose.startsWith('thumb'))
    return [
      {
        id: 1,
        side: 'right',
        palm: rounded(palm),
        normal: axes.normal,
        velocity: rounded(scale(add(step.to, scale(step.from, -1)), speed)),
        grab: step.pose === 'open' || step.pose === 'page' ? 0 : 1,
        pinch: 0,
        fingers: [0, 1, 2, 3, 4].map((index) =>
          finger(index, palm, axes, curled(index), index === 0 && step.pose.startsWith('thumb')),
        ) as Hand['fingers'],
      },
    ]
  }
  return []
}
