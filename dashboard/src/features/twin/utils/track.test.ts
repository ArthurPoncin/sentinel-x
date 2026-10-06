import { describe, expect, it } from 'vitest'
import { roundFence, watchedPoint } from './site'
import { SET_OFF, SIGHTING, type Track, trackAt, UNHURRIED } from './track'

const FRAME = 1 / 60

const seen = (alertId: string, x_norm: number) => ({ alertId, x_norm })

// A figurine at rest where the camera sees it, its Alert shown for `age` seconds.
const standing = (alertId: string, x_norm: number, age = 0): Track => ({
  alertId,
  x_norm,
  age,
  seen: x_norm,
  since: age,
  pace: 0,
  heading: 0,
  walked: 0,
  walking: 0,
})

// Plays `seconds` of frames from `track` with the camera seeing its intruder at `x_norm`, and returns the
// figurine on each.
function play(track: Track, x_norm: number, seconds: number, rate = 60): Track[] {
  const shown: Track[] = []
  let last = track
  for (let frame = 0; frame < Math.round(seconds * rate); frame++) {
    last = trackAt(last, seen(last.alertId ?? 'intruder', x_norm), 1 / rate) ?? last
    shown.push(last)
  }
  return shown
}

const last = (shown: Track[]): Track => shown[shown.length - 1] as Track

// How far it is along the arc from where the camera sees `from` to where it sees `to`.
const arc = (from: number, to: number) => Math.abs(roundFence(watchedPoint(to)) - roundFence(watchedPoint(from)))

// The mock feed's intruder: 0.15, 0.35, 0.55, 0.75, one a second, cleared a second later. The figurine on
// every frame until then.
function crossing(rate = 60): Track[] {
  const shown: Track[] = [trackAt(null, seen('intruder', 0.15), 1 / rate) as Track]
  for (const x_norm of [0.15, 0.35, 0.55, 0.75]) shown.push(...play(last(shown), x_norm, 1, rate))
  return shown
}

describe("the intruder's track", () => {
  it('is nothing until an intruder is seen', () => {
    expect(trackAt(null, null, FRAME)).toBeNull()
  })

  it('stands the figurine where a newly raised intruder is, at rest, without walking there', () => {
    expect(trackAt(null, seen('i1', 0.55), FRAME)).toEqual(standing('i1', 0.55))
  })

  it('stays where it stands while the camera sees it at the same place', () => {
    const shown = play(standing('i1', 0.55), 0.55, 2)

    expect(shown.every(({ x_norm, heading, walked, walking }) => x_norm === 0.55 && !heading && !walked && !walking)).toBe(
      true,
    )
  })

  it('stays where it last stood once cleared, so the figurine fades out there', () => {
    const shown = last(play(standing('i1', 0.3, 3), 0.62, 0.5))
    const cleared = trackAt(shown, null, FRAME)

    expect(cleared).toEqual({ ...shown, alertId: null, heading: 0 })
    expect(trackAt(cleared, null, FRAME)).toBe(cleared)
  })

  it('does not walk from where a previous intruder stood, even one raised again under the same id', () => {
    const cleared = trackAt(last(play(standing('intruder', 0.55, 3), 0.75, 0.5)), null, FRAME)
    expect(trackAt(cleared, seen('intruder', 0.15), FRAME)).toEqual(standing('intruder', 0.15))
  })

  it('stands the figurine where another Alert, raised while the first is active, sees its intruder', () => {
    const walking = last(play(standing('i1', 0.2, 3), 0.4, 0.5))
    expect(trackAt(walking, seen('i2', 0.7), FRAME)).toEqual(standing('i2', 0.7))
  })

  it('ages with the time its Alert has been shown, wherever the intruder goes, so its sweep plays once', () => {
    let shown = trackAt(null, seen('i1', 0.15), FRAME)
    expect(shown?.age).toBe(0)

    for (let frame = 0; frame < 60; frame++) shown = trackAt(shown, seen('i1', frame < 30 ? 0.15 : 0.35), FRAME)
    expect(shown?.age).toBeCloseTo(1)
  })

  it('no longer ages once cleared, and does not go back when the clock does', () => {
    const cleared = trackAt(standing('i1', 0.62, 0.3), null, 1)
    expect(cleared?.age).toBe(0.3)

    const walking = last(play(standing('i1', 0.3, 1), 0.62, 0.3))
    const back = trackAt(walking, seen('i1', 0.62), -1)
    expect(back?.age).toBe(walking.age)
    expect(back?.x_norm).toBe(walking.x_norm)
    expect(back?.walked).toBe(walking.walked)
  })
})

