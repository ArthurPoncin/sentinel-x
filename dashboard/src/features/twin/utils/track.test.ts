import { describe, expect, it } from 'vitest'
import { FADE_SECONDS } from './fade'
import { type GroundPoint, standingPoint } from './site'
import {
  figurineLevel,
  type Intrusion,
  LAST_KNOWN_SECONDS,
  lastKnown,
  MOST_FIGURINES,
  marksLevel,
  NO_TRACKS,
  SET_OFF,
  SIGHTING,
  type Sighting,
  type Track,
  trackAt,
  tracksAt,
  UNHURRIED,
} from './track'

const FRAME = 1 / 60

// A place on the ground `x` along a line the tests walk the figurine on, or anywhere else when `z` is given.
const place = (x: number, z = 2): GroundPoint => ({ x, z })
const between = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z)

// Someone the camera sees at `x` along that line.
const seen = (key: string, x: number, alertId = 'a1') => ({ alertId, key, at: place(x), followed: true })

// A figurine at rest where the camera sees it, shown for `age` seconds.
const standing = (key: string, x: number, age = 0, alertId = 'a1'): Track => ({
  alertId,
  key,
  seen: true,
  followed: true,
  at: place(x),
  age,
  sighted: place(x),
  since: age,
  pace: 0,
  course: 0,
  walked: 0,
  walking: 0,
  lost: 0,
})

// Plays `seconds` of frames from `track` with the camera seeing its person at `at`, and returns the figurine
// on each.
function playTo(track: Track, at: GroundPoint, seconds: number, rate = 60): Track[] {
  const shown: Track[] = []
  let last = track
  for (let frame = 0; frame < Math.round(seconds * rate); frame++) {
    last = trackAt(last, { alertId: last.alertId, key: last.key, at, followed: last.followed }, 1 / rate) ?? last
    shown.push(last)
  }
  return shown
}

const play = (track: Track, x: number, seconds: number, rate = 60) => playTo(track, place(x), seconds, rate)

const last = (shown: Track[]): Track => shown[shown.length - 1] as Track

// Plays `seconds` of frames from `track` with the camera no longer seeing its person, and returns what is
// left of the figurine on each: null once there is nothing.
function lose(track: Track, seconds: number, rate = 60): (Track | null)[] {
  const left: (Track | null)[] = []
  let now: Track | null = track
  for (let frame = 0; frame < Math.round(seconds * rate); frame++) {
    now = trackAt(now, null, 1 / rate)
    left.push(now)
  }
  return left
}

// The figurine `seconds` after it was last seen.
const lostFor = (track: Track, seconds: number, rate = 60) => lose(track, seconds, rate).at(-1) ?? null

// Toward growing x, and the other way: the bearings the figurine walks along on the tests' line.
const [RIGHT, LEFT] = [Math.PI / 2, -Math.PI / 2]

// The mock feed's intruder (backend/src/mock-feed.ts): where the camera sees it across its image, how tall and
// how far turned, one sighting a second, cleared a second after the last.
const MOCK = [
  { x_norm: 0.886, h_norm: 0.3, pan: 0 },
  { x_norm: 0.439, h_norm: 0.36, pan: 14 },
  { x_norm: 0.439, h_norm: 0.46, pan: -2 },
  { x_norm: 0.439, h_norm: 0.66, pan: -20 },
] as const
const mockPlace = ({ x_norm, h_norm, pan }: (typeof MOCK)[number]) => standingPoint(x_norm, (pan * Math.PI) / 180, h_norm)

// The figurine on every frame of the mock feed's intrusion, until it is cleared.
function crossing(rate = 60): Track[] {
  const [first] = MOCK
  const shown: Track[] = [trackAt(null, { alertId: 'a1', key: 'intruder', at: mockPlace(first), followed: true }, 1 / rate) as Track]
  for (const sighting of MOCK) shown.push(...playTo(last(shown), mockPlace(sighting), 1, rate))
  return shown
}

