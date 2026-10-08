import { describe, expect, it } from 'vitest'
import { figureHeight, SWEEP_SECONDS } from './figure'
import { BURST, burstMote, createRange, HIT_RADIUS, hitAt, isWhole, landsAt, SHOT, STRUCK_SECONDS, struckFigurine } from './shooting'

const AT = { x: 2, z: -1 }
const chest = figureHeight() / 2

describe('hitAt', () => {
  it('hits a figurine a level shot goes through, and says how far along', () => {
    expect(hitAt([2, chest, 4], [0, 0, -1], AT)).toBeCloseTo(5)
  })

  it('still hits one it passes close by, and misses one it passes further from', () => {
    expect(hitAt([2 + HIT_RADIUS * 0.9, chest, 4], [0, 0, -1], AT)).not.toBeNull()
    expect(hitAt([2 + HIT_RADIUS * 1.1, chest, 4], [0, 0, -1], AT)).toBeNull()
  })

  it('goes by the whole figurine, feet to head, and no higher', () => {
    expect(hitAt([2, 0.01, 4], [0, 0, -1], AT)).not.toBeNull()
    expect(hitAt([2, figureHeight(), 4], [0, 0, -1], AT)).not.toBeNull()
    expect(hitAt([2, figureHeight() + 2 * HIT_RADIUS, 4], [0, 0, -1], AT)).toBeNull()
  })

  it('hits from above, as the camera looks down on the site', () => {
    const down = Math.SQRT1_2

    expect(hitAt([2, chest + 3, 2], [0, -down, -down], AT)).toBeCloseTo(3 / down)
    expect(hitAt([2, 5, -1], [0, -1, 0], AT)).not.toBeNull()
  })

  it('misses a figurine that stands behind', () => {
    expect(hitAt([2, chest, 4], [0, 0, 1], AT)).toBeNull()
  })
})

describe('landsAt', () => {
  it('ends on the ground under a shot that looks down', () => {
    const [x, y, z] = landsAt([0, 3, 4], [0, -0.6, -0.8])

    expect([x, y, z]).toEqual([0, expect.closeTo(0), expect.closeTo(0)])
  })

  it('ends as far as it reaches when it meets no ground', () => {
    expect(landsAt([0, 3, 0], [0, 0, -1])).toEqual([0, 3, -SHOT.reach])
    expect(landsAt([0, 3, 0], [0, 1, 0])).toEqual([0, 3 + SHOT.reach, 0])
  })
})

describe('struckFigurine', () => {
  it('leaves whole a figurine that was not hit', () => {
    expect(struckFigurine(undefined)).toEqual({ level: 1, swept: 1 })
  })

  it('shows nothing of one that was, for a few seconds', () => {
    expect(struckFigurine(0)).toEqual({ level: 0, swept: 0 })
    expect(struckFigurine(STRUCK_SECONDS - 0.01).level).toBe(0)
    expect(isWhole(STRUCK_SECONDS - 0.01)).toBe(false)
  })

  it('then sweeps it in again from its feet, until it is whole', () => {
    const half = struckFigurine(STRUCK_SECONDS + SWEEP_SECONDS / 2)

    expect(half.level).toBe(1)
    expect(half.swept).toBeCloseTo(0.5)
    expect(isWhole(STRUCK_SECONDS + SWEEP_SECONDS / 2)).toBe(false)
    expect(isWhole(STRUCK_SECONDS + SWEEP_SECONDS)).toBe(true)
  })
})

describe('burstMote', () => {
  const all = (age: number, tall = 0, wide = 0) => Array.from({ length: BURST.motes }, (_, index) => burstMote(index, age, tall, wide))

  it('starts the sparks of a shot at the point it hit', () => {
    for (const mote of all(0)) {
      expect(Math.hypot(mote.x, mote.y, mote.z)).toBeCloseTo(0)
      expect(mote.size).toBe(BURST.size)
    }
  })

  it('starts the motes of a figurine all over it, feet to head', () => {
    const motes = all(0, 0.5, 0.07)

    expect(Math.min(...motes.map(({ y }) => y))).toBeLessThan(0.05)
    expect(Math.max(...motes.map(({ y }) => y))).toBeGreaterThan(0.45)
    expect(Math.max(...motes.map(({ x, z }) => Math.hypot(x, z)))).toBeLessThanOrEqual(0.07 + 1e-9)
  })

  it('flies them off every way, and no further than they can get', () => {
    const motes = all(BURST.seconds / 2)
    const out = motes.map(({ x, z }) => Math.hypot(x, z))

    expect(Math.min(...motes.map(({ x }) => x))).toBeLessThan(0)
    expect(Math.max(...motes.map(({ x }) => x))).toBeGreaterThan(0)
    expect(Math.min(...out)).toBeGreaterThan(0)
    expect(Math.max(...out)).toBeLessThanOrEqual(BURST.speed / BURST.drag)
  })

  it('has them all gone by the time the burst is over', () => {
    for (const mote of all(BURST.seconds)) expect(mote.size).toBe(0)
    for (const mote of all(2 * BURST.seconds)) expect(mote.size).toBe(0)
  })
})

describe('createRange', () => {
  it('starts with no one standing and no one hit, each range its own', () => {
    const range = createRange()
    range.struck.set('a', 0)

    expect(createRange()).toEqual({ standing: [], struck: new Map() })
  })
})
