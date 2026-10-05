import { describe, expect, it } from 'vitest'
import { CALM_AIR, CRITICAL_AIR, gasLevel } from './gas-level'

describe('gasLevel', () => {
  it('is 0 before any Reading', () => {
    expect(gasLevel(null)).toBe(0)
  })

  it('stays at 0 while the gas Reading is calm', () => {
    expect(gasLevel(180)).toBe(0)
    expect(gasLevel(CALM_AIR)).toBe(0)
  })

  it('rises with the gas Reading', () => {
    const levels = [260, 320, 480, 600].map(gasLevel)

    expect(levels).toEqual([...levels].sort((a, b) => a - b))
    expect(new Set(levels).size).toBe(levels.length)
    expect(gasLevel((CALM_AIR + CRITICAL_AIR) / 2)).toBeCloseTo(0.5)
  })

  it('stays at 1 from critical on', () => {
    expect(gasLevel(CRITICAL_AIR)).toBe(1)
    expect(gasLevel(840)).toBe(1)
  })
})
