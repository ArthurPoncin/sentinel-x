import { describe, expect, it } from 'vitest'
import {
  domeFlash,
  FLASHES_PER_SWEEP,
  lapAt,
  SWEEP_LEAD,
  SWEEP_PERIOD,
  SWEEP_TAIL,
  type Sweeps,
  sweepGlow,
  sweepsAt,
} from './presence'

// The instant the `presence` Alert is raised, on the frames' clock.
const RAISED = 12
// A frame at 60 images a second, in seconds and as a share of a sweep.
const FRAME = 1 / 60
const FRAME_OF_SWEEP = FRAME / SWEEP_PERIOD

// Plays the frames `events` gives, oldest first: at each instant, whether a `presence` Alert is active.
function play(events: readonly (readonly [now: number, present: boolean])[]): Sweeps | null {
  return events.reduce<Sweeps | null>((sweeps, [now, present]) => sweepsAt(sweeps, present, now), null)
}

describe('sweepsAt', () => {
  it('leaves the fence alone while nobody is near', () => {
    expect(sweepsAt(null, false, RAISED)).toBeNull()
    expect(lapAt(null, RAISED)).toBeNull()
  })

  it('starts a sweep as the presence Alert is raised', () => {
    const sweeps = sweepsAt(null, true, RAISED)

    expect(lapAt(sweeps, RAISED)).toBe(0)
    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD / 4)).toBeCloseTo(0.25)
  })

  it('sweeps again and again while the Alert is active', () => {
    const sweeps = play([
      [RAISED, true],
      [RAISED + 1, true],
      [RAISED + 5 * SWEEP_PERIOD, true],
    ])

    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD * 0.5)).toBeCloseTo(0.5)
    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD * 1.5)).toBeCloseTo(0.5)
    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD * 40.25)).toBeCloseTo(0.25)
  })

  it('takes the sweep in progress to its end once the Alert is cleared, and starts no other', () => {
    const cleared = RAISED + SWEEP_PERIOD * 0.4
    const sweeps = play([
      [RAISED, true],
      [cleared, false],
    ])

    expect(lapAt(sweeps, cleared)).toBeCloseTo(0.4)
    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD * 0.99)).toBeCloseTo(0.99)
    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD)).toBeNull()
    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD * 1.5)).toBeNull()
  })

  it('ends on the sweep the Alert is cleared in, however many came before', () => {
    const sweeps = play([
      [RAISED, true],
      [RAISED + SWEEP_PERIOD * 2.3, false],
    ])

    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD * 2.9)).toBeCloseTo(0.9)
    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD * 3)).toBeNull()
  })

  it('keeps to that end frame after frame, then leaves the fence alone', () => {
    const cleared = RAISED + SWEEP_PERIOD * 0.4
    const ending = play([
      [RAISED, true],
      [cleared, false],
    ])

    expect(sweepsAt(ending, false, cleared + FRAME)).toEqual(ending)
    expect(sweepsAt(ending, false, RAISED + SWEEP_PERIOD)).toBeNull()
    expect(sweepsAt(ending, false, RAISED + SWEEP_PERIOD + 30)).toBeNull()
  })

  it('goes on without starting over when the presence comes back before the sweep is over', () => {
    const back = RAISED + SWEEP_PERIOD * 0.7
    const sweeps = play([
      [RAISED, true],
      [RAISED + SWEEP_PERIOD * 0.4, false],
      [back, true],
    ])

    expect(lapAt(sweeps, back)).toBeCloseTo(0.7)
    expect(lapAt(sweeps, RAISED + SWEEP_PERIOD * 1.5)).toBeCloseTo(0.5)
  })

  it('starts a new sweep when the presence comes back after the last one is over', () => {
    const back = RAISED + SWEEP_PERIOD * 3.2
    const sweeps = play([
      [RAISED, true],
      [RAISED + SWEEP_PERIOD * 0.4, false],
      [back, true],
    ])

    expect(lapAt(sweeps, back)).toBe(0)
  })

  it('does not change the sweeps it is given', () => {
    const given = { startedAt: RAISED, endsAt: Number.POSITIVE_INFINITY }
    const copy = { ...given }

    sweepsAt(given, false, RAISED + 1)
    sweepsAt(given, true, RAISED + 1)

    expect(given).toEqual(copy)
  })
})