describe("the intruder's track", () => {
  it('is nothing until an intruder is seen', () => {
    expect(trackAt(null, null, FRAME)).toBeNull()
  })

  it('stands the figurine where someone newly seen is, at rest, without walking there', () => {
    expect(trackAt(null, seen('p1', 0.55), FRAME)).toEqual(standing('p1', 0.55))
  })

  it('stays where it stands while the camera sees them at the same place', () => {
    const shown = play(standing('p1', 0.55), 0.55, 2)

    expect(shown.every(({ at, walked, walking }) => at.x === 0.55 && at.z === 2 && !walked && !walking)).toBe(true)
  })

  it('stays where it last stood once they are no longer seen, so the figurine fades out there', () => {
    const shown = last(play(standing('p1', 0.3, 3), 0.62, 0.5))
    const cleared = trackAt(shown, null, FRAME)

    expect(cleared).toEqual({ ...shown, seen: false, walking: expect.any(Number), lost: 0 })
    expect(trackAt(cleared, null, FRAME)?.at).toEqual(shown.at)
  })

  it('does not walk from where a previous intruder stood, even one seen again under the same key', () => {
    const cleared = trackAt(last(play(standing('p1', 0.55, 3), 0.75, 0.5)), null, FRAME)
    expect(trackAt(cleared, seen('p1', 0.15), FRAME)).toEqual(standing('p1', 0.15))
  })

  it('stands the figurine where another Alert, or another person of the same one, is seen', () => {
    const walking = last(play(standing('p1', 0.2, 3), 0.4, 0.5))

    expect(trackAt(walking, seen('p1', 0.7, 'a2'), FRAME)).toEqual(standing('p1', 0.7, 0, 'a2'))
    expect(trackAt(walking, seen('p2', 0.7), FRAME)).toEqual(standing('p2', 0.7))
  })

  it('ages with the time it has been shown, wherever its person goes, so its sweep plays once', () => {
    let shown = trackAt(null, seen('p1', 0.15), FRAME)
    expect(shown?.age).toBe(0)

    for (let frame = 0; frame < 60; frame++) shown = trackAt(shown, seen('p1', frame < 30 ? 0.15 : 0.35), FRAME)
    expect(shown?.age).toBeCloseTo(1)
  })

  it('no longer ages once they are no longer seen, and does not go back when the clock does', () => {
    const cleared = trackAt(standing('p1', 0.62, 0.3), null, 1)
    expect(cleared?.age).toBe(0.3)

    const walking = last(play(standing('p1', 0.3, 1), 0.62, 0.3))
    const back = trackAt(walking, seen('p1', 0.62), -1)
    expect(back?.age).toBe(walking.age)
    expect(back?.at).toEqual(walking.at)
    expect(back?.walked).toBe(walking.walked)
  })

  it('says whether its person is the one the camera follows, as the Alert tells it', () => {
    const other = trackAt(null, { ...seen('p2', 0.4), followed: false }, FRAME)
    expect(other?.followed).toBe(false)
    // The one before them left: the camera follows this one now, and its figurine is the same.
    const handed = trackAt(other, seen('p2', 0.4), FRAME)
    expect(handed).toEqual({ ...other, followed: true, age: FRAME, since: FRAME })
  })
})

