import { describe, expect, it } from 'vitest'
import { IMPACT_GAP, IMPACT_LIFE, IMPACT_REACH, impactShape, MAX_IMPACTS, struckBy, unstruck } from './impact'

const T0 = Date.parse('2026-07-11T10:00:00.000Z')

describe('struckBy', () => {
  it('sends an impact as the shield is raised: the strike of its raise', () => {
    const struck = struckBy(unstruck(null), T0, 10)

    expect(struck.impacts).toHaveLength(1)
    expect(struck.impacts[0]?.startedAt).toBe(10)
  })

  it('sends another each time the strike moves on, and none while it stays', () => {
    const raised = struckBy(unstruck(null), T0, 10)
    const held = struckBy(raised, T0, 10.5)
    const again = struckBy(held, T0 + 1000, 11)

    expect(held).toBe(raised)
    expect(again.impacts.map((impact) => impact.startedAt)).toEqual([10, 11])
  })

  it('sends none for a shield already raised as the Twin opens: that strike is past', () => {
    expect(struckBy(unstruck(T0), T0, 10).impacts).toEqual([])
  })

  it('strikes the dome at a point of its surface, above the ground, not twice running at the same', () => {
    const { impacts } = struckBy(struckBy(unstruck(null), T0, 10), T0 + 1000, 11)
    const [first, second] = impacts.map((impact) => impact.at)

    for (const [x, y, z] of [first, second] as [number, number, number][]) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1)
      expect(y).toBeGreaterThan(0.2)
    }
    expect(first).not.toEqual(second)
  })

  it('lets an impact die out alone, once its wave has spread', () => {
    const raised = struckBy(unstruck(null), T0, 10)

    expect(struckBy(raised, T0, 10 + IMPACT_LIFE - 0.01).impacts).toHaveLength(1)
    expect(struckBy(raised, T0, 10 + IMPACT_LIFE).impacts).toEqual([])
  })

  it('takes strikes closer than a wave can be told from the last as the one impact', () => {
    const raised = struckBy(unstruck(null), T0, 10)
    const close = struckBy(raised, T0 + 20, 10 + IMPACT_GAP / 2)
    const apart = struckBy(close, T0 + 400, 10 + 2 * IMPACT_GAP)

    expect(close.impacts).toHaveLength(1)
    expect(apart.impacts.map((impact) => impact.startedAt)).toEqual([10, 10 + 2 * IMPACT_GAP])
  })

  it('never holds more than MAX_IMPACTS, however fast and however long the strikes come', () => {
    let struck = unstruck(null)
    for (let strike = 0; strike < 2000; strike++) {
      // A refusal every 5 ms, the scene rebuilt on each: a brute force at full speed.
      struck = struckBy(struck, T0 + strike * 5, 10 + strike * 0.005)
      expect(struck.impacts.length).toBeLessThanOrEqual(MAX_IMPACTS)
    }
    expect(struck.impacts.length).toBeGreaterThan(1)
  })

  it('drops its impacts as the strike goes back in time, a replay wound back, and sends none for it', () => {
    const again = struckBy(struckBy(unstruck(null), T0, 10), T0 + 1000, 11)
    const back = struckBy(again, T0, 11.1)

    expect(back.impacts).toEqual([])
    // Played forward again from there, the strike it was wound back from lands once more.
    expect(struckBy(back, T0 + 1000, 12).impacts.map((impact) => impact.startedAt)).toEqual([12])
  })

  it('drops its impacts as the shield is lowered: wound back to before the attack, none is left for the next', () => {
    const raised = struckBy(unstruck(null), T0, 10)
    const lowered = struckBy(raised, null, 10.2)

    expect(lowered.impacts).toEqual([])
    expect(struckBy(lowered, T0, 10.4).impacts.map((impact) => impact.startedAt)).toEqual([10.4])
  })
})

describe('impactShape', () => {
  it('is nothing before the strike and once its life is over', () => {
    expect(impactShape(-0.1)).toBeNull()
    expect(impactShape(IMPACT_LIFE)).toBeNull()
  })

  it('spreads from the point struck, ever further, up to its reach', () => {
    const radii = [0, 0.2, 0.5, 0.9, IMPACT_LIFE - 0.001].map((elapsed) => impactShape(elapsed)?.radius ?? Number.NaN)

    expect(radii[0]).toBe(0)
    expect(radii).toEqual(radii.toSorted((a, b) => a - b))
    expect(radii.at(-1)).toBeCloseTo(IMPACT_REACH, 2)
  })

  it('lights up at once and fades all the way out, without a cut', () => {
    expect(impactShape(0.05 * IMPACT_LIFE)?.glow).toBeGreaterThan(0.5)
    expect(impactShape(0.5 * IMPACT_LIFE)?.glow).toBeLessThan(impactShape(0.2 * IMPACT_LIFE)?.glow ?? 0)
    expect(impactShape(IMPACT_LIFE - 0.001)?.glow).toBeCloseTo(0, 3)
  })
})
