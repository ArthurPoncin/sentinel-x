import { describe, expect, it } from 'vitest'
import { hand, THUMB_DOWN } from '../utils/fixtures'
import { type Action, HOLD, SETTLE } from '../utils/interpret'
import { createHandStore, HANDS_OFF, STALE } from './hand-store'

// A store with its bridge open, fed `shape` every 50 ms for `seconds`.
function fed(shape: Parameters<typeof hand>[0] | null, seconds: number) {
  const store = createHandStore()
  const actions: Action[] = []
  store.onAction((action) => actions.push(action))
  store.dispatch({ type: 'bridge', state: 'open' }, 0)
  let now = 0
  for (; now < seconds; now += 0.05) store.dispatch({ type: 'hands', hands: shape ? [hand(shape)] : [] }, now)
  return { store, actions, now: now - 0.05 }
}

describe('the hand store', () => {
  it('is off until the bridge is looked for', () => {
    const store = createHandStore()

    expect(store.getState()).toEqual(HANDS_OFF)
    store.dispatch({ type: 'bridge', state: 'connecting' }, 0)
    expect(store.getState().bridge).toBe('connecting')
  })

  it('says the sensor tracks once frames come, a hand or not', () => {
    const { store } = fed(null, 0.2)

    expect(store.getState()).toMatchObject({ bridge: 'open', tracking: true, present: false, pose: 'none' })
  })

  it('shows the hand and the pose it settled in', () => {
    const { store, now } = fed({}, SETTLE + 0.2)

    expect(store.getState()).toMatchObject({ tracking: true, present: true, pose: 'flat' })
    expect(store.hands(now)).toHaveLength(1)
    expect(store.reading(now).steer).toEqual({ turn: 0, tilt: 0, zoom: 0 })
  })

  it('tells of an action once, and shows the thumb acted on', () => {
    const { store, actions } = fed(THUMB_DOWN, SETTLE + HOLD + 0.3)

    expect(actions).toEqual(['alarm'])
    expect(store.getState().confirming).toEqual({ pose: 'thumb-down', fired: true })
  })

  it('lets go of a hand once frames stop coming', () => {
    const { store, now } = fed({}, 1)

    store.tick(now + STALE + 0.1)

    expect(store.getState()).toMatchObject({ bridge: 'open', tracking: false, present: false, pose: 'none' })
    expect(store.hands(now + STALE + 0.1)).toEqual([])
    expect(store.reading(now + STALE + 0.1).steer).toBeNull()
  })

  it('holds nothing over a gap in the frames', () => {
    const { store, actions, now } = fed(THUMB_DOWN, SETTLE + HOLD - 0.2)

    for (let later = now + 2; later < now + 2.4; later += 0.05) {
      store.dispatch({ type: 'hands', hands: [hand(THUMB_DOWN)] }, later)
    }

    expect(actions).toEqual([])
  })

  it('forgets the hand when the bridge goes down', () => {
    const { store, now } = fed({}, 1)

    store.dispatch({ type: 'bridge', state: 'closed' }, now)

    expect(store.getState()).toMatchObject({ bridge: 'closed', tracking: false, present: false })
    expect(store.hands(now)).toEqual([])
  })

  it('only wakes its listeners when what it shows changes', () => {
    const store = createHandStore()
    let woken = 0
    store.subscribe(() => woken++)
    store.dispatch({ type: 'bridge', state: 'open' }, 0)
    for (let now = 0; now < 2; now += 0.05) store.dispatch({ type: 'hands', hands: [hand()] }, now)

    // The bridge opening, the frames and the hand coming, the pose settling.
    expect(woken).toBe(3)
  })

  it('is off again once reset, and takes no late frame for a hand', () => {
    const { store, now } = fed({}, 1)

    store.reset()
    store.dispatch({ type: 'hands', hands: [hand()] }, now + 0.05)

    expect(store.getState()).toEqual(HANDS_OFF)
    expect(store.hands(now + 0.05)).toEqual([])
  })
})