describe("the figurine's walk to where its person was seen", () => {
  it('walks there, it does not jump: no frame covers more than a tenth of the way', () => {
    const shown = play(standing('p1', 0.15, 1), 0.35, 1)
    const steps = shown.map(({ at }, frame) => at.x - (shown[frame - 1]?.at.x ?? 0.15))

    expect(shown[0]?.at.x).toBeGreaterThan(0.15)
    expect(shown[0]?.at.x).toBeLessThan(0.35)
    expect(Math.max(...steps)).toBeLessThan(0.1 * (0.35 - 0.15))
  })

  it('keeps a steady pace: every frame covers the same ground until it gets there', () => {
    const shown = play(standing('p1', 0.15, 1), 0.35, 1)
    const steps = shown.map(({ at }, frame) => at.x - (shown[frame - 1]?.at.x ?? 0.15))

    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? Number.NaN, 9)
  })

  it('takes as long to get there as the camera took to see them move, and a little longer', () => {
    // Seen at 0.15 for a second, then at 0.35.
    const shown = play(standing('p1', 0.15, 1), 0.35, 2)
    const arrived = shown.findIndex(({ at }) => at.x === 0.35)

    expect(UNHURRIED).toBeGreaterThan(1)
    expect(UNHURRIED).toBeLessThan(1.5)
    expect((arrived + 1) * FRAME).toBeCloseTo(UNHURRIED, 1)
    expect(shown[59]?.at.x).toBeLessThan(0.35)
    expect(shown[59]?.at.x).toBeGreaterThan(0.15 + 0.8 * 0.2)
  })

  it('never goes past where they were seen, and stops right there', () => {
    const shown = play(standing('p1', 0.15, 1), 0.35, 3)

    expect(shown.every(({ at }) => at.x >= 0.15 && at.x <= 0.35 && at.z === 2)).toBe(true)
    expect(last(shown).at).toEqual(place(0.35))
    expect(last(shown).walking).toBe(0)
  })

  it('goes the other way just as well', () => {
    const shown = play(standing('p1', 0.75, 1), 0.15, 3)

    expect(shown.every(({ at }) => at.x >= 0.15 && at.x <= 0.75)).toBe(true)
    expect(last(shown).at).toEqual(place(0.15))
  })

  it('goes straight there over the ground, whichever way that is: toward the Enclosure as along the fence', () => {
    const [from, to] = [place(0.4, 2.4), place(-0.2, 1.1)]
    const shown = playTo({ ...standing('p1', 0, 1), at: from, sighted: from }, to, 3)

    for (const { at } of shown) expect(between(from, at) + between(at, to)).toBeCloseTo(between(from, to), 9)
    expect(shown.every(({ at }, frame) => between(at, to) <= between(shown[frame - 1]?.at ?? from, to))).toBe(true)
    expect(last(shown).at).toEqual(to)
    expect(last(shown).walked).toBeCloseTo(between(from, to), 9)
  })

  it('is the same whatever the frame rate', () => {
    const atSixty = last(play(standing('p1', 0.15, 1), 0.35, 0.5, 60))
    const atThirty = last(play(standing('p1', 0.15, 1), 0.35, 0.5, 30))
    const inOneStep = trackAt(trackAt(standing('p1', 0.15, 1), seen('p1', 0.35), 0), seen('p1', 0.35), 0.5)

    for (const other of [atThirty, inOneStep]) {
      expect(other?.at.x).toBeCloseTo(atSixty.at.x, 9)
      expect(other?.walked).toBeCloseTo(atSixty.walked, 9)
      expect(other?.walking).toBeCloseTo(atSixty.walking, 9)
    }
  })

  it('goes at the pace of the sightings: twice as fast for twice as far in the same time', () => {
    const near = trackAt(standing('p1', 0.15, 1), seen('p1', 0.25), FRAME)
    const far = trackAt(standing('p1', 0.15, 1), seen('p1', 0.35), FRAME)
    const sooner = trackAt(standing('p1', 0.15, 0.5), seen('p1', 0.35), FRAME)

    expect(far?.pace).toBeCloseTo(2 * (near?.pace ?? Number.NaN))
    expect(sooner?.pace).toBeCloseTo(2 * (far?.pace ?? Number.NaN))
    expect(far?.pace).toBeCloseTo(0.2 / UNHURRIED)
  })

  it('does not dash for two sightings in a row, nor crawl for one that comes after it stood for long', () => {
    const atOnce = trackAt(standing('p1', 0.15, 0), seen('p1', 0.35), FRAME)
    const atLast = trackAt(standing('p1', 0.15, 60), seen('p1', 0.35), FRAME)

    expect(atOnce?.pace).toBeCloseTo(0.2 / (UNHURRIED * SIGHTING.shortest))
    expect(atLast?.pace).toBeCloseTo(0.2 / (UNHURRIED * SIGHTING.longest))
    expect(SIGHTING.shortest).toBeGreaterThan(0)
    expect(SIGHTING.longest).toBeGreaterThan(SIGHTING.shortest)
  })

  it('walks on from where it has got to when they are seen further on before it gets there', () => {
    const halfway = last(play(standing('p1', 0.15, 1), 0.35, 0.5))
    const shown = play(halfway, 0.55, 2)

    expect(shown[0]?.at.x).toBeGreaterThan(halfway.at.x)
    expect(shown.every(({ at }, frame) => at.x >= (shown[frame - 1]?.at.x ?? halfway.at.x))).toBe(true)
    expect(last(shown).at).toEqual(place(0.55))
  })
})

