import { describe, expect, it } from 'vitest'
import type { Frame } from '@/shared/contract'
import {
  IMPULSE_LIFE,
  IMPULSE_RADIUS,
  IMPULSE_RISE,
  type Impulse,
  impulseShape,
  impulsesAt,
  MAX_IMPULSES,
  telemetryIn,
} from './link'
import { framesSince } from './noise'

const ts = '2026-10-07T09:12:00.000Z'
// The instant a frame of telemetry comes in, on the frames' clock.
const RECEIVED = 20
// A frame at 60 images a second.
const FRAME = 1 / 60

function telemetry(air = 185): Frame {
  return {
    type: 'telemetry',
    payload: { sentinel: 'sentinel-01', ts, readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 0.03 } },
  }
}

const status: Frame = { type: 'status', payload: { status: 'nominal', ts } }

function alert(state: 'raised' | 'cleared'): Frame {
  return {
    type: 'alert',
    payload: {
      alert_id: 'presence-1',
      sentinel: 'sentinel-01',
      source: 'esp32',
      kind: 'presence',
      severity: 'warning',
      state,
      ts,
      detail: {},
    },
  }
}

// The history as the live feed keeps it: a new array for each frame received.
const received = (history: readonly Frame[], frame: Frame): readonly Frame[] => [...history, frame]

// Feeds the impulses each new history, at its instant, from the history the Twin was shown first. The link is
// live unless the history's entry says otherwise.
function play(
  first: readonly Frame[],
  histories: readonly (readonly [now: number, frames: readonly Frame[], live?: boolean])[],
) {
  let seen = first
  let impulses: readonly Impulse[] = []
  for (const [now, frames, live = true] of histories) {
    impulses = impulsesAt(impulses, telemetryIn(framesSince(seen, frames)), live, now)
    seen = frames
  }
  return impulses
}

describe('telemetryIn', () => {
  it('finds the telemetry among the frames', () => {
    expect(telemetryIn([telemetry()])).toBe(true)
    expect(telemetryIn([status, alert('raised'), telemetry()])).toBe(true)
  })

  it('finds none in an Alert, raised or cleared, in a Status or in no frame at all', () => {
    expect(telemetryIn([alert('raised'), alert('cleared'), status])).toBe(false)
    expect(telemetryIn([])).toBe(false)
  })
})

describe('impulsesAt', () => {
  it('sends an impulse from the antenna as a frame of telemetry is received', () => {
    const before = received([], status)

    expect(play(before, [[RECEIVED, received(before, telemetry())]])).toEqual([{ startedAt: RECEIVED }])
  })

  it('sends one for each frame of telemetry, a second apart', () => {
    const first = received([], telemetry(185))
    const second = received(first, telemetry(190))
    const impulses = play([], [
      [RECEIVED, first],
      [RECEIVED + 1, second],
    ])

    // The first one is over by then: the link beats, one impulse at a time.
    expect(impulses).toEqual([{ startedAt: RECEIVED + 1 }])
  })

  it('sends none for an Alert, nor for a Status', () => {
    const raised = received([], alert('raised'))
    const cleared = received(raised, alert('cleared'))

    expect(
      play([], [
        [RECEIVED, raised],
        [RECEIVED + 1, cleared],
        [RECEIVED + 2, received(cleared, status)],
      ]),
    ).toEqual([])
  })

  it('replays none of the telemetry the Twin finds in the history as it opens', () => {
    const history = received(received([], telemetry(185)), telemetry(190))

    expect(play(history, [[RECEIVED, history]])).toEqual([])
    expect(play(history, [[RECEIVED, received(history, alert('raised'))]])).toEqual([])
  })

  it('sends none while the signal is lost, and none later for what came in then', () => {
    const before = received([], telemetry(185))
    const during = received(before, telemetry(190))
    const impulses = play(before, [
      [RECEIVED, during, false],
      [RECEIVED + FRAME, during],
    ])

    expect(impulses).toEqual([])
  })

  it('puts out the impulse on its way as the signal is lost', () => {
    const rising: readonly Impulse[] = [{ startedAt: RECEIVED }]

    expect(impulsesAt(rising, false, false, RECEIVED + 0.2)).toEqual([])
  })

  it('beats again once the signal is back', () => {
    const before = received([], telemetry(185))
    const back = received(before, telemetry(190))
    const impulses = play(before, [
      [RECEIVED, before, false],
      [RECEIVED + 5, back],
    ])

    expect(impulses).toEqual([{ startedAt: RECEIVED + 5 }])
  })

  it('follows the frames a replay plays, second after second', () => {
    const replay = [status, telemetry(185), alert('raised'), telemetry(190), telemetry(420)]
    // As the player rebuilds them: the frames received by each second, a new array every time.
    const at = (count: number) => replay.slice(0, count)

    expect(play(at(1), [[RECEIVED, at(2)]])).toEqual([{ startedAt: RECEIVED }])
    expect(play(at(2), [[RECEIVED, at(3)]])).toEqual([])
    expect(play(at(3), [[RECEIVED, at(4)]])).toEqual([{ startedAt: RECEIVED }])
  })

  it('sends one impulse for the frames a replay sought forward brings in at once', () => {
    const replay = [status, telemetry(185), telemetry(190), telemetry(420)]

    expect(play(replay.slice(0, 1), [[RECEIVED, replay]])).toEqual([{ startedAt: RECEIVED }])
  })

  it('lets an impulse play to its end when another leaves', () => {
    const impulses = impulsesAt([{ startedAt: RECEIVED }], true, true, RECEIVED + 0.4)

    expect(impulses).toEqual([{ startedAt: RECEIVED }, { startedAt: RECEIVED + 0.4 }])
  })

  it('lets the impulses that are over go, and keeps the same impulses while nothing changes', () => {
    const impulses: readonly Impulse[] = [{ startedAt: RECEIVED }, { startedAt: RECEIVED + 0.5 }]

    expect(impulsesAt(impulses, false, true, RECEIVED + 0.6)).toBe(impulses)
    expect(impulsesAt(impulses, false, true, RECEIVED + IMPULSE_LIFE)).toEqual([{ startedAt: RECEIVED + 0.5 }])
    expect(impulsesAt([], false, true, RECEIVED)).toHaveLength(0)
  })

  it(`keeps the ${MAX_IMPULSES} latest impulses at most`, () => {
    let impulses: readonly Impulse[] = []
    for (let step = 0; step < MAX_IMPULSES + 2; step++) {
      impulses = impulsesAt(impulses, true, true, RECEIVED + step * 0.1)
    }

    expect(impulses).toHaveLength(MAX_IMPULSES)
    expect(impulses.at(-1)).toEqual({ startedAt: RECEIVED + (MAX_IMPULSES + 1) * 0.1 })
  })

  it('does not change the impulses it is given', () => {
    const given: readonly Impulse[] = [{ startedAt: RECEIVED }]
    const copy = structuredClone(given)

    impulsesAt(given, true, true, RECEIVED + 0.2)
    impulsesAt(given, false, true, RECEIVED + IMPULSE_LIFE)
    impulsesAt(given, false, false, RECEIVED + 0.2)

    expect(given).toEqual(copy)
  })
})

