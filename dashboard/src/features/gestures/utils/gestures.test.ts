import { describe, expect, it } from 'vitest'
import { HandFrameSchema } from '../api/hand-frame'
import { readEnabled, writeEnabled } from './enabled'
import { FIST, hand, ON_EDGE, THUMB_DOWN, THUMB_UP } from './fixtures'
import { type Action, type Gestures, HOLD, interpret, NO_GESTURE, read, SETTLE, SWIPE_REST, SWIPE_SPEED } from './interpret'
import { poseOf } from './pose'
import { axis, DEAD_ZONE, FULL, NEUTRAL, steerOf, windOf } from './steer'

describe('HandFrameSchema', () => {
  it('takes a frame of hands as the bridge sends it, and an empty one', () => {
    expect(HandFrameSchema.safeParse({ v: 1, hands: [hand()] }).success).toBe(true)
    expect(HandFrameSchema.safeParse({ v: 1, hands: [] }).success).toBe(true)
  })

  it('turns down another version, and a hand short of a finger', () => {
    const short = { ...hand(), fingers: hand().fingers.slice(0, 4) }

    expect(HandFrameSchema.safeParse({ v: 2, hands: [] }).success).toBe(false)
    expect(HandFrameSchema.safeParse({ v: 1, hands: [short] }).success).toBe(false)
  })
})

describe('poseOf', () => {
  it('takes an open hand, palm down, for a flat one', () => {
    expect(poseOf(hand())).toBe('flat')
  })

  it('still does with a finger the sensor lost', () => {
    expect(poseOf(hand({ out: [true, true, true, false, true] }))).toBe('flat')
    expect(poseOf(hand({ out: [false, true, true, true, true] }))).toBe('flat')
  })

  it('takes an open hand on its edge for one that turns a page, whichever way it faces', () => {
    expect(poseOf(hand(ON_EDGE))).toBe('edge')
    expect(poseOf(hand({ normal: [1, 0, 0] }))).toBe('edge')
  })

  it('takes a closed hand for a fist, its thumb folded over or held level', () => {
    expect(poseOf(hand(FIST))).toBe('fist')
    expect(poseOf(hand({ out: [true, false, false, false, false], thumb: [-1, 0, 0] }))).toBe('fist')
  })

  it('reads a thumb up and a thumb down, the other fingers closed', () => {
    expect(poseOf(hand(THUMB_UP))).toBe('thumb-up')
    expect(poseOf(hand(THUMB_DOWN))).toBe('thumb-down')
  })

  it('reads no thumb in one that leans too far from the vertical', () => {
    expect(poseOf(hand({ ...THUMB_UP, thumb: [-0.8, 0.6, 0] }))).toBe('fist')
  })

  it('reads nothing in a hand that points, in one that closes, in one that faces up', () => {
    expect(poseOf(hand({ out: [false, true, false, false, false] }))).toBe('none')
    expect(poseOf(hand({ grab: 0.7 }))).toBe('none')
    expect(poseOf(hand({ normal: [0, 1, 0] }))).toBe('none')
  })
})

describe('steerOf', () => {
  const at = (x: number, y: number, z: number) => steerOf([NEUTRAL[0] + x, NEUTRAL[1] + y, NEUTRAL[2] + z])

  it('moves nothing at rest, nor anywhere in the dead zone', () => {
    expect(at(0, 0, 0)).toEqual({ turn: 0, tilt: 0, zoom: 0 })
    expect(at(DEAD_ZONE, -DEAD_ZONE, DEAD_ZONE)).toEqual({ turn: 0, tilt: 0, zoom: 0 })
  })

  it('turns with the hand to the side, tilts with it pulled back, zooms with it lowered', () => {
    expect(at(FULL.x, 0, 0)).toEqual({ turn: 1, tilt: 0, zoom: 0 })
    expect(at(-FULL.x, 0, 0).turn).toBe(-1)
    expect(at(0, 0, FULL.z).tilt).toBe(1)
    expect(at(0, -FULL.y, 0).zoom).toBe(1)
    expect(at(0, FULL.y, 0).zoom).toBe(-1)
  })

  it('goes no faster past full, and starts slowly out of the dead zone', () => {
    expect(at(3 * FULL.x, 0, 0).turn).toBe(1)
    expect(axis(DEAD_ZONE + (FULL.x - DEAD_ZONE) / 2, FULL.x)).toBeCloseTo(0.25)
  })

  it('winds a replay with a fist to the side', () => {
    expect(windOf(NEUTRAL)).toBe(0)
    expect(windOf([NEUTRAL[0] + FULL.x, NEUTRAL[1], NEUTRAL[2]])).toBe(1)
    expect(windOf([NEUTRAL[0] - FULL.x, NEUTRAL[1], NEUTRAL[2]])).toBe(-1)
  })
})

// Plays hands through the interpreter, one frame every `step` seconds, and keeps what they asked for.
function play(frames: [seconds: number, shape: Parameters<typeof hand>[0] | null][], step = 0.05) {
  let gestures: Gestures = NO_GESTURE
  let now = 0
  const actions: Action[] = []
  let hands: ReturnType<typeof hand>[] = []
  for (const [seconds, shape] of frames) {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) {
      hands = shape ? [hand(shape)] : []
      const next = interpret(gestures, hands, now)
      gestures = next.gestures
      if (next.action) actions.push(next.action)
      now += step
    }
  }
  return { gestures, actions, reading: read(gestures, hands, now - step), now: now - step }
}