describe('the way the figurine walks', () => {
  it('is the bearing from where it stands to where its person was seen, taken as it sets off', () => {
    expect(trackAt(standing('p1', 0.35, 1), seen('p1', 0.55), FRAME)?.course).toBeCloseTo(RIGHT)
    expect(trackAt(standing('p1', 0.35, 1), seen('p1', 0.15), FRAME)?.course).toBeCloseTo(LEFT)
    // Toward the entrance is bearing 0, like every bearing of the plan.
    const inward = trackAt(standing('p1', 0.35, 1), { ...seen('p1', 0.35), at: place(0.35, 1) }, FRAME)
    expect(Math.abs(inward?.course ?? 0)).toBeCloseTo(Math.PI)
  })

  it('is kept all the way there, and once it has stopped', () => {
    const shown = play(standing('p1', 0.75, 1), 0.55, 3)

    expect(shown.every(({ course }) => Math.abs(course - LEFT) < 1e-9)).toBe(true)
  })

  it('is none for someone newly seen, whatever stood before: no move, no step, no stride', () => {
    const walking = last(play(standing('p1', 0.15, 1), 0.75, 0.5))
    expect(walking.walking).toBeGreaterThan(0.95)

    for (const raised of [trackAt(walking, seen('p1', 0.2, 'a2'), FRAME), trackAt(trackAt(walking, null, FRAME), seen('p1', 0.2), FRAME)]) {
      expect(raised?.at).toEqual(place(0.2))
      expect(raised?.walked).toBe(0)
      expect(raised?.walking).toBe(0)
      expect(raised?.pace).toBe(0)
    }
  })

  it('turns to the way back as it walks when its person walks back, without a jolt and without stopping', () => {
    const there = last(play(standing('p1', 0.15, 1), 0.55, 0.6))
    expect(there.walking).toBeGreaterThan(0.95)
    expect(there.course).toBeCloseTo(RIGHT)

    // Half a second of its way back: it has not got there yet.
    const back = play(there, 0.15, 0.5)
    // How far round it still is from the way it goes.
    const off = [there, ...back].map(({ course }) => Math.abs(Math.atan2(Math.sin(course - LEFT), Math.cos(course - LEFT))))

    expect(off).toEqual([...off].sort((a, b) => b - a))
    expect(off.every((angle, frame) => (off[frame - 1] ?? angle) - angle < 0.5)).toBe(true)
    expect(off.at(-1)).toBeLessThan(0.1)
    expect(back.every(({ walking }) => walking > 0.95)).toBe(true)
    expect(back.every(({ at }, frame) => at.x < (back[frame - 1]?.at.x ?? there.at.x))).toBe(true)
  })
})

describe('the ground the figurine covers', () => {
  it('is how far it is from where it stood to where it has walked to, in scene units', () => {
    const shown = play(standing('p1', 0.15, 1), 0.35, 3)

    expect(last(shown).walked).toBeCloseTo(0.2, 9)
    expect(shown[29]?.walked).toBeCloseTo((shown[29]?.at.x ?? Number.NaN) - 0.15, 9)
  })

  it('only adds up: walking back covers as much ground again', () => {
    const there = last(play(standing('p1', 0.15, 1), 0.35, 3))
    const back = play(there, 0.15, 3)

    expect(back.every(({ walked }, frame) => walked >= (back[frame - 1]?.walked ?? there.walked))).toBe(true)
    expect(last(back).walked).toBeCloseTo(0.4, 9)
  })

  it('does not grow while it stands: no step is taken without ground covered', () => {
    const there = last(play(standing('p1', 0.15, 1), 0.35, 3))
    const waiting = play(there, 0.35, 5)

    expect(waiting.every(({ walked }) => walked === there.walked)).toBe(true)
  })
})

describe("the figurine's stride", () => {
  it('is got into as it sets off: eased, and all but full in a few tenths of a second', () => {
    const shown = play(standing('p1', 0.15, 1), 0.35, 1)
    const strides = shown.map(({ walking }) => walking)

    expect(strides[0]).toBeGreaterThan(0)
    expect(strides[0]).toBeLessThan(0.2)
    expect(strides).toEqual([...strides].sort((a, b) => a - b))
    expect(strides[29]).toBeGreaterThan(0.95)
    expect(Math.max(...strides)).toBeLessThanOrEqual(1)
    expect(SET_OFF).toBeGreaterThan(0)
  })

  it('is the same whichever way it walks', () => {
    const toRight = last(play(standing('p1', 0.35, 1), 0.55, 0.3))
    const toLeft = last(play(standing('p1', 0.35, 1), 0.15, 0.3))

    expect(toLeft.walking).toBeCloseTo(toRight.walking, 9)
    expect(toLeft.walking).toBeGreaterThan(0.5)
  })

  it('is got out of once it has stopped: back to rest, for good, without a jolt', () => {
    const shown = play(standing('p1', 0.15, 1), 0.35, 4)
    const arrived = shown.findIndex(({ at }) => at.x === 0.35)
    const strides = shown.slice(arrived).map(({ walking }) => walking)

    expect(strides).toEqual([...strides].sort((a, b) => b - a))
    expect(strides.every((stride, frame) => (strides[frame - 1] ?? stride) - stride < 0.15)).toBe(true)
    expect(shown[arrived + 30]?.walking).toBeLessThan(0.05)
    expect(last(shown).walking).toBe(0)
  })
})

