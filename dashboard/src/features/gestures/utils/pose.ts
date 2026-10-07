import type { Hand, Vec3 } from '../api/hand-frame'

// What a hand is doing, as far as the dashboard answers to it:
// - flat: open, palm down over the sensor. It steers the Twin's camera.
// - edge: open, on its edge like a hand that turns a page. Swept across, it changes screen.
// - fist: closed. It holds the camera still, and winds a replay back and forth.
// - thumb-up, thumb-down: the other fingers closed. Held, they silence the Alarm and sound it.
export type Pose = 'flat' | 'edge' | 'fist' | 'thumb-up' | 'thumb-down' | 'none'

// How much of a thumb's length must be up or down for it to say so: within 45° of the vertical.
export const THUMB_VERTICAL = 0.7
// Millimetres from the palm's centre to the tip of a thumb that sticks out: one folded over a fist is nearer.
export const THUMB_OUT = 70
// Of the palm's normal, for a hand to be flat over the sensor, or on its edge.
export const PALM_DOWN = 0.6
export const PALM_SIDEWAYS = 0.7
// Above this, a hand is closing: no longer an open one.
export const OPEN_GRAB = 0.5

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2])

export function poseOf(hand: Hand): Pose {
  const [thumb, ...others] = hand.fingers
  const out = others.filter((finger) => finger.extended).length

  if (out === 0) {
    // The thumb from its knuckle to its tip: its bearing says up or down, its reach that it is out at all.
    const along = minus(thumb.joints[4], thumb.joints[1])
    const reach = length(minus(thumb.joints[4], hand.palm))
    const vertical = along[1] / (length(along) || 1)
    if (reach >= THUMB_OUT && vertical >= THUMB_VERTICAL) return 'thumb-up'
    if (reach >= THUMB_OUT && vertical <= -THUMB_VERTICAL) return 'thumb-down'
    return 'fist'
  }

  // A finger or two the sensor lost is still an open hand; a hand that points is not.
  if (out < 3 || hand.grab > OPEN_GRAB) return 'none'
  if (hand.normal[1] <= -PALM_DOWN) return 'flat'
  if (Math.abs(hand.normal[0]) >= PALM_SIDEWAYS) return 'edge'
  return 'none'
}
