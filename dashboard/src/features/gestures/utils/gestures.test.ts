import { describe, expect, it } from 'vitest'
import { HandFrameSchema } from '../api/hand-frame'
import { readEnabled, writeEnabled } from './enabled'
import { AIMING, FIST, HAMMER_DROPPED, hand, ON_EDGE, THUMB_DOWN, THUMB_UP } from './fixtures'
import { type Action, CLOSEST_GAP, type Gestures, HOLD, interpret, NO_GESTURE, read, SETTLE, SHOT_REST, SWIPE_REST, SWIPE_SPEED } from './interpret'
import { HAMMER_BACK, HAMMER_DOWN, hammerOf, isOpen, poseOf } from './pose'
import { AIM, AIM_EDGE, aimOf, axis, DEAD_ZONE, FULL, gapOf, NEUTRAL, steerOf, windOf } from './steer'

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

  it('reads nothing in a hand that closes, in one that faces up, in one with two fingers out', () => {
    expect(poseOf(hand({ grab: 0.7 }))).toBe('none')
    expect(poseOf(hand({ normal: [0, 1, 0] }))).toBe('none')
    expect(poseOf(hand({ out: [false, true, true, false, false] }))).toBe('none')
  })

  it('takes the index out alone for a hand that aims, its thumb out or not', () => {
    expect(poseOf(hand(AIMING))).toBe('aim')
    expect(poseOf(hand(HAMMER_DROPPED))).toBe('aim')
    expect(poseOf(hand({ out: [false, false, true, false, false] }))).toBe('none')
  })

  it('tells an open hand whichever way it faces', () => {
    expect(isOpen(hand({ normal: [0, 1, 0] }))).toBe(true)
    expect(isOpen(hand({ out: [true, true, true, false, true] }))).toBe(true)
    expect(isOpen(hand(FIST))).toBe(false)
    expect(isOpen(hand({ grab: 0.7 }))).toBe(false)
  })

  it('reads the thumb of a hand that aims as a hammer, drawn back off the index or down along it', () => {
    expect(hammerOf(hand(AIMING))).toBeLessThanOrEqual(HAMMER_BACK)
    expect(hammerOf(hand(HAMMER_DROPPED))).toBeGreaterThanOrEqual(HAMMER_DOWN)
  })
})