describe('the figurine on the mock feed', () => {
  it('walks in from the fence toward the Enclosure, all the way without marking time', () => {
    const shown = crossing()
    const [from, to] = [mockPlace(MOCK[0]), mockPlace(MOCK[3])]
    // From the frame the camera first sees it move.
    const moving = shown.slice(shown.findIndex(({ walking }) => walking > 0))
    const fromCentre = ({ x, z }: GroundPoint) => Math.hypot(x, z)

    expect(moving.length).toBeGreaterThan(170)
    expect(moving.every(({ at }, frame) => between(at, moving[frame - 1]?.at ?? from) > 0)).toBe(true)
    expect(fromCentre(to)).toBeLessThan(fromCentre(from) - 0.8)
    expect(between(last(shown).at, to)).toBeLessThan(0.15)
  })

  it('keeps a walking pace from one sighting to the next: no more than a third faster or slower', () => {
    const shown = crossing()
    const paces = shown.filter(({ walking, seen }) => seen && walking > 0).map(({ pace }) => pace)

    expect(Math.max(...paces) / Math.min(...paces)).toBeLessThan(4 / 3)
    expect(Math.min(...paces)).toBeGreaterThan(0.25)
    expect(Math.max(...paces)).toBeLessThan(0.5)
  })

  it('is in full stride from its first steps to its last', () => {
    const shown = crossing()
    const first = shown.findIndex(({ walking }) => walking > 0)

    expect(shown.slice(first + 30).every(({ walking }) => walking > 0.95)).toBe(true)
  })

  it('is the same at 30 images a second', () => {
    const [atSixty, atThirty] = [last(crossing(60)), last(crossing(30))]

    expect(between(atThirty.at, atSixty.at)).toBeLessThan(0.02)
    expect(atThirty.walked).toBeCloseTo(atSixty.walked, 1)
  })
})

describe('the last known position', () => {
  it('is none while the intruder is seen, and none where there never was one', () => {
    expect(lastKnown(null)).toBeNull()
    expect(lastKnown(standing('p1', 0.55, 3))).toBeNull()
    expect(lastKnown(last(play(standing('p1', 0.15, 1), 0.35, 0.5)))).toBeNull()
  })

  it('is where the figurine last stood, from the frame it is first missed on', () => {
    const walking = last(play(standing('p1', 0.3, 3), 0.62, 0.5))
    const cleared = trackAt(walking, null, FRAME)

    expect(walking.at.x).toBeLessThan(0.62)
    expect(lastKnown(cleared)?.at).toEqual(walking.at)
    expect(cleared?.lost).toBe(0)
  })

  it('stays there for about five seconds', () => {
    const left = lose(standing('p1', 0.62, 3), LAST_KNOWN_SECONDS)

    expect(LAST_KNOWN_SECONDS).toBeGreaterThanOrEqual(4)
    expect(LAST_KNOWN_SECONDS).toBeLessThanOrEqual(6)
    expect(left.every((track) => lastKnown(track)?.at.x === 0.62)).toBe(true)
    expect(left.at(-1)?.lost).toBeCloseTo(LAST_KNOWN_SECONDS, 1)
  })

  it('is nothing once that time and a fade have passed, for good', () => {
    const cleared = standing('p1', 0.62, 3)

    expect(lostFor(cleared, LAST_KNOWN_SECONDS + FADE_SECONDS - 0.1)).not.toBeNull()
    expect(lostFor(cleared, LAST_KNOWN_SECONDS + FADE_SECONDS + 0.1)).toBeNull()
    expect(lostFor(cleared, 60)).toBeNull()
    expect(lastKnown(lostFor(cleared, 60))).toBeNull()
  })

  it('is the same whatever the frame rate, and in one step', () => {
    // The frame it is first missed on starts the count, however long that frame took.
    const cleared = trackAt(standing('p1', 0.62, 3), null, 60) as Track
    const atSixty = lostFor(cleared, LAST_KNOWN_SECONDS + FADE_SECONDS / 2, 60)

    expect(cleared.lost).toBe(0)
    expect(lastKnown(atSixty)?.level).toBeCloseTo(0.5, 9)
    for (const other of [
      lostFor(cleared, LAST_KNOWN_SECONDS + FADE_SECONDS / 2, 30),
      trackAt(cleared, null, LAST_KNOWN_SECONDS + FADE_SECONDS / 2),
    ]) {
      expect(other?.lost).toBeCloseTo(atSixty?.lost ?? Number.NaN, 9)
      expect(lastKnown(other)?.level).toBeCloseTo(lastKnown(atSixty)?.level ?? Number.NaN, 9)
    }
    expect(trackAt(cleared, null, 60)).toBeNull()
  })

  it('does not go back when the clock does', () => {
    const left = lostFor(standing('p1', 0.62, 3), 2)
    expect(trackAt(left, null, -1)?.lost).toBe(left?.lost)
  })

  it('is left by anyone the camera saw, followed or not', () => {
    const other = { ...standing('p2', 0.4, 3), followed: false }
    const left = lose(other, LAST_KNOWN_SECONDS + FADE_SECONDS + 0.5)

    expect(figurineLevel(left[0] as Track)).toBe(1)
    expect(lastKnown(left[60] ?? null)).toEqual({ at: other.at, level: 1 })
    expect(left.filter((track) => track !== null).length / 60).toBeCloseTo(LAST_KNOWN_SECONDS + FADE_SECONDS, 1)
    expect(left.at(-1)).toBeNull()
  })
})

