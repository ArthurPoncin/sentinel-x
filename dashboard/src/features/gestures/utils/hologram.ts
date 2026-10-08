import type { Vec3 } from '../api/hand-frame'

// The hands of the tutorial are drawn as the sensor's own viewer shows them: in depth, from a point that looks
// at them. Lengths are millimetres and angles radians, in the sensor's axes: x to the Operator's right, y up, z
// toward the Operator.

// From where the hands are looked at: turned round them toward the Operator's right, and raised above them.
// Neither turned nor raised, they are seen as the Operator sees them, from their own side of the desk.
export interface Viewpoint {
  yaw: number
  pitch: number
}

// The point looked at, and how far from it the eye is: the nearer, the more what is close outgrows what is far.
export interface Camera extends Viewpoint {
  target: Vec3
  distance: number
}

// Nothing is drawn nearer to the eye than this: a point behind it would come back upside down.
const NEAREST = 1

// A sensed point as the camera sees it: x to the right and y down as a screen counts, in the millimetres of
// what stands at the target, and how much larger than there the point is drawn.
export function project([x, y, z]: Vec3, { target, distance, yaw, pitch }: Camera): [x: number, y: number, scale: number] {
  const [px, py, pz] = [x - target[0], y - target[1], z - target[2]]
  // Turned back by the yaw round the vertical, then by the pitch round what is then across: the eye ends up
  // straight ahead on z.
  const across = px * Math.cos(yaw) - pz * Math.sin(yaw)
  const ahead = px * Math.sin(yaw) + pz * Math.cos(yaw)
  const up = py * Math.cos(pitch) - ahead * Math.sin(pitch)
  const toward = py * Math.sin(pitch) + ahead * Math.cos(pitch)
  const scale = distance / Math.max(NEAREST, distance - toward)
  return [across * scale, -up * scale, scale]
}