describe('aimOf', () => {
  it('has the sight in the middle of the view with the index over the sensor, at its resting height', () => {
    expect(aimOf([0, AIM.rest, -80])).toEqual([0, 0])
  })

  it('moves it with the fingertip, to the side and up, and never off the view', () => {
    expect(aimOf([AIM.x / 2, AIM.rest + AIM.y / 2, 0])).toEqual([0.5, 0.5])
    expect(aimOf([-AIM.x / 2, AIM.rest - AIM.y / 2, 0])).toEqual([-0.5, -0.5])
    expect(aimOf([5 * AIM.x, AIM.rest - 5 * AIM.y, 0])).toEqual([AIM_EDGE, -AIM_EDGE])
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

// Plays one or two hands through the interpreter, one frame every 50 ms, and keeps what they asked for.
function playHands(frames: [seconds: number, shapes: Parameters<typeof hand>[0][]][]) {
  const step = 0.05
  let gestures: Gestures = NO_GESTURE
  let now = 0
  const actions: Action[] = []
  let hands: ReturnType<typeof hand>[] = []
  for (const [seconds, shapes] of frames) {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) {
      hands = shapes.map((shape, index) => hand({ id: index + 1, ...shape }))
      const next = interpret(gestures, hands, now)
      gestures = next.gestures
      if (next.action) actions.push(next.action)
      now += step
    }
  }
  return { gestures, actions, reading: read(gestures, hands, now - step) }
}

describe('two open hands', () => {
  const left = (x: number) => ({ palm: [-x, 200, 0] as [number, number, number], side: 'left' as const })
  const right = (x: number) => ({ palm: [x, 200, 0] as [number, number, number] })

  it('take hold of the view once they have settled, and steer nothing', () => {
    expect(playHands([[SETTLE / 2, [right(100), left(100)]]]).reading.stretch).toBeNull()

    const held = playHands([[1, [right(100), left(100)]]])
    expect(held.gestures.pose).toBe('spread')
    expect(held.reading).toMatchObject({ stretch: 1, steer: null, wind: null })
  })

  it('stretch it as they move apart, and shrink it as they come together', () => {
    expect(playHands([[1, [right(100), left(100)]], [0.5, [right(200), left(200)]]]).reading.stretch).toBeCloseTo(2)
    expect(playHands([[1, [right(100), left(100)]], [0.5, [right(50), left(50)]]]).reading.stretch).toBeCloseTo(0.5)
  })

  it('whichever way they face, palm to palm as well as flat', () => {
    const facing = playHands([[1, [{ ...right(100), normal: [-1, 0, 0] }, { ...left(100), normal: [1, 0, 0] }]]])

    expect(facing.reading.stretch).toBe(1)
  })

  it('turn no page as they move apart fast', () => {
    const apart = playHands([
      [1, [{ ...right(100), ...ON_EDGE }, { ...left(100), ...ON_EDGE }]],
      [0.2, [{ ...right(200), ...ON_EDGE, velocity: [2 * SWIPE_SPEED, 0, 0] }, { ...left(200), ...ON_EDGE, velocity: [-2 * SWIPE_SPEED, 0, 0] }]],
    ])

    expect(apart.actions).toEqual([])
  })

  it('hold nothing once one of them closes or leaves, and take hold anew from where they then are', () => {
    expect(playHands([[1, [right(100), left(100)]], [0.1, [right(100), { ...left(100), ...FIST }]]]).reading.stretch).toBeNull()
    expect(playHands([[1, [right(100), left(100)]], [1, [right(100)]]]).reading).toMatchObject({ stretch: null, steer: { tilt: 0, zoom: 0 } })

    const again = playHands([[1, [right(100), left(100)]], [0.5, [right(100)]], [1, [right(200), left(200)]]])
    expect(again.reading.stretch).toBe(1)
  })

  it('are never closer than touching', () => {
    const touching = playHands([[1, [right(100), left(100)]], [0.2, [right(0), left(0)]]])

    expect(touching.reading.stretch).toBeCloseTo(CLOSEST_GAP / 200)
    expect(gapOf([0, 0, 0], [3, 4, 0])).toBe(5)
  })
})

describe('a hand that aims', () => {
  const at = (x: number, y: number) => ({ palm: [x + 15, y, 125] as [number, number, number] })

  it('moves a sight over the view once it has settled, and steers nothing', () => {
    expect(play([[SETTLE / 2, AIMING]]).reading.aim).toBeNull()

    const aiming = play([[1, { ...AIMING, ...at(AIM.x / 2, AIM.rest) }]])
    expect(aiming.gestures.pose).toBe('aim')
    expect(aiming.reading.aim?.x).toBeCloseTo(0.5)
    expect(aiming.reading.aim?.y).toBeCloseTo(0)
    expect(aiming.reading.steer).toBeNull()
  })

  it('eases the sight to where the index goes', () => {
    const moved = play([[1, { ...AIMING, ...at(0, AIM.rest) }], [0.05, { ...AIMING, ...at(AIM.x / 2, AIM.rest) }]])
    const there = play([[1, { ...AIMING, ...at(0, AIM.rest) }], [1, { ...AIMING, ...at(AIM.x / 2, AIM.rest) }]])

    expect(moved.reading.aim?.x).toBeGreaterThan(0.1)
    expect(moved.reading.aim?.x).toBeLessThan(0.4)
    expect(there.reading.aim?.x).toBeCloseTo(0.5)
  })

  it('cocks as the thumb is drawn back, and fires once as it comes down', () => {
    const cocked = play([[1, AIMING]])
    const fired = play([[1, AIMING], [0.5, HAMMER_DROPPED]])

    expect(cocked.reading).toMatchObject({ aim: { cocked: true }, shot: null })
    expect(fired.reading.aim?.cocked).toBe(false)
    expect(fired.reading.shot?.at).toBeCloseTo(1)
  })

  it('fires where the sight was, from the tip of the index', () => {
    const fired = play([[1, { ...AIMING, ...at(AIM.x / 2, AIM.rest) }], [0.2, { ...HAMMER_DROPPED, ...at(AIM.x / 2, AIM.rest) }]])

    expect(fired.reading.shot?.x).toBeCloseTo(0.5)
    expect(fired.reading.shot?.y).toBeCloseTo(0)
    expect(fired.reading.shot?.from[0]).toBeCloseTo(AIM.x / 2)
  })

  it('fires nothing with a thumb that was never drawn back', () => {
    expect(play([[2, HAMMER_DROPPED]]).reading.shot).toBeNull()
  })

  it('fires again once cocked again, and no faster than a shot at a time', () => {
    const twice = play([[1, AIMING], [0.2, HAMMER_DROPPED], [SHOT_REST, AIMING], [0.2, HAMMER_DROPPED]])
    const hasty = play([[1, AIMING], [0.05, HAMMER_DROPPED], [0.05, AIMING], [0.05, HAMMER_DROPPED]])

    expect(twice.reading.shot?.at).toBeCloseTo(1.2 + SHOT_REST)
    expect(hasty.reading.shot?.at).toBeCloseTo(1)
  })

  it('keeps its sight and its hammer through a frame that shows another pose', () => {
    const through = play([[1, AIMING], [0.05, FIST], [0.05, AIMING]])

    expect(through.reading.aim?.cocked).toBe(true)
    expect(through.reading.shot).toBeNull()
  })

  it('has no sight left once it opens, and asks for nothing', () => {
    const opened = play([[1, AIMING], [0.2, HAMMER_DROPPED], [1, {}]])

    expect(opened.reading.aim).toBeNull()
    expect(opened.actions).toEqual([])
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