describe('the outline the figurine leaves', () => {
  // How much of it shows on each frame, from the one it is first missed on until nothing is left.
  const levels = (cleared: Track) =>
    lose(cleared, LAST_KNOWN_SECONDS + 2).flatMap((track) => (track ? [lastKnown(track)?.level ?? Number.NaN] : []))

  it('comes as the figurine goes, in a fade: one fades in as much as the other fades out', () => {
    const left = lose(standing('p1', 0.62, 3), FADE_SECONDS + 0.5).map((track) => track as Track)

    expect(lastKnown(left[0] ?? null)?.level).toBe(0)
    expect(figurineLevel(left[0] as Track)).toBe(1)
    for (const track of left) expect((lastKnown(track)?.level ?? Number.NaN) + figurineLevel(track)).toBeCloseTo(1, 9)

    const half = left[Math.round((FADE_SECONDS / 2) * 60)] as Track
    expect(lastKnown(half)?.level).toBeCloseTo(0.5, 9)
    expect(lastKnown(left.at(-1) ?? null)?.level).toBe(1)
    expect(figurineLevel(left.at(-1) as Track)).toBe(0)
  })

  it('shows whole from the end of that fade until the five seconds are over', () => {
    const shown = levels(standing('p1', 0.62, 3))
    const whole = shown.slice(Math.ceil(FADE_SECONDS * 60) + 1, Math.floor(LAST_KNOWN_SECONDS * 60))

    expect(whole.length).toBeGreaterThan(4 * 60)
    expect(whole.every((level) => level === 1)).toBe(true)
  })

  it('then goes out in a fade, without a cut', () => {
    const shown = levels(standing('p1', 0.62, 3))
    const going = shown.slice(Math.floor(LAST_KNOWN_SECONDS * 60))
    const steps = going.slice(1).map((level, frame) => (going[frame] ?? 0) - level)

    expect(shown.length / 60).toBeCloseTo(LAST_KNOWN_SECONDS + FADE_SECONDS, 1)
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...steps)).toBeLessThan(0.05)
    expect(going.at(-1)).toBeLessThan(0.01)
  })

  it('never shows with the figurine whole: the figurine is all there is while it is seen', () => {
    const walking = play(standing('p1', 0.15, 1), 0.35, 1)

    expect(walking.every((track) => figurineLevel(track) === 1 && lastKnown(track) === null)).toBe(true)
    expect(figurineLevel(lostFor(standing('p1', 0.62, 3), LAST_KNOWN_SECONDS) as Track)).toBe(0)
  })

  it('stands still, at rest: a figurine lost in mid-stride comes out of it and no longer moves', () => {
    const walking = last(play(standing('p1', 0.15, 1), 0.75, 0.5))
    expect(walking.walking).toBeGreaterThan(0.95)

    const left = lose(walking, LAST_KNOWN_SECONDS).map((track) => track as Track)
    const strides = left.map((track) => track.walking)

    expect(left.every((track) => track.at === walking.at && track.course === walking.course)).toBe(true)
    expect(left.every((track) => track.walked === walking.walked && track.age === walking.age)).toBe(true)
    expect(strides).toEqual([...strides].sort((a, b) => b - a))
    expect(strides.every((stride, frame) => (strides[frame - 1] ?? walking.walking) - stride < 0.15)).toBe(true)
    // At rest before the figurine has faded out, and from then on.
    expect(left[Math.round(FADE_SECONDS * 60)]?.walking).toBeLessThan(0.01)
    expect(left.slice(90).every((track) => track.walking === 0)).toBe(true)
  })
})

