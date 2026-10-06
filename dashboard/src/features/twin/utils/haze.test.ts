import { describe, expect, it } from 'vitest'
import { HAZE_CREEP, WISP_LIFE, wispAt } from './haze'

const AGES = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]

describe('wispAt', () => {
  it('seeps from the pipe unseen and is gone when its life ends, so the haze loops without a cut', () => {
    expect(wispAt(0)).toMatchObject({ creep: 0, sink: 0, opacity: 0 })
    expect(wispAt(1).opacity).toBe(0)
  })

  it('creeps away from the pipe and spreads all along its life', () => {
    for (const key of ['creep', 'radius'] as const) {
      const values = AGES.map((age) => wispAt(age)[key])

      expect(values, key).toEqual([...values].sort((a, b) => a - b))
      expect(new Set(values).size, key).toBe(values.length)
    }
    expect(wispAt(1).creep).toBeCloseTo(HAZE_CREEP)
  })

  it('sinks to the ground, and lies there for the second half of its life', () => {
    const sunk = AGES.map((age) => wispAt(age).sink)

    expect(sunk).toEqual([...sunk].sort((a, b) => a - b))
    for (const age of [0.5, 0.75, 1]) expect(wispAt(age).sink).toBe(1)
  })

  it('holds at its thickest in between: a bank around the pipe, not a plume leaving it', () => {
    for (const age of [0.2, 0.35, 0.5]) expect(wispAt(age).opacity).toBe(1)
    for (let age = 0; age <= 1; age += 0.01) {
      expect(wispAt(age).opacity).toBeGreaterThanOrEqual(0)
      expect(wispAt(age).opacity).toBeLessThanOrEqual(1)
    }
  })

  it('shows and thins out smoothly: no step above 2 % in a frame at 60 images a second', () => {
    const frame = 1 / 60 / WISP_LIFE

    for (let age = 0; age < 1; age += frame) {
      expect(Math.abs(wispAt(Math.min(1, age + frame)).opacity - wispAt(age).opacity)).toBeLessThan(0.02)
    }
  })
})
