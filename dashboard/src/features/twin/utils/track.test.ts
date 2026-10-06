import { describe, expect, it } from 'vitest'
import { FADE_SECONDS } from './fade'
import { roundFence, watchedPoint } from './site'
import {
  figurineLevel,
  LAST_KNOWN_SECONDS,
  lastKnown,
  NO_TRACKS,
  SET_OFF,
  SIGHTING,
  type Track,
  type Tracks,
  trackAt,
  tracksAt,
  UNHURRIED,
} from './track'

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
  lost: 0,
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

// Plays `seconds` of frames from `track` with no `intrusion` Alert active, and returns what is left of the
// figurine on each: null once there is nothing.
function lose(track: Track, seconds: number, rate = 60): (Track | null)[] {
  const left: (Track | null)[] = []
  let now: Track | null = track
  for (let frame = 0; frame < Math.round(seconds * rate); frame++) {
    now = trackAt(now, null, 1 / rate)
    left.push(now)
  }
  return left
}

// The figurine `seconds` after its Alert was cleared.
const lostFor = (track: Track, seconds: number, rate = 60) => lose(track, seconds, rate).at(-1) ?? null

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

    expect(cleared).toEqual({ ...shown, alertId: null, heading: 0, walking: expect.any(Number), lost: 0 })
    expect(trackAt(cleared, null, FRAME)?.x_norm).toBe(shown.x_norm)
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

describe('the last known position', () => {
  it('is none while the intruder is seen, and none where there never was one', () => {
    expect(lastKnown(null)).toBeNull()
    expect(lastKnown(standing('i1', 0.55, 3))).toBeNull()
    expect(lastKnown(last(play(standing('i1', 0.15, 1), 0.35, 0.5)))).toBeNull()
  })

  it('is where the figurine last stood, from the frame its Alert is cleared on', () => {
    const walking = last(play(standing('i1', 0.3, 3), 0.62, 0.5))
    const cleared = trackAt(walking, null, FRAME)

    expect(walking.x_norm).toBeLessThan(0.62)
    expect(lastKnown(cleared)?.x_norm).toBe(walking.x_norm)
    expect(cleared?.lost).toBe(0)
  })

  it('stays there for about five seconds', () => {
    const left = lose(standing('i1', 0.62, 3), LAST_KNOWN_SECONDS)

    expect(LAST_KNOWN_SECONDS).toBeGreaterThanOrEqual(4)
    expect(LAST_KNOWN_SECONDS).toBeLessThanOrEqual(6)
    expect(left.every((track) => lastKnown(track)?.x_norm === 0.62)).toBe(true)
    expect(left.at(-1)?.lost).toBeCloseTo(LAST_KNOWN_SECONDS, 1)
  })

  it('is nothing once that time and a fade have passed, for good', () => {
    const cleared = standing('i1', 0.62, 3)

    expect(lostFor(cleared, LAST_KNOWN_SECONDS + FADE_SECONDS - 0.1)).not.toBeNull()
    expect(lostFor(cleared, LAST_KNOWN_SECONDS + FADE_SECONDS + 0.1)).toBeNull()
    expect(lostFor(cleared, 60)).toBeNull()
    expect(lastKnown(lostFor(cleared, 60))).toBeNull()
  })

  it('is the same whatever the frame rate, and in one step', () => {
    // The frame its Alert is cleared on starts the count, however long that frame took.
    const cleared = trackAt(standing('i1', 0.62, 3), null, 60) as Track
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
    const left = lostFor(standing('i1', 0.62, 3), 2)
    expect(trackAt(left, null, -1)?.lost).toBe(left?.lost)
  })
})

describe('the outline the figurine leaves', () => {
  // How much of it shows on each frame, from the one the Alert is cleared on until nothing is left.
  const levels = (cleared: Track) =>
    lose(cleared, LAST_KNOWN_SECONDS + 2).flatMap((track) => (track ? [lastKnown(track)?.level ?? Number.NaN] : []))

  it('comes as the figurine goes, in a fade: one fades in as much as the other fades out', () => {
    const left = lose(standing('i1', 0.62, 3), FADE_SECONDS + 0.5).map((track) => track as Track)

    expect(lastKnown(left[0] ?? null)?.level).toBe(0)
    expect(figurineLevel(left[0] as Track)).toBe(1)
    for (const track of left) expect((lastKnown(track)?.level ?? Number.NaN) + figurineLevel(track)).toBeCloseTo(1, 9)

    const half = left[Math.round((FADE_SECONDS / 2) * 60)] as Track
    expect(lastKnown(half)?.level).toBeCloseTo(0.5, 9)
    expect(lastKnown(left.at(-1) ?? null)?.level).toBe(1)
    expect(figurineLevel(left.at(-1) as Track)).toBe(0)
  })

  it('shows whole from the end of that fade until the five seconds are over', () => {
    const shown = levels(standing('i1', 0.62, 3))
    const whole = shown.slice(Math.ceil(FADE_SECONDS * 60) + 1, Math.floor(LAST_KNOWN_SECONDS * 60))

    expect(whole.length).toBeGreaterThan(4 * 60)
    expect(whole.every((level) => level === 1)).toBe(true)
  })

  it('then goes out in a fade, without a cut', () => {
    const shown = levels(standing('i1', 0.62, 3))
    const going = shown.slice(Math.floor(LAST_KNOWN_SECONDS * 60))
    const steps = going.slice(1).map((level, frame) => (going[frame] ?? 0) - level)

    expect(shown.length / 60).toBeCloseTo(LAST_KNOWN_SECONDS + FADE_SECONDS, 1)
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...steps)).toBeLessThan(0.05)
    expect(going.at(-1)).toBeLessThan(0.01)
  })

  it('never shows with the figurine whole: the figurine is all there is while its Alert is active', () => {
    const walking = play(standing('i1', 0.15, 1), 0.35, 1)

    expect(walking.every((track) => figurineLevel(track) === 1 && lastKnown(track) === null)).toBe(true)
    expect(figurineLevel(lostFor(standing('i1', 0.62, 3), LAST_KNOWN_SECONDS) as Track)).toBe(0)
  })

  it('stands still, at rest: a figurine cleared in mid-stride comes out of it and no longer moves', () => {
    const walking = last(play(standing('i1', 0.15, 1), 0.75, 0.5))
    expect(walking.walking).toBeGreaterThan(0.95)

    const left = lose(walking, LAST_KNOWN_SECONDS).map((track) => track as Track)
    const strides = left.map((track) => track.walking)

    expect(left.every((track) => track.x_norm === walking.x_norm && track.heading === 0)).toBe(true)
    expect(left.every((track) => track.walked === walking.walked && track.age === walking.age)).toBe(true)
    expect(strides).toEqual([...strides].sort((a, b) => b - a))
    expect(strides.every((stride, frame) => (strides[frame - 1] ?? walking.walking) - stride < 0.15)).toBe(true)
    // At rest before the figurine has faded out, and from then on.
    expect(left[Math.round(FADE_SECONDS * 60)]?.walking).toBeLessThan(0.01)
    expect(left.slice(90).every((track) => track.walking === 0)).toBe(true)
  })
})