describe('what tells someone the camera sees', () => {
  it('comes in a fade as the figurine appears, and is whole from then on', () => {
    const shown = play(standing('p1', 0.55), 0.55, 1)
    const levels = shown.map(marksLevel)

    expect(marksLevel(standing('p1', 0.55))).toBe(0)
    expect(levels).toEqual([...levels].sort((a, b) => a - b))
    expect(levels[Math.round((FADE_SECONDS / 2) * 60) - 1]).toBeCloseTo(0.5, 1)
    expect(levels.at(-1)).toBe(1)
  })

  it('goes with the figurine once they are no longer seen', () => {
    for (const track of lose(standing('p1', 0.62, 3), 1)) {
      expect(marksLevel(track as Track)).toBe(figurineLevel(track as Track))
    }
  })
})

describe('the figurines of an intrusion', () => {
  const told = (alertId: string, ...people: Sighting[]): Intrusion => ({ alertId, people })
  const person = (key: string, x: number, followed = false): Sighting => ({ key, at: place(x), followed })
  const after = (tracks: readonly Track[], intrusion: Intrusion | null, seconds: number) => {
    let now = tracks
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) now = tracksAt(now, intrusion, FRAME)
    return now
  }

  it('are none while there is no intrusion', () => {
    expect(tracksAt(NO_TRACKS, null, FRAME)).toEqual([])
  })

  it('follow one intruder like its track alone does', () => {
    let tracks = NO_TRACKS
    let alone: Track | null = null

    for (const x of [0.15, 0.35, 0.35, null, null]) {
      tracks = tracksAt(tracks, x === null ? null : told('a1', person('p1', x, true)), FRAME)
      alone = trackAt(alone, x === null ? null : seen('p1', x), FRAME)
      expect(tracks).toEqual([alone])
    }
  })

  it('stand one for each person the Alert tells of, the one the camera follows first', () => {
    const tracks = tracksAt(NO_TRACKS, told('a1', person('p1', 0.5, true), person('p3', 0.2), person('p2', 0.8)), FRAME)

    expect(tracks.map(({ key, followed, at }) => [key, followed, at.x])).toEqual([
      ['p1', true, 0.5],
      ['p3', false, 0.2],
      ['p2', false, 0.8],
    ])
  })

  it('walk each to where their own person is seen, whatever the order the Alert tells them in', () => {
    const before = after(NO_TRACKS, told('a1', person('p1', 0.5, true), person('p2', 0.8)), 1)
    const tracks = after(before, told('a1', person('p2', 0.7), person('p1', 0.4, true)), 3)

    expect(tracks.map(({ key, at, walked }) => [key, at.x, walked.toFixed(3)])).toEqual([
      ['p2', 0.7, '0.100'],
      ['p1', 0.4, '0.100'],
    ])
  })

  it('leave the outline of someone the Alert no longer tells of, where they stood, the others as they were', () => {
    const before = after(NO_TRACKS, told('a1', person('p1', 0.5, true), person('p2', 0.8)), 1)
    const [stays, leaves] = tracksAt(before, told('a1', person('p1', 0.5, true)), FRAME)

    expect(stays).toMatchObject({ key: 'p1', seen: true })
    expect(leaves).toMatchObject({ key: 'p2', seen: false, at: place(0.8), lost: 0 })
    const gone = after(before, told('a1', person('p1', 0.5, true)), 1)
    expect(lastKnown(gone[1] ?? null)).toEqual({ at: place(0.8), level: 1 })
    const later = after(before, told('a1', person('p1', 0.5, true)), LAST_KNOWN_SECONDS + FADE_SECONDS + 0.1)
    expect(later.map(({ key }) => key)).toEqual(['p1'])
  })

  it('hand the camera over to another person without moving anyone: the one it followed leaves its outline', () => {
    const before = after(NO_TRACKS, told('a1', person('p1', 0.5, true), person('p2', 0.8)), 1)
    const handed = after(before, told('a1', person('p2', 0.8, true)), 1)

    expect(handed.map(({ key, seen, followed }) => [key, seen, followed])).toEqual([
      ['p2', true, true],
      ['p1', false, true],
    ])
    expect(handed[0]?.age).toBeCloseTo(2, 1)
    expect(lastKnown(handed[1] ?? null)).toEqual({ at: place(0.5), level: 1 })
  })

  it('leave the last known position of everyone the camera saw once the Alert is cleared', () => {
    const before = after(NO_TRACKS, told('a1', person('p1', 0.5, true), person('p2', 0.8)), 1)
    const cleared = after(before, null, 1)

    expect(cleared.map(({ key }) => key)).toEqual(['p1', 'p2'])
    expect(cleared.map(lastKnown)).toEqual([
      { at: place(0.5), level: 1 },
      { at: place(0.8), level: 1 },
    ])
    expect(after(before, null, LAST_KNOWN_SECONDS + FADE_SECONDS + 0.1)).toEqual([])
  })

  it('never draw more than the Twin has figurines for: those lost longest go first', () => {
    let tracks = NO_TRACKS
    for (let round = 0; round < 6; round++) {
      const people = [0, 1, 2, 3, 4].map((n) => person(`r${round}p${n}`, n / 10, true))
      tracks = tracksAt(tracks, told('a1', ...people), FRAME)
    }

    expect(tracks).toHaveLength(MOST_FIGURINES)
    expect(tracks.slice(0, 5).map(({ key }) => key)).toEqual(['r5p0', 'r5p1', 'r5p2', 'r5p3', 'r5p4'])
    expect(tracks.slice(5).every(({ seen }) => !seen)).toBe(true)
    expect(tracks.slice(5, 10).every(({ key }) => key.startsWith('r4'))).toBe(true)
  })
})

