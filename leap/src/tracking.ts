import type { Finger, Hand, Vec3 } from './protocol.js'

// Where LeapC.h (Gemini 5 and Hyperion 6) puts what the bridge reads. Its structs are packed to the byte
// (`#pragma pack(1)`), so these offsets are the same on Windows, macOS and Linux, all 64-bit. Read as bytes
// rather than declared field by field: the bridge needs a tenth of a LEAP_HAND.

// LEAP_CONNECTION_MESSAGE: uint32 size, eLeapEventType type, a pointer to the event, uint32 device_id.
export const MESSAGE_SIZE = 20
const MESSAGE_TYPE = 4
const MESSAGE_EVENT = 8
export const EVENT_TRACKING = 0x100

// LEAP_TRACKING_EVENT: LEAP_FRAME_HEADER info (24), int64 tracking_frame_id, uint32 nHands, LEAP_HAND* pHands,
// float framerate.
export const TRACKING_EVENT_SIZE = 48
const TRACKING_HAND_COUNT = 32
const TRACKING_HANDS = 36

// LEAP_HAND: id, flags, type, confidence, visible_time, pinch_distance, grab_angle, pinch_strength,
// grab_strength, LEAP_PALM palm, LEAP_DIGIT digits[5], LEAP_BONE arm.
export const HAND_SIZE = 1084
const HAND_ID = 0
const HAND_TYPE = 8
const HAND_PINCH_STRENGTH = 32
const HAND_GRAB_STRENGTH = 36
// LEAP_PALM: position, stabilized_position, velocity, normal, width, direction, orientation.
const PALM_POSITION = 40
const PALM_VELOCITY = 64
const PALM_NORMAL = 76
const HAND_DIGITS = 120
// LEAP_DIGIT: int32 finger_id, LEAP_BONE bones[4], uint32 is_extended.
const DIGIT_SIZE = 184
const DIGIT_BONES = 4
const DIGIT_EXTENDED = 180
// LEAP_BONE: LEAP_VECTOR prev_joint, next_joint, float width, LEAP_QUATERNION rotation.
const BONE_SIZE = 44
const BONE_NEXT = 12
const HAND_TYPE_LEFT = 0
// More hands than this in one frame is not a frame: a pointer read where a count should be.
const MOST_HANDS = 8

const rounded = (value: number, digits: number) => Number(value.toFixed(digits))

function vector(view: DataView, at: number, digits: number): Vec3 {
  return [
    rounded(view.getFloat32(at, true), digits),
    rounded(view.getFloat32(at + 4, true), digits),
    rounded(view.getFloat32(at + 8, true), digits),
  ]
}

// A tenth of a millimetre is finer than the sensor.
const point = (view: DataView, at: number) => vector(view, at, 1)

function finger(view: DataView, at: number): Finger {
  const bone = (index: number) => at + DIGIT_BONES + index * BONE_SIZE
  return {
    extended: view.getUint32(at + DIGIT_EXTENDED, true) !== 0,
    joints: [
      point(view, bone(0)),
      point(view, bone(0) + BONE_NEXT),
      point(view, bone(1) + BONE_NEXT),
      point(view, bone(2) + BONE_NEXT),
      point(view, bone(3) + BONE_NEXT),
    ],
  }
}

// One LEAP_HAND, `at` bytes into the view.
export function readHand(view: DataView, at = 0): Hand {
  const digit = (index: number) => finger(view, at + HAND_DIGITS + index * DIGIT_SIZE)
  return {
    id: view.getUint32(at + HAND_ID, true),
    side: view.getInt32(at + HAND_TYPE, true) === HAND_TYPE_LEFT ? 'left' : 'right',
    palm: point(view, at + PALM_POSITION),
    normal: vector(view, at + PALM_NORMAL, 3),
    velocity: vector(view, at + PALM_VELOCITY, 0),
    grab: rounded(view.getFloat32(at + HAND_GRAB_STRENGTH, true), 2),
    pinch: rounded(view.getFloat32(at + HAND_PINCH_STRENGTH, true), 2),
    fingers: [digit(0), digit(1), digit(2), digit(3), digit(4)],
  }
}

// What a LEAP_CONNECTION_MESSAGE says came: the kind of event, and where it is in memory.
export function readMessage(message: Buffer): { type: number; event: bigint } {
  return { type: message.readInt32LE(MESSAGE_TYPE), event: message.readBigUInt64LE(MESSAGE_EVENT) }
}

// How many hands a LEAP_TRACKING_EVENT holds, and where: null when it reads as no tracking event would.
export function readTrackingEvent(view: DataView): { count: number; hands: bigint } | null {
  const count = view.getUint32(TRACKING_HAND_COUNT, true)
  const hands = view.getBigUint64(TRACKING_HANDS, true)
  if (count > MOST_HANDS || (count > 0 && hands === 0n)) return null
  return { count, hands }
}
