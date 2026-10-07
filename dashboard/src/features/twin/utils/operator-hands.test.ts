import { describe, expect, it } from 'vitest'
import {
  handBones,
  handJoints,
  HOLOGRAM,
  hologramAnchor,
  hologramPoint,
  MOST_BONES,
  MOST_JOINTS,
  type Point,
  type SensedHand,
  type Stand,
  steered,
  TILT_SPEED,
  TURN_SPEED,
  ZOOM_SPEED,
} from './operator-hands'

const BOUNDS = { minPolar: 0.4, maxPolar: 1.4, minDistance: 4, maxDistance: 12 }
const STAND: Stand = { azimuth: 1, polar: 1, distance: 8 }
const still = { turn: 0, tilt: 0, zoom: 0 }

describe('steered', () => {
  it('leaves the camera where it stands under a hand at rest', () => {
    expect(steered(STAND, still, 0.1, BOUNDS)).toEqual(STAND)
  })

  it('turns the site the way the hand goes, as a drag does', () => {
    expect(steered(STAND, { ...still, turn: 1 }, 0.1, BOUNDS).azimuth).toBeCloseTo(1 - TURN_SPEED * 0.1)
    expect(steered(STAND, { ...still, turn: -1 }, 0.1, BOUNDS).azimuth).toBeCloseTo(1 + TURN_SPEED * 0.1)
  })

  it('brings the camera down as the hand is pulled back, and never past its bounds', () => {
    expect(steered(STAND, { ...still, tilt: 1 }, 0.1, BOUNDS).polar).toBeCloseTo(1 + TILT_SPEED * 0.1)
    expect(steered(STAND, { ...still, tilt: 1 }, 10, BOUNDS).polar).toBe(BOUNDS.maxPolar)
    expect(steered(STAND, { ...still, tilt: -1 }, 10, BOUNDS).polar).toBe(BOUNDS.minPolar)
  })

  it('brings it closer as the hand is lowered, by a share of its distance, within its bounds', () => {
    expect(steered(STAND, { ...still, zoom: 1 }, 0.1, BOUNDS).distance).toBeCloseTo(8 * Math.exp(-ZOOM_SPEED * 0.1))
    expect(steered(STAND, { ...still, zoom: 1 }, 10, BOUNDS).distance).toBe(BOUNDS.minDistance)
    expect(steered(STAND, { ...still, zoom: -1 }, 10, BOUNDS).distance).toBe(BOUNDS.maxDistance)
  })

  it('holds the distance when both bounds are the same, the whole stage in frame', () => {
    const whole = { ...BOUNDS, minDistance: 9, maxDistance: 9 }

    expect(steered({ ...STAND, distance: 9 }, { ...still, zoom: 1 }, 1, whole).distance).toBe(9)
  })
})

// A hand whose finger `f` has its joints at (f, 0..4, 0).
const HAND: SensedHand = {
  fingers: [0, 1, 2, 3, 4].map((finger) => ({ joints: [0, 1, 2, 3, 4].map((joint): Point => [finger, joint, 0]) })),
  tint: 'idle',
  charge: 0,
}

describe('the hologram of a hand', () => {
  it('shows the sensor’s resting point at its own centre, to scale', () => {
    expect(hologramPoint([0, HOLOGRAM.rest, 0])).toEqual([0, 0, 0])
    expect(hologramPoint([100, HOLOGRAM.rest + 100, -100])).toEqual([100 * HOLOGRAM.scale, 100 * HOLOGRAM.scale, -100 * HOLOGRAM.scale])
  })

  it('floats in the lower left of the view, as far in front of the camera whatever the frame', () => {
    const [x, y, z] = hologramAnchor(40, 16 / 9)
    const halfHeight = HOLOGRAM.depth * Math.tan((20 * Math.PI) / 180)

    expect(z).toBe(-HOLOGRAM.depth)
    expect(x).toBeCloseTo(HOLOGRAM.across * halfHeight * (16 / 9))
    expect(y).toBeCloseTo(HOLOGRAM.up * halfHeight)
    expect(x).toBeLessThan(0)
    expect(y).toBeLessThan(0)
    // Narrower, the frame brings it in with its edge.
    expect(Math.abs(hologramAnchor(40, 9 / 16)[0])).toBeLessThan(Math.abs(x))
  })

  it('draws three bones a finger from its knuckle, and the palm round them', () => {
    const bones = handBones(HAND)

    expect(bones).toHaveLength(MOST_BONES)
    expect(bones).toContainEqual([[2, 1, 0], [2, 2, 0]])
    expect(bones).toContainEqual([[2, 3, 0], [2, 4, 0]])
    // Across the knuckles, and from the wrist to the first and the last of them.
    expect(bones).toContainEqual([[1, 1, 0], [2, 1, 0]])
    expect(bones).toContainEqual([[1, 0, 0], [1, 1, 0]])
    expect(bones).toContainEqual([[4, 0, 0], [4, 1, 0]])
  })

  it('marks every joint past the wrist, and the wrist’s two ends', () => {
    const joints = handJoints(HAND)

    expect(joints).toHaveLength(MOST_JOINTS)
    expect(joints).toContainEqual([0, 4, 0])
    expect(joints).toContainEqual([4, 0, 0])
  })

  it('draws what it can of a hand short of a finger', () => {
    const short: SensedHand = { ...HAND, fingers: HAND.fingers.slice(0, 3) }

    expect(handBones(short).length).toBeLessThan(MOST_BONES)
    expect(handJoints(short).length).toBeLessThan(MOST_JOINTS)
  })
})
