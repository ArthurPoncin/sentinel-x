import { describe, expect, it } from 'vitest'
import { BREATH_FLOOR, BREATH_PERIOD, breath } from './breathing'

describe('breath', () => {
  it('is brightest at the start of each period and dimmest halfway', () => {
    expect(breath(0)).toBeCloseTo(1)
    expect(breath(BREATH_PERIOD / 2)).toBeCloseTo(BREATH_FLOOR)
    expect(breath(BREATH_PERIOD)).toBeCloseTo(1)
  })

  it('takes BREATH_PERIOD seconds, slowly: at least 3 s a breath', () => {
    expect(BREATH_PERIOD).toBeGreaterThanOrEqual(3)
    for (const t of [0.3, 1.1, 2.7]) expect(breath(t + BREATH_PERIOD)).toBeCloseTo(breath(t))
  })

  it('never goes dark, never goes past full', () => {
    for (let t = 0; t < BREATH_PERIOD; t += 0.05) {
      expect(breath(t)).toBeGreaterThanOrEqual(BREATH_FLOOR - 1e-9)
      expect(breath(t)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('rises and falls smoothly: no step above 2 % in a frame at 60 images a second', () => {
    for (let t = 0; t < BREATH_PERIOD; t += 1 / 60) {
      expect(Math.abs(breath(t + 1 / 60) - breath(t))).toBeLessThan(0.02)
    }
  })
})
