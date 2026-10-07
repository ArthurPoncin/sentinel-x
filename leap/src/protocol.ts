// What the bridge sends the dashboard: one JSON text message per frame of tracking, the hands the sensor sees
// in it. Lengths are millimetres and directions unit vectors, in the sensor's own axes with it flat on the
// table, its cable to the left: x to the Operator's right, y up, z toward the Operator. The dashboard holds the
// same shapes as a zod schema (dashboard/src/features/gestures/api/hand-frame.ts): change both together.
export const PROTOCOL_VERSION = 1
// Loopback only, next to the port the Leap Motion service itself used to serve hands on (6437).
export const DEFAULT_PORT = 6438
// The sensor tracks at about 110 frames a second: more than a screen shows.
export const MAX_FRAMES_PER_SECOND = 60

export type Vec3 = [x: number, y: number, z: number]

export interface Finger {
  extended: boolean
  // From the wrist to the tip: the base of the metacarpal, then the far end of each of the four bones.
  joints: [Vec3, Vec3, Vec3, Vec3, Vec3]
}

export interface Hand {
  id: number
  side: 'left' | 'right'
  // The centre of the palm, the way it faces (down, for a hand held flat over the sensor) and how it moves,
  // in millimetres a second.
  palm: Vec3
  normal: Vec3
  velocity: Vec3
  // 0 for a flat hand to 1 for a fist; 0 for an open hand to 1 for thumb and index pressed together.
  grab: number
  pinch: number
  // Thumb, index, middle, ring, pinky.
  fingers: [Finger, Finger, Finger, Finger, Finger]
}

export interface HandFrame {
  v: typeof PROTOCOL_VERSION
  hands: Hand[]
}