describe("the figurine's walk to where it was seen", () => {
  it('walks there, it does not jump: no frame covers more than a tenth of the way', () => {
    const shown = play(standing('i1', 0.15, 1), 0.35, 1)
    const steps = shown.map(({ x_norm }, frame) => x_norm - (shown[frame - 1]?.x_norm ?? 0.15))

    expect(shown[0]?.x_norm).toBeGreaterThan(0.15)
    expect(shown[0]?.x_norm).toBeLessThan(0.35)
    expect(Math.max(...steps)).toBeLessThan(0.1 * (0.35 - 0.15))
  })

  it('keeps a steady pace: every frame covers the same share of the image until it gets there', () => {
    const shown = play(standing('i1', 0.15, 1), 0.35, 1)
    const steps = shown.map(({ x_norm }, frame) => x_norm - (shown[frame - 1]?.x_norm ?? 0.15))

    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? Number.NaN, 9)
  })

  it('takes as long to get there as the camera took to see it move, and a little longer', () => {
    // Seen at 0.15 for a second, then at 0.35.
    const shown = play(standing('i1', 0.15, 1), 0.35, 2)
    const arrived = shown.findIndex(({ x_norm }) => x_norm === 0.35)

    expect(UNHURRIED).toBeGreaterThan(1)
    expect(UNHURRIED).toBeLessThan(1.5)
    expect((arrived + 1) * FRAME).toBeCloseTo(UNHURRIED, 1)
    expect(shown[59]?.x_norm).toBeLessThan(0.35)
    expect(shown[59]?.x_norm).toBeGreaterThan(0.15 + 0.8 * 0.2)
  })

  it('never goes past where it was seen, and stops right there', () => {
    const shown = play(standing('i1', 0.15, 1), 0.35, 3)

    expect(shown.every(({ x_norm }) => x_norm >= 0.15 && x_norm <= 0.35)).toBe(true)
    expect(last(shown).x_norm).toBe(0.35)
    expect(last(shown).heading).toBe(0)
  })

  it('goes the other way just as well', () => {
    const shown = play(standing('i1', 0.75, 1), 0.15, 3)

    expect(shown.every(({ x_norm }) => x_norm >= 0.15 && x_norm <= 0.75)).toBe(true)
    expect(last(shown).x_norm).toBe(0.15)
  })

  it('is the same whatever the frame rate', () => {
    const atSixty = last(play(standing('i1', 0.15, 1), 0.35, 0.5, 60))
    const atThirty = last(play(standing('i1', 0.15, 1), 0.35, 0.5, 30))
    const inOneStep = trackAt(trackAt(standing('i1', 0.15, 1), seen('i1', 0.35), 0), seen('i1', 0.35), 0.5)

    for (const other of [atThirty, inOneStep]) {
      expect(other?.x_norm).toBeCloseTo(atSixty.x_norm, 9)
      expect(other?.walked).toBeCloseTo(atSixty.walked, 9)
      expect(other?.walking).toBeCloseTo(atSixty.walking, 9)
    }
  })

  it('goes at the pace of the sightings: twice as fast for twice as far in the same time', () => {
    const near = trackAt(standing('i1', 0.15, 1), seen('i1', 0.25), FRAME)
    const far = trackAt(standing('i1', 0.15, 1), seen('i1', 0.35), FRAME)
    const sooner = trackAt(standing('i1', 0.15, 0.5), seen('i1', 0.35), FRAME)

    expect(far?.pace).toBeCloseTo(2 * (near?.pace ?? Number.NaN))
    expect(sooner?.pace).toBeCloseTo(2 * (far?.pace ?? Number.NaN))
    expect(far?.pace).toBeCloseTo(0.2 / UNHURRIED)
  })

  it('does not dash for two sightings in a row, nor crawl for one that comes after it stood for long', () => {
    const atOnce = trackAt(standing('i1', 0.15, 0), seen('i1', 0.35), FRAME)
    const atLast = trackAt(standing('i1', 0.15, 60), seen('i1', 0.35), FRAME)

    expect(atOnce?.pace).toBeCloseTo(0.2 / (UNHURRIED * SIGHTING.shortest))
    expect(atLast?.pace).toBeCloseTo(0.2 / (UNHURRIED * SIGHTING.longest))
    expect(SIGHTING.shortest).toBeGreaterThan(0)
    expect(SIGHTING.longest).toBeGreaterThan(SIGHTING.shortest)
  })

  it('walks on from where it has got to when it is seen further on before it gets there', () => {
    const halfway = last(play(standing('i1', 0.15, 1), 0.35, 0.5))
    const shown = play(halfway, 0.55, 2)

    expect(shown[0]?.x_norm).toBeGreaterThan(halfway.x_norm)
    expect(shown.every(({ x_norm }, frame) => x_norm >= (shown[frame - 1]?.x_norm ?? halfway.x_norm))).toBe(true)
    expect(last(shown).x_norm).toBe(0.55)
  })
})