describe('a new intruder while the last known position still shows', () => {
  const told = (alertId: string, x: number): Intrusion => ({ alertId, people: [{ key: 'p1', at: place(x), followed: true }] })
  // The first intruder's Alert cleared for `seconds`, then a second one raised at `x`: every frame from that
  // one, for a second.
  function raisedAfter(seconds: number, x: number): Track[][] {
    let tracks: readonly Track[] = [standing('p1', 0.62, 3)]
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) tracks = tracksAt(tracks, null, FRAME)

    const shown: Track[][] = []
    for (let frame = 0; frame < 60; frame++) {
      tracks = tracksAt(tracks, told('a2', x), FRAME)
      shown.push([...tracks])
    }
    return shown
  }
  const former = (tracks: readonly Track[]) => tracks.find(({ alertId }) => alertId === 'a1') ?? null

  it('stands the new one at its own place, at rest, without walking there', () => {
    const [raised] = raisedAfter(2, 0.2)

    expect(raised?.[0]).toEqual(standing('p1', 0.2, 0, 'a2'))
    expect(lastKnown(raised?.[0] ?? null)).toBeNull()
  })

  it('keeps the former one where it was, and puts its outline out in a fade', () => {
    const shown = raisedAfter(2, 0.2)
    const left = shown.map((tracks) => lastKnown(former(tracks)))
    const going = left.flatMap((known) => (known ? [known.level] : []))
    const steps = going.slice(1).map((level, frame) => (going[frame] ?? 0) - level)

    expect(left[0]).toEqual({ at: place(0.62), level: 1 })
    expect(left.every((known) => known === null || known.at.x === 0.62)).toBe(true)
    expect(Math.min(...steps)).toBeGreaterThan(0)
    expect(Math.max(...steps)).toBeLessThan(0.05)
    expect(going.length / 60).toBeCloseTo(FADE_SECONDS, 1)
    expect(former(shown.at(-1) ?? [])).toBeNull()
  })

  it('puts out from what shows of it an outline that had not fully come', () => {
    const before = lastKnown(lostFor(standing('p1', 0.62, 3), FADE_SECONDS / 4 + FRAME))
    const shown = raisedAfter(FADE_SECONDS / 4, 0.2)
    const going = shown.flatMap((tracks) => (former(tracks) ? [lastKnown(former(tracks))?.level ?? Number.NaN] : []))

    expect(before?.level).toBeGreaterThan(0.05)
    expect(before?.level).toBeLessThan(0.5)
    expect(going[0]).toBeLessThanOrEqual((before?.level ?? Number.NaN) + 1e-9)
    expect(going[0]).toBeCloseTo(before?.level ?? Number.NaN, 1)
    expect(going).toEqual([...going].sort((a, b) => b - a))
    expect(going.length / 60).toBeLessThan(FADE_SECONDS / 2)
  })

  it('leaves no former one once the last known position has gone out by itself', () => {
    const [raised] = raisedAfter(LAST_KNOWN_SECONDS + FADE_SECONDS + 0.5, 0.2)

    expect(raised).toEqual([standing('p1', 0.2, 0, 'a2')])
  })

  it('leaves none either when another Alert is raised while the first is active: that intruder is still seen', () => {
    const tracks = tracksAt([standing('p1', 0.62, 3)], told('a2', 0.2), FRAME)

    expect(tracks).toEqual([standing('p1', 0.2, 0, 'a2')])
  })

  it('leaves the new one its own last known position once it is cleared in turn', () => {
    let tracks: readonly Track[] = raisedAfter(2, 0.2).at(-1) ?? []
    for (let frame = 0; frame < 60; frame++) tracks = tracksAt(tracks, null, FRAME)

    expect(tracks).toHaveLength(1)
    expect(lastKnown(tracks[0] ?? null)).toEqual({ at: place(0.2), level: 1 })
  })
})
