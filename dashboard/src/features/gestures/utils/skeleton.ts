import type { Hand, Vec3 } from '../api/hand-frame'

// A hand as lines, for whoever draws it flat: its bones, each from one joint to the next. Each finger from its
// knuckle out, the thumb from its base, and the palm's outline, from the wrist round the knuckles.
export function handLines(hand: Pick<Hand, 'fingers'>): [Vec3, Vec3][] {
  const lines: [Vec3, Vec3][] = []
  for (const { joints } of hand.fingers) {
    for (let index = 1; index < joints.length - 1; index++) lines.push([joints[index] as Vec3, joints[index + 1] as Vec3])
  }
  const [thumb, index, middle, ring, pinky] = hand.fingers
  lines.push([index.joints[1], middle.joints[1]], [middle.joints[1], ring.joints[1]], [ring.joints[1], pinky.joints[1]])
  lines.push([thumb.joints[0], thumb.joints[1]], [index.joints[0], index.joints[1]], [pinky.joints[0], pinky.joints[1]])
  lines.push([index.joints[0], pinky.joints[0]])
  return lines
}

// From where a hand is looked at: from above (the Operator's right to the right, away from them up), from the
// front (as the screen would see it) or from its side (away from the Operator to the right).
export type View = 'top' | 'front' | 'side'

// A sensed point flat on a drawing, in millimetres: x to the right, y down as a screen counts.
export function flat([x, y, z]: Vec3, view: View): [x: number, y: number] {
  if (view === 'top') return [x, z]
  if (view === 'front') return [x, -y]
  return [-z, -y]
}
