import type { Hand, Vec3 } from '../api/hand-frame'
import { HAMMER_BACK, HAMMER_DOWN, hammerOf, isOpen, type Pose, poseOf } from './pose'
import { aimOf, gapOf, type Steer, steerOf, windOf } from './steer'

// Seconds a pose must last before the dashboard takes it for one: a hand passes through others on its way.
export const SETTLE = 0.2
// Seconds a thumb must then be held, up or down, before it is acted on: long enough to be meant, and to let
// go of in time.
export const HOLD = 1.2
// Millimetres a second across the sensor, for a hand on its edge to turn the page.
export const SWIPE_SPEED = 700
// Seconds before another page can be turned: the hand that comes back is not a second swipe.
export const SWIPE_REST = 1
// The share of the way to where the index is that the sight goes in a second, eased: a fingertip trembles, and
// jumps as the thumb comes down.
export const AIM_PULL = 14
// Seconds between two shots, at the least.
export const SHOT_REST = 0.3
// Millimetres between two palms under which they are taken for touching: nothing is zoomed from there.
export const CLOSEST_GAP = 40

// What a gesture asks for, once: the Alarm silenced or sounded, the screen to the left or to the right.
export type Action = 'all-clear' | 'alarm' | 'page-left' | 'page-right'
export type Confirming = 'thumb-up' | 'thumb-down'

// A shot: when, where the sight was in the view (each from -1 to 1) and where the tip of the index was over
// the sensor.
export interface Shot {
  at: number
  x: number
  y: number
  from: Vec3
}

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
  // When the last frame came: what is eased goes by the time since.
  at: number
  // How far apart the two hands were as they took hold of the view, and how far they were last seen, in
  // millimetres.
  grip: number | null
  apart: number | null
  // Where the sight is, eased, and whether the thumb is drawn back: it has to be, to come down.
  aim: { x: number; y: number; cocked: boolean } | null
  // The last shot of the hand followed.
  shot: Shot | null
}

export const NO_GESTURE: Gestures = {
  hand: null,
  pose: 'none',
  showing: 'none',
  since: 0,
  held: null,
  swipedAt: -Infinity,
  at: 0,
  grip: null,
  apart: null,
  aim: null,
  shot: null,
}

// What the dashboard does about the hands at an instant.
export interface Reading {
  // How the camera is steered, null when no flat hand steers it.
  steer: Steer | null
  // How fast a replay is wound, -1 to 1, null when no fist winds it.
  wind: number | null
  // The thumb being held, and how far along its hold is, 0 to 1.
  confirming: { pose: Confirming; progress: number } | null
  // How far apart two open hands are for how far they were as they took hold: over 1 moved apart, under it
  // brought together. Null when they hold nothing.
  stretch: number | null
  // Where a hand that aims has its sight in the view, each from -1 to 1, whether its thumb is drawn back, and
  // where the tip of its index is over the sensor.
  aim: { x: number; y: number; cocked: boolean; from: Vec3 } | null
  // The last shot, for whoever shows it: a new one is told by its time.
  shot: Shot | null
}

const isThumb = (pose: Pose): pose is Confirming => pose === 'thumb-up' || pose === 'thumb-down'

// The hand to follow: the one already followed while the sensor still sees it, the first it saw otherwise.
function followed(hands: readonly Hand[], id: number | null): Hand | undefined {
  return hands.find((hand) => hand.id === id) ?? [...hands].sort((a, b) => a.id - b.id)[0]
}

// How far apart two open hands are, null unless the sensor sees just that: two hands, both open.
function spread(hands: readonly Hand[]): number | null {
  const [one, other] = hands
  if (hands.length !== 2 || !one || !other || !isOpen(one) || !isOpen(other)) return null
  return Math.max(CLOSEST_GAP, gapOf(one.palm, other.palm))
}

// The sight after a frame of a hand that aims, and the shot it fired on it, if any. The thumb drawn back off
// the index cocks it; brought down along the index, it fires once.
function aimed(before: Gestures, hand: Hand, now: number): Pick<Gestures, 'aim' | 'shot'> {
  const tip = hand.fingers[1].joints[4]
  const [x, y] = aimOf(tip)
  const share = before.aim ? 1 - Math.exp(-AIM_PULL * Math.max(0, now - before.at)) : 1
  const from = before.aim ?? { x, y, cocked: false }
  const aim = { x: from.x + (x - from.x) * share, y: from.y + (y - from.y) * share, cocked: from.cocked }
  const hammer = hammerOf(hand)

  if (hammer <= HAMMER_BACK) return { aim: { ...aim, cocked: true }, shot: before.shot }
  if (aim.cocked && hammer >= HAMMER_DOWN && now - (before.shot?.at ?? -Infinity) >= SHOT_REST) {
    // Where the sight was before the thumb moved the hand: the eased one, not this frame's.
    return { aim: { ...aim, cocked: false }, shot: { at: now, x: aim.x, y: aim.y, from: tip } }
  }
  return { aim, shot: before.shot }
}

// The gestures after a frame of hands at `now`, and what they ask for at that instant, if anything.
export function interpret(before: Gestures, hands: readonly Hand[], now: number): { gestures: Gestures; action: Action | null } {
  const hand = followed(hands, before.hand)
  if (!hand) return { gestures: { ...NO_GESTURE, swipedAt: before.swipedAt, at: now }, action: null }

  // Two open hands are one gesture, whatever each would be alone.
  const gap = spread(hands)
  const showing = gap !== null ? 'spread' : poseOf(hand)
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
  // A swipe is over before it settles: the hand on its edge as it goes by is enough. Not with a second hand
  // over the sensor: two hands moved apart are no swipe.
  if (hands.length === 1 && showing === 'edge' && Math.abs(hand.velocity[0]) >= SWIPE_SPEED && now - swipedAt >= SWIPE_REST) {
    swipedAt = now
    action = hand.velocity[0] < 0 ? 'page-left' : 'page-right'
  }
  // The two hands take hold of the view as they settle, at the gap they then have. A frame that loses one of
  // them on the way lets go of nothing: the view stays where they last held it.
  const grip = pose === 'spread' ? (same && before.pose === 'spread' && before.grip ? before.grip : gap) : null
  const apart = grip !== null ? (gap ?? before.apart) : null
  // A frame that shows another pose on the way moves neither the sight nor the hammer.
  const kept = same && before.pose === 'aim' ? before : { ...before, aim: null, shot: same ? before.shot : null }
  const { aim, shot } = pose !== 'aim' ? { aim: null, shot: kept.shot } : showing === 'aim' ? aimed(kept, hand, now) : kept

  return { gestures: { hand: hand.id, pose, showing, since, held, swipedAt, at: now, grip, apart, aim, shot }, action }
}

// What the settled gestures do at `now`, for as long as they last.
export function read(gestures: Gestures, hands: readonly Hand[], now: number): Reading {
  const hand = hands.find(({ id }) => id === gestures.hand)
  const { pose, held, grip, apart, aim, shot } = gestures
  return {
    steer: hand && pose === 'flat' ? steerOf(hand.palm) : null,
    wind: hand && pose === 'fist' ? windOf(hand.palm) : null,
    confirming:
      held && isThumb(pose) ? { pose, progress: held.fired ? 1 : Math.min(1, Math.max(0, (now - held.since) / HOLD)) } : null,
    stretch: grip !== null && apart !== null ? apart / grip : null,
    aim: hand && aim ? { ...aim, from: hand.fingers[1].joints[4] } : null,
    shot,
  }
}
