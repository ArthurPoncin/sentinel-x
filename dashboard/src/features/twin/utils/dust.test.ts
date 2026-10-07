import { describe, expect, it } from 'vitest'
import { DUST, moteAt } from './dust'
import { SITE } from './site'

const MOTES = Array.from({ length: DUST.motes }, (_, index) => index)
// Instants over more than the slowest mote takes to cross the widest of the site.
const INSTANTS = Array.from({ length: 120 }, (_, step) => step * 0.9)
// The way the wind blows, over the ground.
const wind = { x: Math.sin(DUST.wind), z: Math.cos(DUST.wind) }

describe('moteAt', () => {
  it('keeps every mote over the socle, above the ground and what stands by the gate', () => {
    for (const index of MOTES) {
      for (const seconds of INSTANTS) {
        const mote = moteAt(index, seconds)

        expect(Math.hypot(mote.x, mote.z)).toBeLessThanOrEqual(SITE.socle.radius + 1e-9)
        expect(mote.y).toBeGreaterThanOrEqual(DUST.floor - 1e-9)
        expect(mote.y).toBeLessThanOrEqual(DUST.ceiling + 1e-9)
      }
    }
    expect(DUST.floor).toBeGreaterThan(SITE.fence.height)
  })

  it('carries them all the one way, slowly: down the wind, never across it nor back', () => {
    const STEP = 0.5

    for (const index of MOTES) {
      for (const seconds of INSTANTS) {
        const [from, to] = [moteAt(index, seconds), moteAt(index, seconds + STEP)]
        const along = (to.x - from.x) * wind.x + (to.z - from.z) * wind.z
        const across = (to.x - from.x) * wind.z - (to.z - from.z) * wind.x
        // But as it starts over, from the rim downwind back to the rim upwind.
        if (along < 0) {
          expect(Math.min(from.size, to.size)).toBeLessThan(DUST.size[0] / 10)
          continue
        }

        expect(across).toBeCloseTo(0)
        expect(along / STEP).toBeGreaterThanOrEqual(DUST.speed * (1 - DUST.gusts) - 1e-9)
        expect(along / STEP).toBeLessThanOrEqual(DUST.speed * (1 + DUST.gusts) + 1e-9)
      }
    }
  })

  it('shows a mote no larger than the plan says, and nothing of it as it starts over: no speck pops in or out', () => {
    for (const index of MOTES) {
      const sizes = INSTANTS.map((seconds) => moteAt(index, seconds).size)

      expect(Math.max(...sizes)).toBeLessThanOrEqual(DUST.size[1] + 1e-9)
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0)
    }
    // From one sixtieth of a second to the next, a mote never grows by more than a small share of itself.
    for (const index of MOTES) {
      for (let seconds = 0; seconds < 100; seconds += 1 / 60) {
        const grown = Math.abs(moteAt(index, seconds + 1 / 60).size - moteAt(index, seconds).size)
        expect(grown).toBeLessThan(DUST.size[1] / 20)
      }
    }
  })

  it('gives each mote a place of its own, the same at every call', () => {
    const places = MOTES.map((index) => moteAt(index, 12))

    expect(MOTES.map((index) => moteAt(index, 12))).toEqual(places)
    for (const [index, mote] of places.entries()) {
      for (const other of places.slice(index + 1)) {
        expect(Math.hypot(mote.x - other.x, mote.y - other.y, mote.z - other.z)).toBeGreaterThan(DUST.size[1])
      }
    }
  })
})
