import { describe, expect, it } from 'vitest'
import { CALM_TEMP, heatLevel, PEAK_TEMP } from './heat-level'

describe('heatLevel', () => {
  it('is 0 before any Reading', () => {
    expect(heatLevel(null)).toBe(0)
  })

  it('stays at 0 while the temperature Reading is calm', () => {
    expect(heatLevel(31.2)).toBe(0)
    expect(heatLevel(CALM_TEMP)).toBe(0)
  })

  it('rises with the temperature Reading', () => {
    const levels = [32.4, 34.5, 36, 38.5].map(heatLevel)

    expect(levels).toEqual([...levels].sort((a, b) => a - b))
    expect(new Set(levels).size).toBe(levels.length)
    expect(heatLevel((CALM_TEMP + PEAK_TEMP) / 2)).toBeCloseTo(0.5)
  })

  it('stays at 1 from the peak on', () => {
    expect(heatLevel(PEAK_TEMP)).toBe(1)
    expect(heatLevel(55)).toBe(1)
  })
})