describe('impulseShape', () => {
  const STEPS = Array.from({ length: 300 }, (_, step) => (step / 300) * IMPULSE_LIFE)

  it('is nothing before the impulse leaves and once its life is over', () => {
    expect(impulseShape(-FRAME)).toBeNull()
    expect(impulseShape(IMPULSE_LIFE)).toBeNull()
    expect(impulseShape(IMPULSE_LIFE + 3)).toBeNull()
  })

  it('is over before the next frame of telemetry, a second later', () => {
    expect(IMPULSE_LIFE).toBeLessThan(1)
    expect(IMPULSE_LIFE).toBeGreaterThanOrEqual(0.6)
  })

  it('leaves from the tip of the antenna, unseen, and rises all its life', () => {
    expect(impulseShape(0)).toEqual({ height: 0, radius: IMPULSE_RADIUS[0], glow: 0 })
    const heights = STEPS.map((elapsed) => impulseShape(elapsed)?.height ?? 0)
    for (let step = 1; step < heights.length; step++) {
      expect(heights[step], `step ${step}`).toBeGreaterThan(heights[step - 1] ?? 0)
    }
    expect(impulseShape(IMPULSE_LIFE - FRAME)?.height).toBeGreaterThan(0.99 * IMPULSE_RISE)
  })

  it('widens as it rises', () => {
    expect(impulseShape(0.6)?.radius).toBeGreaterThan(impulseShape(0.1)?.radius ?? 0)
    expect(impulseShape(IMPULSE_LIFE - FRAME)?.radius).toBeLessThanOrEqual(IMPULSE_RADIUS[1])
  })

  it('lights up at once, then fades out to nothing as its life ends', () => {
    const brightest = STEPS.reduce((at, elapsed) =>
      (impulseShape(elapsed)?.glow ?? 0) > (impulseShape(at)?.glow ?? 0) ? elapsed : at,
    )

    expect(brightest).toBeLessThan(0.25 * IMPULSE_LIFE)
    expect(impulseShape(brightest)?.glow).toBeGreaterThan(0.7)
    expect(impulseShape(IMPULSE_LIFE - FRAME)?.glow).toBeLessThan(0.01)
  })

  it('never goes under dark nor past full', () => {
    for (const elapsed of STEPS) {
      const glow = impulseShape(elapsed)?.glow ?? 0
      expect(glow).toBeGreaterThanOrEqual(0)
      expect(glow).toBeLessThanOrEqual(1)
    }
  })

  it('never cuts: no step in brightness above 25 % in a frame at 60 images a second', () => {
    for (let elapsed = 0; elapsed + FRAME < IMPULSE_LIFE; elapsed += FRAME) {
      const step = Math.abs((impulseShape(elapsed + FRAME)?.glow ?? 0) - (impulseShape(elapsed)?.glow ?? 0))

      expect(step, `elapsed ${elapsed}`).toBeLessThan(0.25)
    }
  })
})
