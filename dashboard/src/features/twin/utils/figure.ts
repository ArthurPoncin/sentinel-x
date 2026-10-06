// A segment of a limb, from the joint it hangs from to the next: how long between the two, and its radius at
// each, top first. It is rounded around both.
export interface Segment {
  length: number
  radius: readonly [top: number, bottom: number]
}

// The intruder's figurine, defined once: a simple human silhouette, in scene units, standing on the ground at
// its feet. `x` is how far off its axis a joint is, the same on both sides. Its size is exaggerated like the
// Enclosure's, to stay readable from the back of the room.
export const FIGURE = {
  // Each leg hangs from its hip, in two segments, down to the ground.
  hip: { x: 0.034 },
  thigh: { length: 0.098, radius: [0.027, 0.022] },
  shin: { length: 0.096, radius: [0.022, 0.018] },
  // The torso, `sunk` below the hips so that the legs come out of it.
  torso: { width: 0.116, height: 0.166, depth: 0.066, sunk: 0.012 },
  // Each arm hangs from its shoulder, in two segments, beside the torso.
  shoulder: { x: 0.081 },
  upperArm: { length: 0.08, radius: [0.02, 0.017] },
  forearm: { length: 0.074, radius: [0.017, 0.014] },
  // The head, `clear` of the torso: no neck, it floats over the shoulders.
  head: { height: 0.072, radius: 0.034, clear: 0.014 },
} as const

// How high the hips are: the legs' two segments, and the rounded end the figurine stands on.
export function hipHeight(): number {
  const { thigh, shin } = FIGURE
  return thigh.length + shin.length + shin.radius[1]
}

// Where the torso starts and ends, from the ground.
export function torsoSpan(): { base: number; top: number } {
  const base = hipHeight() - FIGURE.torso.sunk
  return { base, top: base + FIGURE.torso.height }
}

// How high the shoulders are: the top of the arms is level with the top of the torso.
export function shoulderHeight(): number {
  return torsoSpan().top - FIGURE.upperArm.radius[0]
}

// How high the head starts, and the figurine's whole height.
export function headBase(): number {
  return torsoSpan().top + FIGURE.head.clear
}

export function figureHeight(): number {
  return headBase() + FIGURE.head.height
}

// The middle of the head: where the line from the camera's lens ends.
export function headHeight(): number {
  return headBase() + FIGURE.head.height / 2
}

// Seconds the figurine takes to appear once its Alert is raised: a sweep from its feet to its head.
export const SWEEP_SECONDS = 0.7

// The share of the way up the sweep has got to, `age` seconds after the Alert was raised: nothing of the
// figurine at 0, all of it at 1. At a steady pace, like a scanner's.
export function sweptTo(age: number): number {
  return Math.min(1, Math.max(0, age / SWEEP_SECONDS))
}