describe('the way the figurine walks', () => {
  it("is the sign of its move across the image: 1 toward its right, -1 toward its left, 0 while it stands", () => {
    expect(trackAt(standing('i1', 0.35, 1), seen('i1', 0.55), FRAME)?.heading).toBe(1)
    expect(trackAt(standing('i1', 0.35, 1), seen('i1', 0.15), FRAME)?.heading).toBe(-1)
    expect(trackAt(standing('i1', 0.35, 1), seen('i1', 0.35), FRAME)?.heading).toBe(0)
  })

  it('is kept all the way there, and is none once it has stopped', () => {
    const shown = play(standing('i1', 0.75, 1), 0.55, 3)
    const arrived = shown.findIndex(({ x_norm }) => x_norm === 0.55)

    expect(shown.slice(0, arrived + 1).every(({ heading }) => heading === -1)).toBe(true)
    expect(shown.slice(arrived + 1).every(({ heading }) => heading === 0)).toBe(true)
  })

  it('is none for a newly raised Alert, whatever stood before: no move, no step, no stride', () => {
    const walking = last(play(standing('i1', 0.15, 1), 0.75, 0.5))
    expect(walking.heading).toBe(1)

    for (const raised of [trackAt(walking, seen('i2', 0.2), FRAME), trackAt(trackAt(walking, null, FRAME), seen('i1', 0.2), FRAME)]) {
      expect(raised?.x_norm).toBe(0.2)
      expect(raised?.heading).toBe(0)
      expect(raised?.walked).toBe(0)
      expect(raised?.walking).toBe(0)
      expect(raised?.pace).toBe(0)
    }
  })

  it('is none once the Alert is cleared: the figurine fades out where it stopped', () => {
    const walking = last(play(standing('i1', 0.15, 1), 0.75, 0.5))
    expect(trackAt(walking, null, FRAME)?.heading).toBe(0)
  })
})

describe('the ground the figurine covers', () => {
  it('is the arc between where it stood and where it has walked to, in scene units', () => {
    const shown = play(standing('i1', 0.15, 1), 0.35, 3)

    expect(last(shown).walked).toBeCloseTo(arc(0.15, 0.35), 9)
    expect(shown[29]?.walked).toBeCloseTo(arc(0.15, shown[29]?.x_norm ?? Number.NaN), 9)
  })

  it('only adds up: walking back covers as much ground again', () => {
    const there = last(play(standing('i1', 0.15, 1), 0.35, 3))
    const back = play(there, 0.15, 3)

    expect(back.every(({ walked }, frame) => walked >= (back[frame - 1]?.walked ?? there.walked))).toBe(true)
    expect(last(back).walked).toBeCloseTo(2 * arc(0.15, 0.35), 9)
  })

  it('does not grow while it stands: no step is taken without ground covered', () => {
    const there = last(play(standing('i1', 0.15, 1), 0.35, 3))
    const waiting = play(there, 0.35, 5)

    expect(waiting.every(({ walked }) => walked === there.walked)).toBe(true)
  })
})

