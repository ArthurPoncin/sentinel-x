import { describe, expect, it } from 'vitest'
import { ALARM_PERIOD, ARC_LIFE, ARC_REACH, ARCS, arcAt, arcsAt, blink } from './alarm'
import { BREATH_PERIOD } from './breathing'

describe('blink', () => {
  it('goes dark and lights up all the way within every beat, which breathing never does', () => {
    expect(blink(0)).toBe(0)
    expect(blink(ALARM_PERIOD / 4)).toBe(1)
    expect(blink((3 * ALARM_PERIOD) / 4)).toBe(0)
  })

  it('beats every ALARM_PERIOD, at least twice a second and far faster than the ring breathes', () => {
    expect(ALARM_PERIOD).toBeLessThanOrEqual(0.5)
    expect(ALARM_PERIOD).toBeLessThan(BREATH_PERIOD / 4)
    for (const t of [0.03, 0.2, 0.31, 0.44]) expect(blink(t + ALARM_PERIOD)).toBeCloseTo(blink(t))
  })

  it('never goes past dark or full', () => {
    for (let t = -ALARM_PERIOD; t < 2 * ALARM_PERIOD; t += 0.005) {
      expect(blink(t)).toBeGreaterThanOrEqual(0)
      expect(blink(t)).toBeLessThanOrEqual(1)
    }
  })

  it('does not cut: no step above half in a frame at 60 images a second', () => {
    for (let t = 0; t < ALARM_PERIOD; t += 1 / 240) {
      expect(Math.abs(blink(t + 1 / 60) - blink(t))).toBeLessThan(0.5)
    }
  })
})

describe('arcAt', () => {
  it('leaves the buzzer unseen and has died out at the end of its reach, so the sound loops without a cut', () => {
    expect(arcAt(0).opacity).toBe(0)
    expect(arcAt(1)).toEqual({ radius: ARC_REACH, opacity: 0 })
  })

  it('spreads at a steady pace, as sound does', () => {
    const radii = [0, 0.25, 0.5, 0.75, 1].map((age) => arcAt(age).radius)

    radii.slice(1).forEach((radius, i) => {
      expect(radius - (radii[i] ?? 0)).toBeCloseTo((radii[1] ?? 0) - (radii[0] ?? 0))
    })
    expect(radii[0]).toBeGreaterThan(0)
    expect(radii[0]).toBeLessThan(ARC_REACH)
  })

  it('fades as it spreads, once it has shown', () => {
    const shown = [0.1, 0.25, 0.5, 0.75, 0.9, 1].map((age) => arcAt(age).opacity)

    expect(shown).toEqual([...shown].sort((a, b) => b - a))
    expect(new Set(shown).size).toBe(shown.length)
    expect(shown[0]).toBeGreaterThan(0.8)
  })
})

describe('arcsAt', () => {
  it('keeps ARCS arcs in the air, one behind the other', () => {
    const radii = arcsAt(0.2).map((arc) => arc.radius)

    expect(radii).toHaveLength(ARCS)
    expect(new Set(radii.map((radius) => radius.toFixed(6))).size).toBe(ARCS)
  })

  it("sends an arc off at the start of every beat, with the LED ring's flash", () => {
    for (const beat of [0, 1, 2, 3, 7]) {
      const leaving = arcsAt(beat * ALARM_PERIOD).filter((arc) => arc.radius < arcAt(0).radius + 1e-9)

      expect(leaving, `beat ${beat}`).toHaveLength(1)
    }
  })

  it('starts over every ARC_LIFE', () => {
    expect(ARC_LIFE).toBeCloseTo(ARCS * ALARM_PERIOD)
    for (const t of [0.1, 0.62, 1.3]) {
      arcsAt(t + ARC_LIFE).forEach((arc, i) => {
        expect(arc.radius).toBeCloseTo(arcsAt(t)[i]?.radius ?? Number.NaN)
        expect(arc.opacity).toBeCloseTo(arcsAt(t)[i]?.opacity ?? Number.NaN)
      })
    }
  })
})
