import { describe, expect, it } from 'vitest'
import type { Frame } from '@/shared/contract'
import {
  amplitudeOf,
  clapsIn,
  framesSince,
  MAX_WAVES,
  WAVE_LIFE,
  WAVE_REACH,
  WAVE_START,
  type Wave,
  waveShape,
  wavesAt,
} from './noise'
import { SITE } from './site'

const ts = '2026-10-06T09:12:00.000Z'
// The instant the `noise` Alert comes in, on the frames' clock.
const CLAP = 20
// A frame at 60 images a second.
const FRAME = 1 / 60

function noise(state: 'raised' | 'cleared', value?: number, alertId = 'noise-1'): Frame {
  return {
    type: 'alert',
    payload: {
      alert_id: alertId,
      sentinel: 'sentinel-01',
      source: 'esp32',
      kind: 'noise',
      severity: 'info',
      state,
      value,
      ts,
      detail: {},
    },
  }
}

function telemetry(sound: number): Frame {
  return {
    type: 'telemetry',
    payload: { sentinel: 'sentinel-01', ts, readings: { temp: 31.2, humidity: 44, air: 185, pir: false, sound } },
  }
}

const status: Frame = { type: 'status', payload: { status: 'nominal', ts } }

const presence: Frame = {
  type: 'alert',
  payload: {
    alert_id: 'presence-1',
    sentinel: 'sentinel-01',
    source: 'esp32',
    kind: 'presence',
    severity: 'warning',
    state: 'raised',
    ts,
    detail: {},
  },
}

// The history as the live feed keeps it: a new array for each frame received, the latest `limit` only.
const received = (history: readonly Frame[], frame: Frame, limit = 1000): readonly Frame[] =>
  [...history, frame].slice(-limit)

// Feeds the waves the claps of each new history, at its instant, from the history the Twin was shown first.
function play(first: readonly Frame[], histories: readonly (readonly [now: number, frames: readonly Frame[]])[]) {
  let seen = first
  let waves: readonly Wave[] = []
  for (const [now, frames] of histories) {
    waves = wavesAt(waves, clapsIn(framesSince(seen, frames)), now)
    seen = frames
  }
  return waves
}

describe('framesSince', () => {
  it('gives the frames that came after those seen', () => {
    const seen = received(received([], status), telemetry(0.03))
    const clap = noise('raised', 0.82)

    expect(framesSince(seen, received(seen, clap))).toEqual([clap])
  })

  it('gives every frame of a feed seen empty', () => {
    const frames = received(received([], status), noise('raised', 0.82))

    expect(framesSince([], frames)).toEqual(frames)
  })

  it('gives nothing for the history already seen', () => {
    const seen = received(received([], status), noise('raised', 0.82))

    expect(framesSince(seen, seen)).toEqual([])
  })

  it('still finds where it was once the history has dropped its oldest frames', () => {
    const full = Array.from({ length: 1000 }, () => telemetry(0.03))
    const clap = noise('raised', 0.82)

    expect(framesSince(full, received(full, clap))).toEqual([clap])
  })

  it('replays nothing of a history that does not follow on from the one seen', () => {
    const seen = [telemetry(0.03)]
    const other = [status, noise('raised', 0.82)]

    expect(framesSince(seen, other)).toEqual([])
  })
})

describe('clapsIn', () => {
  it('finds a clap in each noise Alert raised, as loud as its value', () => {
    expect(clapsIn([noise('raised', 0.82)])).toEqual([0.82])
    expect(clapsIn([noise('raised', 0.82), telemetry(0.06), noise('raised', 0.3, 'noise-2')])).toEqual([0.82, 0.3])
  })

  it('finds none in a cleared, in another kind of Alert, in telemetry or in a Status', () => {
    expect(clapsIn([noise('cleared', 0.06), presence, telemetry(0.9), status])).toEqual([])
  })
})

describe('amplitudeOf', () => {
  it('keeps a value between 0 and 1 as it is, and holds any other to that range', () => {
    expect(amplitudeOf(0.82)).toBe(0.82)
    expect(amplitudeOf(0)).toBe(0)
    expect(amplitudeOf(1.4)).toBe(1)
    expect(amplitudeOf(-0.2)).toBe(0)
  })

  it('takes an Alert that does not say for a loud clap', () => {
    expect(amplitudeOf(undefined)).toBe(1)
    expect(amplitudeOf(Number.NaN)).toBe(1)
  })
})