describe('interpret', () => {
  it('takes a pose for one only once it has lasted', () => {
    expect(play([[SETTLE / 2, {}]]).gestures.pose).toBe('none')
    expect(play([[SETTLE + 0.1, {}]]).gestures.pose).toBe('flat')
  })

  it('keeps the settled pose through a frame that shows another', () => {
    expect(play([[1, {}], [0.05, FIST]]).gestures.pose).toBe('flat')
    expect(play([[1, {}], [SETTLE + 0.1, FIST]]).gestures.pose).toBe('fist')
  })

  it('steers with a flat hand, and with nothing else', () => {
    const palm: [number, number, number] = [NEUTRAL[0] + FULL.x, NEUTRAL[1], NEUTRAL[2]]

    expect(play([[1, { palm }]]).reading.steer).toEqual({ turn: 1, tilt: 0, zoom: 0 })
    expect(play([[1, { ...FIST, palm }]]).reading).toMatchObject({ steer: null, wind: 1 })
    expect(play([[1, { ...THUMB_UP, palm }]]).reading.steer).toBeNull()
    expect(play([[1, {}], [0.2, null]]).reading.steer).toBeNull()
  })

  it('silences the Alarm once a thumb has been held up long enough, and only once', () => {
    expect(play([[SETTLE + HOLD - 0.2, THUMB_UP]]).actions).toEqual([])
    expect(play([[SETTLE + HOLD + 0.2, THUMB_UP]]).actions).toEqual(['all-clear'])
    expect(play([[SETTLE + 4 * HOLD, THUMB_UP]]).actions).toEqual(['all-clear'])
  })

  it('sounds it once a thumb has been held down long enough', () => {
    expect(play([[SETTLE + HOLD + 0.2, THUMB_DOWN]]).actions).toEqual(['alarm'])
  })

  it('says how far along the hold is, then that it is done', () => {
    const half = play([[SETTLE + HOLD / 2, THUMB_DOWN]]).reading.confirming
    const done = play([[SETTLE + 2 * HOLD, THUMB_DOWN]]).reading.confirming

    expect(half?.pose).toBe('thumb-down')
    expect(half?.progress).toBeGreaterThan(0.3)
    expect(half?.progress).toBeLessThan(0.7)
    expect(done).toEqual({ pose: 'thumb-down', progress: 1 })
  })

  it('does nothing about a thumb let go of in time', () => {
    expect(play([[SETTLE + HOLD / 2, THUMB_DOWN], [1, {}]]).actions).toEqual([])
  })

  it('starts the hold over when the thumb turns over', () => {
    const turned = play([[SETTLE + HOLD - 0.3, THUMB_UP], [SETTLE + HOLD - 0.3, THUMB_DOWN]])

    expect(turned.actions).toEqual([])
    expect(play([[SETTLE + HOLD - 0.3, THUMB_UP], [SETTLE + HOLD + 0.2, THUMB_DOWN]]).actions).toEqual(['alarm'])
  })

  it('acts again on a thumb raised again', () => {
    const twice = play([[SETTLE + HOLD + 0.2, THUMB_UP], [0.5, {}], [SETTLE + HOLD + 0.2, THUMB_UP]])

    expect(twice.actions).toEqual(['all-clear', 'all-clear'])
  })

  it('holds nothing over from a hand that left', () => {
    const left = play([[SETTLE + HOLD - 0.2, THUMB_DOWN], [0.1, null], [0.4, THUMB_DOWN]])

    expect(left.actions).toEqual([])
  })

  it('turns the page as a hand on its edge sweeps across, the way it goes', () => {
    expect(play([[0.1, { ...ON_EDGE, velocity: [-SWIPE_SPEED, 0, 0] }]]).actions).toEqual(['page-left'])
    expect(play([[0.1, { ...ON_EDGE, velocity: [SWIPE_SPEED, 0, 0] }]]).actions).toEqual(['page-right'])
  })

  it('turns one page a swipe, and none for the hand that comes back', () => {
    const back = play([
      [0.2, { ...ON_EDGE, velocity: [-2 * SWIPE_SPEED, 0, 0] }],
      [SWIPE_REST / 2, { ...ON_EDGE, velocity: [2 * SWIPE_SPEED, 0, 0] }],
    ])

    expect(back.actions).toEqual(['page-left'])
  })

  it('turns no page for a flat hand moved fast, nor for one on its edge moved slowly', () => {
    expect(play([[0.5, { velocity: [-3 * SWIPE_SPEED, 0, 0] }]]).actions).toEqual([])
    expect(play([[0.5, { ...ON_EDGE, velocity: [-SWIPE_SPEED / 2, 0, 0] }]]).actions).toEqual([])
  })

  it('follows the hand it saw first while a second one is over the sensor', () => {
    const first = hand({ id: 7, palm: [NEUTRAL[0] + FULL.x, NEUTRAL[1], NEUTRAL[2]] })
    const second = hand({ ...THUMB_DOWN, id: 9 })
    let gestures: Gestures = NO_GESTURE
    const actions: Action[] = []
    for (let now = 0; now < 3; now += 0.05) {
      const next = interpret(gestures, now < 0.5 ? [first] : [second, first], now)
      gestures = next.gestures
      if (next.action) actions.push(next.action)
    }

    expect(gestures).toMatchObject({ hand: 7, pose: 'flat' })
    expect(actions).toEqual([])
  })
})

describe('the hand control switch', () => {
  const storage = () => {
    const kept = new Map<string, string>()
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    }
  }

  it('is off until switched on, and stays as it was left', () => {
    const kept = storage()

    expect(readEnabled(kept)).toBe(false)
    writeEnabled(kept, true)
    expect(readEnabled(kept)).toBe(true)
    writeEnabled(kept, false)
    expect(readEnabled(kept)).toBe(false)
  })

  it('is off in a browser that keeps nothing', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => undefined,
    }

    expect(readEnabled(refusing)).toBe(false)
    expect(() => writeEnabled(refusing, true)).not.toThrow()
  })
})
