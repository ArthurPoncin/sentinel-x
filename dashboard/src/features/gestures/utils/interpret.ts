import type { Hand } from '../api/hand-frame'
import { type Pose, poseOf } from './pose'
import { type Steer, steerOf, windOf } from './steer'

// Seconds a pose must last before the dashboard takes it for one: a hand passes through others on its way.
export const SETTLE = 0.2
// Seconds a thumb must then be held, up or down, before it is acted on: long enough to be meant, and to let
// go of in time.
export const HOLD = 1.2
// Millimetres a second across the sensor, for a hand on its edge to turn the page.
export const SWIPE_SPEED = 700
// Seconds before another page can be turned: the hand that comes back is not a second swipe.
export const SWIPE_REST = 1

// What a gesture asks for, once: the Alarm silenced or sounded, the screen to the left or to the right.
export type Action = 'all-clear' | 'alarm' | 'page-left' | 'page-right'
export type Confirming = 'thumb-up' | 'thumb-down'

// What the hands are taken to mean from one frame to the next. Times are seconds on a clock that only goes
// forward.
export interface Gestures {
  // The hand followed, by the sensor's id, and the pose it settled in.
  hand: number | null
  pose: Pose
  // The pose it shows now, and since when: it becomes `pose` once it has lasted SETTLE.
  showing: Pose
  since: number
  // Since when a thumb is held, and whether it was acted on: one action per thumb raised.
  held: { since: number; fired: boolean } | null
  swipedAt: number
}

export const NO_GESTURE: Gestures = { hand: null, pose: 'none', showing: 'none', since: 0, held: null, swipedAt: -Infinity }

// What the dashboard does about the hands at an instant.
export interface Reading {
  // How the camera is steered, null when no flat hand steers it.
  steer: Steer | null
  // How fast a replay is wound, -1 to 1, null when no fist winds it.
  wind: number | null
  // The thumb being held, and how far along its hold is, 0 to 1.
  confirming: { pose: Confirming; progress: number } | null
}

const isThumb = (pose: Pose): pose is Confirming => pose === 'thumb-up' || pose === 'thumb-down'

// The hand to follow: the one already followed while the sensor still sees it, the first it saw otherwise.
function followed(hands: readonly Hand[], id: number | null): Hand | undefined {
  return hands.find((hand) => hand.id === id) ?? [...hands].sort((a, b) => a.id - b.id)[0]
}

// The gestures after a frame of hands at `now`, and what they ask for at that instant, if anything.
export function interpret(before: Gestures, hands: readonly Hand[], now: number): { gestures: Gestures; action: Action | null } {
  const hand = followed(hands, before.hand)
  if (!hand) return { gestures: { ...NO_GESTURE, swipedAt: before.swipedAt }, action: null }

  const showing = poseOf(hand)
  // Another hand starts over: what the last one was doing is not this one's.
  const same = hand.id === before.hand
  const since = same && showing === before.showing ? before.since : now
  const pose = now - since >= SETTLE ? showing : same ? before.pose : 'none'
  let held = isThumb(pose) ? (pose === before.pose && before.held ? before.held : { since: now, fired: false }) : null
  let swipedAt = before.swipedAt
  let action: Action | null = null

  if (held && !held.fired && isThumb(pose) && now - held.since >= HOLD) {
    held = { ...held, fired: true }
    action = pose === 'thumb-up' ? 'all-clear' : 'alarm'
  }
  // A swipe is over before it settles: the hand on its edge as it goes by is enough.
  if (showing === 'edge' && Math.abs(hand.velocity[0]) >= SWIPE_SPEED && now - swipedAt >= SWIPE_REST) {
    swipedAt = now
    action = hand.velocity[0] < 0 ? 'page-left' : 'page-right'
  }

  return { gestures: { hand: hand.id, pose, showing, since, held, swipedAt }, action }
}

// What the settled gestures do at `now`, for as long as they last.
export function read(gestures: Gestures, hands: readonly Hand[], now: number): Reading {
  const hand = hands.find(({ id }) => id === gestures.hand)
  const { pose, held } = gestures
  return {
    steer: hand && pose === 'flat' ? steerOf(hand.palm) : null,
    wind: hand && pose === 'fist' ? windOf(hand.palm) : null,
    confirming:
      held && isThumb(pose) ? { pose, progress: held.fired ? 1 : Math.min(1, Math.max(0, (now - held.since) / HOLD)) } : null,
  }
}
