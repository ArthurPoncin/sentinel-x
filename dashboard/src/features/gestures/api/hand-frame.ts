import { z } from 'zod'

// What the hand bridge sends (leap/src/protocol.ts): the hands the sensor sees, one frame after the other.
// Lengths are millimetres and directions unit vectors, in the sensor's axes with it flat on the table: x to the
// Operator's right, y up, z toward the Operator. Change both files together.
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

const FingerSchema = z.object({
  extended: z.boolean(),
  // From the wrist to the tip.
  joints: z.tuple([Vec3Schema, Vec3Schema, Vec3Schema, Vec3Schema, Vec3Schema]),
})

const HandSchema = z.object({
  id: z.number(),
  side: z.enum(['left', 'right']),
  palm: Vec3Schema,
  // Where the palm faces: down, for a hand held flat over the sensor.
  normal: Vec3Schema,
  // Millimetres a second.
  velocity: Vec3Schema,
  // 0 for a flat hand to 1 for a fist.
  grab: z.number(),
  pinch: z.number(),
  // Thumb, index, middle, ring, pinky.
  fingers: z.tuple([FingerSchema, FingerSchema, FingerSchema, FingerSchema, FingerSchema]),
})

export const HandFrameSchema = z.object({ v: z.literal(1), hands: z.array(HandSchema).max(8) })

export type Vec3 = z.infer<typeof Vec3Schema>
export type Hand = z.infer<typeof HandSchema>
export type HandFrame = z.infer<typeof HandFrameSchema>

// Where the bridge listens, on the machine the dashboard is open on: a browser lets a page reach its own
// machine's loopback address in the clear, served over TLS or not.
export const HAND_BRIDGE_URL = 'ws://127.0.0.1:6438'