describe("the figurine's stride", () => {
  it('is got into as it sets off: eased, and all but full in a few tenths of a second', () => {
    const shown = play(standing('i1', 0.15, 1), 0.35, 1)
    const strides = shown.map(({ walking }) => walking)

    expect(strides[0]).toBeGreaterThan(0)
    expect(strides[0]).toBeLessThan(0.2)
    expect(strides).toEqual([...strides].sort((a, b) => a - b))
    expect(strides[29]).toBeGreaterThan(0.95)
    expect(Math.max(...strides)).toBeLessThanOrEqual(1)
    expect(SET_OFF).toBeGreaterThan(0)
  })

  it('is toward the left as well: the same, the other way', () => {
    const toRight = last(play(standing('i1', 0.35, 1), 0.55, 0.3))
    const toLeft = last(play(standing('i1', 0.35, 1), 0.15, 0.3))

    expect(toLeft.walking).toBeCloseTo(-toRight.walking, 9)
  })

  it('is got out of once it has stopped: back to rest, for good, without a jolt', () => {
    const shown = play(standing('i1', 0.15, 1), 0.35, 4)
    const arrived = shown.findIndex(({ x_norm }) => x_norm === 0.35)
    const strides = shown.slice(arrived).map(({ walking }) => walking)

    expect(strides).toEqual([...strides].sort((a, b) => b - a))
    expect(strides.every((stride, frame) => (strides[frame - 1] ?? stride) - stride < 0.15)).toBe(true)
    expect(shown[arrived + 30]?.walking).toBeLessThan(0.05)
    expect(last(shown).walking).toBe(0)
  })

  it('turns round through rest when the intruder walks back, without a jolt', () => {
    const there = last(play(standing('i1', 0.15, 1), 0.55, 0.6))
    expect(there.walking).toBeGreaterThan(0.95)

    // Half a second of its way back: it has not got there yet.
    const back = play(there, 0.15, 0.5)
    const strides = back.map(({ walking }) => walking)

    expect(strides).toEqual([...strides].sort((a, b) => b - a))
    expect(strides.every((stride, frame) => (strides[frame - 1] ?? there.walking) - stride < 0.3)).toBe(true)
    expect(last(back).walking).toBeLessThan(-0.95)
  })
})

describe('the figurine on the mock feed', () => {
  it('crosses the field from left to right, walking all the way without marking time', () => {
    const shown = crossing()
    // From the frame the camera first sees it move.
    const moving = shown.slice(shown.findIndex(({ heading }) => heading !== 0))

    expect(moving.length).toBeGreaterThan(170)
    expect(moving.every(({ heading }) => heading === 1)).toBe(true)
    expect(moving.every(({ x_norm }, frame) => x_norm > (moving[frame - 1]?.x_norm ?? 0.15))).toBe(true)
    expect(last(shown).x_norm).toBeGreaterThan(0.7)
    expect(last(shown).x_norm).toBeLessThanOrEqual(0.75)
  })

  it('keeps a walking pace from one sighting to the next: no more than a third faster or slower', () => {
    const shown = crossing()
    const paces = shown.filter(({ heading }) => heading !== 0).map(({ pace }) => pace)

    expect(Math.max(...paces) / Math.min(...paces)).toBeLessThan(4 / 3)
    expect(Math.min(...paces)).toBeGreaterThan(0.15)
    expect(Math.max(...paces)).toBeLessThan(0.25)
  })

  it('is in full stride from its first steps to its last', () => {
    const shown = crossing()
    const first = shown.findIndex(({ heading }) => heading !== 0)

    expect(shown.slice(first + 30).every(({ walking }) => walking > 0.95)).toBe(true)
    expect(last(shown).walked).toBeCloseTo(arc(0.15, last(shown).x_norm), 9)
  })

  it('is the same at 30 images a second', () => {
    const [atSixty, atThirty] = [last(crossing(60)), last(crossing(30))]

    expect(atThirty.x_norm).toBeCloseTo(atSixty.x_norm, 2)
    expect(atThirty.walked).toBeCloseTo(atSixty.walked, 1)
  })
})