describe('sweepGlow', () => {
  const PLACES = Array.from({ length: 101 }, (_, step) => step / 100)
  const LAPS = Array.from({ length: 201 }, (_, step) => step / 200)
  // Where along the fence the sweep is brightest.
  const head = (lap: number) =>
    PLACES.reduce((brightest, place) => (sweepGlow(place, lap) > sweepGlow(brightest, lap) ? place : brightest))

  it('leaves the whole fence dark as a sweep starts and as it ends, so that sweeps join without a cut', () => {
    for (const place of PLACES) {
      expect(sweepGlow(place, 0), `place ${place}`).toBe(0)
      expect(sweepGlow(place, 1), `place ${place}`).toBeCloseTo(0)
    }
  })

  it("goes round the fence, from the gate's first post to its last", () => {
    const heads = [0.1, 0.25, 0.4, 0.55, 0.7].map(head)

    expect(heads).toEqual([...heads].sort((a, b) => a - b))
    expect(new Set(heads).size).toBe(heads.length)
    expect(heads.at(0)).toBeLessThan(0.2)
    expect(heads.at(-1)).toBeGreaterThan(0.8)
  })

  it('lights every place of the fence in full once in a sweep', () => {
    for (const place of PLACES) {
      const reached = (place + SWEEP_LEAD) / (1 + SWEEP_LEAD + SWEEP_TAIL)

      expect(sweepGlow(place, reached), `place ${place}`).toBeCloseTo(1)
    }
  })

  it('trails a tail behind its head and lights nothing far ahead of it', () => {
    const lap = 0.5
    const at = head(lap)

    expect(sweepGlow(at - SWEEP_TAIL / 2, lap)).toBeGreaterThan(0)
    expect(sweepGlow(at - SWEEP_TAIL / 2, lap)).toBeLessThan(sweepGlow(at - SWEEP_TAIL / 4, lap))
    expect(sweepGlow(at - SWEEP_TAIL - 0.01, lap)).toBe(0)
    expect(sweepGlow(at + SWEEP_LEAD + 0.01, lap)).toBe(0)
  })

  it('never goes under dark nor past full', () => {
    for (const place of PLACES) {
      for (const lap of LAPS) {
        expect(sweepGlow(place, lap)).toBeGreaterThanOrEqual(0)
        expect(sweepGlow(place, lap)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('lights a post up over a few frames: no step above half in a frame at 60 images a second', () => {
    for (const place of [0, 0.25, 0.5, 0.75, 1]) {
      for (let lap = 0; lap < 1; lap += FRAME_OF_SWEEP) {
        const step = Math.abs(sweepGlow(place, Math.min(1, lap + FRAME_OF_SWEEP)) - sweepGlow(place, lap))

        expect(step, `place ${place}, lap ${lap}`).toBeLessThan(0.5)
      }
    }
  })
})

describe('domeFlash', () => {
  const FLASH = 1 / FLASHES_PER_SWEEP

  it('is dark as a sweep starts and as it ends: the dome goes out with the last sweep, without a cut', () => {
    expect(domeFlash(0)).toBe(0)
    expect(domeFlash(1)).toBeCloseTo(0)
  })

  it('flashes FLASHES_PER_SWEEP times in a sweep, in full, and goes dark between two flashes', () => {
    expect(Number.isInteger(FLASHES_PER_SWEEP)).toBe(true)
    for (let flash = 0; flash < FLASHES_PER_SWEEP; flash++) {
      expect(domeFlash((flash + 0.5) * FLASH), `flash ${flash}`).toBeCloseTo(1)
      expect(domeFlash(flash * FLASH), `flash ${flash}`).toBeCloseTo(0)
    }
  })

  // A sweep in small steps, each taken at its middle: none falls right on an edge of a flash.
  const steps = Array.from({ length: 240 }, (_, step) => (step + 0.5) / 240)

  it('is lit for as long as it is dark', () => {
    expect(steps.filter((lap) => domeFlash(lap) > 0.5)).toHaveLength(steps.length / 2)
  })

  it('blinks: several flashes a second, each with steep edges', () => {
    const period = SWEEP_PERIOD / FLASHES_PER_SWEEP
    const onAnEdge = steps.filter((lap) => domeFlash(lap) > 0.05 && domeFlash(lap) < 0.95)

    expect(period).toBeLessThan(1)
    expect(onAnEdge.length).toBeLessThan(steps.length / 3)
  })

  it('never cuts: no step above 30 % in a frame at 60 images a second', () => {
    for (let lap = 0; lap < 1; lap += FRAME_OF_SWEEP) {
      expect(Math.abs(domeFlash(lap + FRAME_OF_SWEEP) - domeFlash(lap))).toBeLessThan(0.3)
    }
  })
})