describe('wavesAt', () => {
  it('sends a wave from the Enclosure as the noise Alert is raised, as loud as its value', () => {
    const before = received(received([], status), telemetry(0.03))
    const waves = play(before, [[CLAP, received(before, noise('raised', 0.82))]])

    expect(waves).toEqual([{ startedAt: CLAP, amplitude: 0.82 }])
  })

  it('takes the wave to its end when the Alert is cleared a cycle later', () => {
    const raised = received([], noise('raised', 0.82))
    const cleared = received(raised, noise('cleared', 0.06))
    const waves = play([], [
      [CLAP, raised],
      [CLAP + 1, cleared],
    ])

    expect(waves).toEqual([{ startedAt: CLAP, amplitude: 0.82 }])
    expect(wavesAt(waves, [], CLAP + WAVE_LIFE - FRAME)).toHaveLength(1)
    expect(wavesAt(waves, [], CLAP + WAVE_LIFE)).toEqual([])
  })

  it('sends two waves for two claps close together, the second leaving the first as it is', () => {
    const first = received([], noise('raised', 0.82))
    const second = received(received(first, noise('cleared', 0.06)), noise('raised', 0.5, 'noise-2'))
    const waves = play([], [
      [CLAP, first],
      [CLAP + 0.4, second],
    ])

    expect(waves).toEqual([
      { startedAt: CLAP, amplitude: 0.82 },
      { startedAt: CLAP + 0.4, amplitude: 0.5 },
    ])
    // At its end, the first one is still the wave it would have been alone.
    expect(wavesAt(waves, [], CLAP + WAVE_LIFE - FRAME)).toContainEqual({ startedAt: CLAP, amplitude: 0.82 })
  })

  it('sends one wave for each clap of the same batch of frames', () => {
    const frames = [noise('raised', 0.82), noise('cleared', 0.06), noise('raised', 0.4, 'noise-2')]

    expect(play([], [[CLAP, frames]])).toEqual([
      { startedAt: CLAP, amplitude: 0.82 },
      { startedAt: CLAP, amplitude: 0.4 },
    ])
  })

  it('replays none of the claps the Twin finds in the history as it opens', () => {
    const history = received(received([], noise('raised', 0.82)), telemetry(0.82))

    expect(play(history, [[CLAP, history]])).toEqual([])
    expect(play(history, [[CLAP, received(history, telemetry(0.06))]])).toEqual([])
  })

  it('replays no past wave when the feed reconnects', () => {
    const before = received(received([], noise('raised', 0.82)), noise('cleared', 0.06))
    // On a reconnection the Command Post sends its snapshot again: the Status and the latest telemetry.
    const after = received(received(before, status), telemetry(0.03))
    const waves = play([], [
      [CLAP, before],
      [CLAP + 30, after],
    ])

    expect(waves).toEqual([])
  })

  it('lets the waves that are over go, and keeps the same waves while nothing changes', () => {
    const waves: readonly Wave[] = [
      { startedAt: CLAP, amplitude: 0.82 },
      { startedAt: CLAP + 1, amplitude: 0.5 },
    ]

    expect(wavesAt(waves, [], CLAP + 0.5)).toBe(waves)
    expect(wavesAt(waves, [], CLAP + WAVE_LIFE + 0.1)).toEqual([{ startedAt: CLAP + 1, amplitude: 0.5 }])
  })

  it(`keeps the ${MAX_WAVES} latest waves at most`, () => {
    const claps = Array.from({ length: MAX_WAVES + 2 }, (_, clap) => clap / 10)
    const waves = wavesAt([], claps, CLAP)

    expect(waves.map((wave) => wave.amplitude)).toEqual(claps.slice(-MAX_WAVES))
  })

  it('does not change the waves it is given', () => {
    const given: readonly Wave[] = [{ startedAt: CLAP, amplitude: 0.82 }]
    const copy = structuredClone(given)

    wavesAt(given, [0.5], CLAP + 0.2)
    wavesAt(given, [], CLAP + WAVE_LIFE)

    expect(given).toEqual(copy)
  })
})

