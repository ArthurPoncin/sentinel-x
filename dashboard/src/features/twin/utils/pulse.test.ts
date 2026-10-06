import { describe, expect, it } from 'vitest'
import { BREATH_PERIOD } from './breathing'
import { PULSE_FLOOR, PULSE_PERIOD, pulse } from './pulse'

describe('pulse', () => {
  it('is brightest at the start of each beat and dimmest halfway', () => {
    expect(pulse(0)).toBeCloseTo(1)
    expect(pulse(PULSE_PERIOD / 2)).toBeCloseTo(PULSE_FLOOR)
    expect(pulse(PULSE_PERIOD)).toBeCloseTo(1)
  })

  it('beats every PULSE_PERIOD seconds, quicker than the LED ring breathes', () => {
    expect(PULSE_PERIOD).toBeLessThan(BREATH_PERIOD / 2)
    for (const t of [0.1, 0.5, 0.9]) expect(pulse(t + PULSE_PERIOD)).toBeCloseTo(pulse(t))
  })

  it('never goes dark, never goes past full', () => {
    for (let t = 0; t < PULSE_PERIOD; t += 0.02) {
      expect(pulse(t)).toBeGreaterThanOrEqual(PULSE_FLOOR - 1e-9)
      expect(pulse(t)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('is a short beat and a longer rest: under half its swing for most of the period', () => {
    const half = PULSE_FLOOR + (1 - PULSE_FLOOR) / 2
    const steps = Array.from({ length: 120 }, (_, step) => (step / 120) * PULSE_PERIOD)

    expect(steps.filter((t) => pulse(t) < half).length).toBeGreaterThan(steps.length / 2)
  })

  it('rises and falls smoothly: no step above 8 % in a frame at 60 images a second', () => {
    for (let t = 0; t < PULSE_PERIOD; t += 1 / 60) {
      expect(Math.abs(pulse(t + 1 / 60) - pulse(t))).toBeLessThan(0.08)
    }
  })
})
