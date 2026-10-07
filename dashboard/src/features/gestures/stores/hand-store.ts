import type { BridgeState, HandEvent } from '../api/hand-client'
import type { Hand } from '../api/hand-frame'
import { type Action, type Confirming, type Gestures, interpret, NO_GESTURE, read, type Reading } from '../utils/interpret'
import type { Pose } from '../utils/pose'

// Seconds without a frame after which the sensor is taken to see nothing any more: unplugged, covered, or its
// bridge stopped. A hand left in mid-air would otherwise steer for ever.
export const STALE = 0.5

// What the interface shows of the hand control: it changes a few times a second at most. What changes with
// every frame, where the hand is and how far it steers, is read on demand with `hands` and `reading`.
export interface HandState {
  // Where the bridge's socket is, 'off' while the hand control is.
  bridge: BridgeState | 'off'
  // Whether the sensor sends frames, with or without a hand in them.
  tracking: boolean
  // Whether it sees a hand, and the pose that hand settled in.
  present: boolean
  pose: Pose
  // The thumb being held, and whether it was acted on.
  confirming: { pose: Confirming; fired: boolean } | null
}

export const HANDS_OFF: HandState = { bridge: 'off', tracking: false, present: false, pose: 'none', confirming: null }

const NOTHING: Reading = { steer: null, wind: null, confirming: null }
const NO_HANDS: readonly Hand[] = []

export interface HandStore {
  getState(): HandState
  subscribe(listener: () => void): () => void
  // Takes what the bridge sends, at `now` in seconds on a clock that only goes forward.
  dispatch(event: HandEvent, now: number): void
  // Called now and then while nothing comes: notices the frames that stopped coming.
  tick(now: number): void
  // Back to 'off', as the hand control is switched off.
  reset(): void
  // The hands of the last frame, none once it is stale.
  hands(now: number): readonly Hand[]
  reading(now: number): Reading
  // Told of each action a gesture asks for, once.
  onAction(listener: (action: Action) => void): () => void
}

export function createHandStore(): HandStore {
  let state = HANDS_OFF
  let hands: readonly Hand[] = NO_HANDS
  let gestures: Gestures = NO_GESTURE
  let frameAt = -Infinity
  const listeners = new Set<() => void>()
  const actionListeners = new Set<(action: Action) => void>()

  const same = (a: HandState, b: HandState) =>
    a.bridge === b.bridge &&
    a.tracking === b.tracking &&
    a.present === b.present &&
    a.pose === b.pose &&
    a.confirming?.pose === b.confirming?.pose &&
    a.confirming?.fired === b.confirming?.fired

  const show = (bridge: HandState['bridge'], now: number) => {
    const fresh = now - frameAt < STALE
    const next: HandState = {
      bridge,
      tracking: fresh,
      present: fresh && gestures.hand !== null,
      pose: fresh ? gestures.pose : 'none',
      confirming:
        fresh && gestures.held && (gestures.pose === 'thumb-up' || gestures.pose === 'thumb-down')
          ? { pose: gestures.pose, fired: gestures.held.fired }
          : null,
    }
    if (same(state, next)) return
    state = next
    for (const listener of listeners) listener()
  }

  const forget = () => {
    hands = NO_HANDS
    gestures = NO_GESTURE
    frameAt = -Infinity
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch(event, now) {
      if (event.type === 'bridge') {
        if (event.state !== 'open') forget()
        return show(event.state, now)
      }
      // A frame that comes after the hand control was switched off is nobody's.
      if (state.bridge === 'off') return
      // A hand that comes back after a gap starts over: nothing is held across it.
      const before = now - frameAt < STALE ? gestures : { ...NO_GESTURE, swipedAt: gestures.swipedAt }
      const next = interpret(before, event.hands, now)
      hands = event.hands
      gestures = next.gestures
      frameAt = now
      show(state.bridge, now)
      if (next.action) for (const listener of actionListeners) listener(next.action)
    },
    tick(now) {
      if (state.bridge !== 'off') show(state.bridge, now)
    },
    reset() {
      forget()
      show('off', 0)
    },
    hands: (now) => (now - frameAt < STALE ? hands : NO_HANDS),
    reading: (now) => (now - frameAt < STALE ? read(gestures, hands, now) : NOTHING),
    onAction(listener) {
      actionListeners.add(listener)
      return () => actionListeners.delete(listener)
    },
  }
}