describe('waveShape', () => {
  const STEPS = Array.from({ length: 300 }, (_, step) => (step / 300) * WAVE_LIFE)
  const AMPLITUDES = [0, 0.3, 0.82, 1]

  it('is nothing before the wave leaves and once its life is over', () => {
    expect(waveShape(-FRAME, 1)).toBeNull()
    expect(waveShape(WAVE_LIFE, 1)).toBeNull()
    expect(waveShape(WAVE_LIFE + 3, 1)).toBeNull()
  })

  it('lives about a second and a half', () => {
    expect(WAVE_LIFE).toBeGreaterThanOrEqual(1.2)
    expect(WAVE_LIFE).toBeLessThanOrEqual(1.8)
  })

  it('leaves from the foot of the Enclosure, unseen, and spreads outward all its life', () => {
    for (const amplitude of AMPLITUDES) {
      expect(waveShape(0, amplitude)?.radius).toBeCloseTo(WAVE_START)
      expect(waveShape(0, amplitude)?.glow).toBe(0)
      const radii = STEPS.map((elapsed) => waveShape(elapsed, amplitude)?.radius ?? 0)
      for (let step = 1; step < radii.length; step++) {
        expect(radii[step], `amplitude ${amplitude}, step ${step}`).toBeGreaterThan(radii[step - 1] ?? 0)
      }
    }
  })

  it('crosses the whole socle on the loudest clap', () => {
    const farthest = SITE.socle.radius + Math.hypot(SITE.enclosure.x, SITE.enclosure.z)
    const last = waveShape(WAVE_LIFE - FRAME, 1)

    expect(WAVE_REACH).toBeCloseTo(farthest)
    expect(last?.radius).toBeGreaterThan(0.99 * farthest)
  })

  it('goes well clear of the Enclosure even on the faintest clap', () => {
    expect(waveShape(WAVE_LIFE - FRAME, 0)?.radius).toBeGreaterThan(WAVE_START + 0.4)
  })

  it('goes further and shines brighter the louder the clap', () => {
    for (const elapsed of [0.2, 0.5, 1, 1.4]) {
      const shapes = AMPLITUDES.map((amplitude) => waveShape(elapsed, amplitude))
      for (let louder = 1; louder < shapes.length; louder++) {
        expect(shapes[louder]?.radius, `elapsed ${elapsed}`).toBeGreaterThan(shapes[louder - 1]?.radius ?? 0)
        expect(shapes[louder]?.glow, `elapsed ${elapsed}`).toBeGreaterThan(shapes[louder - 1]?.glow ?? 0)
      }
    }
  })

  it('lights up at once, then fades out to nothing as its life ends', () => {
    const brightest = STEPS.reduce((at, elapsed) =>
      (waveShape(elapsed, 1)?.glow ?? 0) > (waveShape(at, 1)?.glow ?? 0) ? elapsed : at,
    )

    expect(brightest).toBeLessThan(0.25 * WAVE_LIFE)
    expect(waveShape(WAVE_LIFE - FRAME, 1)?.glow).toBeLessThan(0.01)
  })

  it('never goes under dark nor past full', () => {
    for (const amplitude of AMPLITUDES) {
      for (const elapsed of STEPS) {
        const glow = waveShape(elapsed, amplitude)?.glow ?? 0
        expect(glow).toBeGreaterThanOrEqual(0)
        expect(glow).toBeLessThanOrEqual(1)
      }
    }
  })

  it('never cuts: no step in brightness above 20 % in a frame at 60 images a second', () => {
    for (let elapsed = 0; elapsed + FRAME < WAVE_LIFE; elapsed += FRAME) {
      const step = Math.abs((waveShape(elapsed + FRAME, 1)?.glow ?? 0) - (waveShape(elapsed, 1)?.glow ?? 0))

      expect(step, `elapsed ${elapsed}`).toBeLessThan(0.2)
    }
  })

  it('widens its band as it spreads', () => {
    expect(waveShape(1, 1)?.width).toBeGreaterThan(waveShape(0.1, 1)?.width ?? 0)
  })
})