describe('a new intruder while the last known position still shows', () => {
  // The first intruder's Alert cleared for `seconds`, then a second one raised at `x_norm`: every frame from
  // that one, for a second.
  function raisedAfter(seconds: number, x_norm: number): Tracks[] {
    let tracks: Tracks = { ...NO_TRACKS, intruder: standing('i1', 0.62, 3) }
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) tracks = tracksAt(tracks, null, FRAME)

    const shown: Tracks[] = []
    for (let frame = 0; frame < 60; frame++) {
      tracks = tracksAt(tracks, seen('i2', x_norm), FRAME)
      shown.push(tracks)
    }
    return shown
  }

  it('follows one intruder like its track alone does, with no former one', () => {
    let tracks = NO_TRACKS
    let alone: Track | null = null
    expect(tracksAt(tracks, null, FRAME)).toEqual(NO_TRACKS)

    for (const intruder of [seen('i1', 0.15), seen('i1', 0.35), seen('i1', 0.35), null, null]) {
      tracks = tracksAt(tracks, intruder, FRAME)
      alone = trackAt(alone, intruder, FRAME)
      expect(tracks).toEqual({ intruder: alone, former: null })
    }
  })

  it('stands the new one at its own place, at rest, without walking there', () => {
    const [raised] = raisedAfter(2, 0.2)

    expect(raised?.intruder).toEqual(standing('i2', 0.2))
    expect(lastKnown(raised?.intruder ?? null)).toBeNull()
  })

  it('keeps the former one where it was, and puts its outline out in a fade', () => {
    const shown = raisedAfter(2, 0.2)
    const former = shown.map(({ former }) => lastKnown(former))
    const going = former.flatMap((left) => (left ? [left.level] : []))
    const steps = going.slice(1).map((level, frame) => (going[frame] ?? 0) - level)

    expect(former[0]).toEqual({ x_norm: 0.62, level: 1 })
    expect(former.every((left) => left === null || left.x_norm === 0.62)).toBe(true)
    expect(Math.min(...steps)).toBeGreaterThan(0)
    expect(Math.max(...steps)).toBeLessThan(0.05)
    expect(going.length / 60).toBeCloseTo(FADE_SECONDS, 1)
    expect(shown.at(-1)?.former).toBeNull()
  })

  it('puts out from what shows of it an outline that had not fully come', () => {
    const before = lastKnown(lostFor(standing('i1', 0.62, 3), FADE_SECONDS / 4 + FRAME))
    const shown = raisedAfter(FADE_SECONDS / 4, 0.2)
    const going = shown.flatMap(({ former }) => (former ? [lastKnown(former)?.level ?? Number.NaN] : []))

    expect(before?.level).toBeGreaterThan(0.05)
    expect(before?.level).toBeLessThan(0.5)
    expect(going[0]).toBeLessThanOrEqual(before?.level ?? Number.NaN)
    expect(going[0]).toBeCloseTo(before?.level ?? Number.NaN, 1)
    expect(going).toEqual([...going].sort((a, b) => b - a))
    expect(going.length / 60).toBeLessThan(FADE_SECONDS / 2)
  })

  it('leaves no former one once the last known position has gone out by itself', () => {
    const [raised] = raisedAfter(LAST_KNOWN_SECONDS + FADE_SECONDS + 0.5, 0.2)

    expect(raised).toEqual({ intruder: standing('i2', 0.2), former: null })
  })

  it('leaves none either when another Alert is raised while the first is active: that intruder is still seen', () => {
    const tracks = tracksAt({ ...NO_TRACKS, intruder: standing('i1', 0.62, 3) }, seen('i2', 0.2), FRAME)

    expect(tracks).toEqual({ intruder: standing('i2', 0.2), former: null })
  })

  it('leaves the new one its own last known position once it is cleared in turn', () => {
    let tracks = raisedAfter(2, 0.2).at(-1) ?? NO_TRACKS
    for (let frame = 0; frame < 60; frame++) tracks = tracksAt(tracks, null, FRAME)

    expect(lastKnown(tracks.intruder)).toEqual({ x_norm: 0.2, level: 1 })
    expect(tracks.former).toBeNull()
  })
})
