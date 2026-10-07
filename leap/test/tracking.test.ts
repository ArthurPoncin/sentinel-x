import { describe, expect, it } from 'vitest'
import { EVENT_TRACKING, HAND_SIZE, MESSAGE_SIZE, readHand, readMessage, readTrackingEvent, TRACKING_EVENT_SIZE } from '../src/tracking.js'

// The offsets below are LeapC.h's own, printed by `offsetof` from a C file that includes it (LeapC 5.x,
// x86-64): a hand written where the header says it is must be read back whole.
const PALM_POSITION = 40
const PALM_VELOCITY = 64
const PALM_NORMAL = 76
const DIGITS = 120
const DIGIT_SIZE = 184
const BONE_SIZE = 44

function vector(view: DataView, at: number, [x, y, z]: [number, number, number]) {
  view.setFloat32(at, x, true)
  view.setFloat32(at + 4, y, true)
  view.setFloat32(at + 8, z, true)
}

function hand(view: DataView, at: number, id: number, type: number) {
  view.setUint32(at, id, true)
  view.setInt32(at + 8, type, true)
  view.setFloat32(at + 32, 0.25, true)
  view.setFloat32(at + 36, 0.75, true)
  vector(view, at + PALM_POSITION, [1.54, 200.26, -3])
  vector(view, at + PALM_VELOCITY, [100.4, -200, 300])
  vector(view, at + PALM_NORMAL, [0, -1, 0])
  for (let digit = 0; digit < 5; digit++) {
    const base = at + DIGITS + digit * DIGIT_SIZE
    for (let bone = 0; bone < 4; bone++) {
      vector(view, base + 4 + bone * BONE_SIZE, [digit, bone, 0])
      vector(view, base + 4 + bone * BONE_SIZE + 12, [digit, bone + 1, 0])
    }
    view.setUint32(base + 180, digit % 2, true)
  }
}

describe('readHand', () => {
  it('reads a hand where LeapC.h puts it', () => {
    const view = new DataView(new ArrayBuffer(HAND_SIZE))
    hand(view, 0, 42, 1)

    const read = readHand(view)

    expect(read).toMatchObject({ id: 42, side: 'right', grab: 0.75, pinch: 0.25 })
    expect(read.palm).toEqual([1.5, 200.3, -3])
    expect(read.velocity).toEqual([100, -200, 300])
    expect(read.normal).toEqual([0, -1, 0])
    expect(read.fingers.map((finger) => finger.extended)).toEqual([false, true, false, true, false])
  })

  it('reads a finger from the base of its metacarpal to its tip', () => {
    const view = new DataView(new ArrayBuffer(HAND_SIZE))
    hand(view, 0, 1, 0)

    expect(readHand(view).fingers[3].joints).toEqual([[3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [3, 4, 0]])
  })

  it('reads each hand of a frame, one after the other', () => {
    const view = new DataView(new ArrayBuffer(2 * HAND_SIZE))
    hand(view, 0, 1, 0)
    hand(view, HAND_SIZE, 2, 1)

    expect(readHand(view, 0)).toMatchObject({ id: 1, side: 'left' })
    expect(readHand(view, HAND_SIZE)).toMatchObject({ id: 2, side: 'right' })
  })
})

describe('readMessage', () => {
  it('reads the kind of event and where it is', () => {
    const message = Buffer.alloc(MESSAGE_SIZE)
    message.writeUInt32LE(MESSAGE_SIZE, 0)
    message.writeInt32LE(EVENT_TRACKING, 4)
    message.writeBigUInt64LE(0x7f00_1234_5678n, 8)

    expect(readMessage(message)).toEqual({ type: EVENT_TRACKING, event: 0x7f00_1234_5678n })
  })
})

describe('readTrackingEvent', () => {
  const event = (count: number, hands: bigint) => {
    const view = new DataView(new ArrayBuffer(TRACKING_EVENT_SIZE))
    view.setUint32(32, count, true)
    view.setBigUint64(36, hands, true)
    return view
  }

  it('reads how many hands a frame holds, and where', () => {
    expect(readTrackingEvent(event(2, 0x1000n))).toEqual({ count: 2, hands: 0x1000n })
    expect(readTrackingEvent(event(0, 0n))).toEqual({ count: 0, hands: 0n })
  })

  it('turns down what no tracking event reads as', () => {
    expect(readTrackingEvent(event(1, 0n))).toBeNull()
    expect(readTrackingEvent(event(4_000_000, 0x1000n))).toBeNull()
  })
})
