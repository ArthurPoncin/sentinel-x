import { describe, expect, it } from 'vitest'
import { puffAt } from './steam'

describe('puffAt', () => {
  it("leaves the chimney's mouth unseen and is gone when its life ends, so the plume loops without a cut", () => {
    expect(puffAt(0)).toMatchObject({ rise: 0, drift: 0, opacity: 0 })
    expect(puffAt(1).opacity).toBe(0)
  })

  it('climbs, spreads and is carried downwind all along its life', () => {
    const ages = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]

    for (const key of ['rise', 'drift', 'radius'] as const) {
      const values = ages.map((age) => puffAt(age)[key])

      expect(values, key).toEqual([...values].sort((a, b) => a - b))
      expect(new Set(values).size, key).toBe(values.length)
    }
  })
})
