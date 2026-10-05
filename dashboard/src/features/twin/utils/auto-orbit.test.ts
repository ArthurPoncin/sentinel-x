import { describe, expect, it } from 'vitest'
import { autoOrbitSpeed, type CameraTouch, RESUME_DELAY, RESUME_RAMP } from './auto-orbit'

const RELEASED_AT = 10
const released: CameraTouch = { kind: 'released', at: RELEASED_AT }
const resumesAt = RELEASED_AT + RESUME_DELAY

describe('autoOrbitSpeed', () => {
  it('is at full speed as long as the Operator has not touched the camera', () => {
    expect(autoOrbitSpeed({ kind: 'never' }, 0)).toBe(1)
    expect(autoOrbitSpeed({ kind: 'never' }, 3600)).toBe(1)
  })

  it('stops for as long as the Operator holds the camera', () => {
    expect(autoOrbitSpeed({ kind: 'holding' }, 0)).toBe(0)
    expect(autoOrbitSpeed({ kind: 'holding' }, 3600)).toBe(0)
  })

  it('stays stopped during the idle delay after the Operator lets go', () => {
    expect(autoOrbitSpeed(released, RELEASED_AT)).toBe(0)
    expect(autoOrbitSpeed(released, RELEASED_AT + RESUME_DELAY / 2)).toBe(0)
    expect(autoOrbitSpeed(released, resumesAt)).toBe(0)
  })

  it('picks up speed gradually once the delay has passed', () => {
    const speeds = [0.1, 0.25, 0.5, 0.75, 0.9].map((share) => autoOrbitSpeed(released, resumesAt + share * RESUME_RAMP))

    expect(speeds).toEqual([...speeds].sort((a, b) => a - b))
    expect(new Set(speeds).size).toBe(speeds.length)
    expect(speeds.at(0)).toBeGreaterThan(0)
    expect(speeds.at(0)).toBeLessThan(0.1)
    expect(autoOrbitSpeed(released, resumesAt + RESUME_RAMP / 2)).toBeCloseTo(0.5)
  })

  it('is back at full speed after the ramp and stays there', () => {
    expect(autoOrbitSpeed(released, resumesAt + RESUME_RAMP)).toBe(1)
    expect(autoOrbitSpeed(released, resumesAt + 3600)).toBe(1)
  })

  it('waits the whole delay again after a new interaction', () => {
    const touchedAgain: CameraTouch = { kind: 'released', at: resumesAt - 0.5 }
    const now = resumesAt + RESUME_RAMP

    expect(autoOrbitSpeed(released, now)).toBe(1)
    expect(autoOrbitSpeed(touchedAgain, now)).toBe(0)
  })
})
