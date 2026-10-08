import { describe, expect, it } from 'vitest'
import { blend, DEMOS } from './demo'
import { project } from './hologram'
import { HOLD } from './interpret'
import { LESSONS } from './lessons'
import { modelHand } from './model-hand'
import { hammerOf, HAMMER_BACK, HAMMER_DOWN, isOpen, poseOf } from './pose'

const only = (hands: readonly ReturnType<typeof modelHand>[]) => {
  expect(hands).toHaveLength(1)
  return hands[0] as ReturnType<typeof modelHand>
}

describe('blend', () => {
  it('takes a hand from one pose to another, each joint in a straight line', () => {
    const [open, closed] = [modelHand('flat'), modelHand('fist')]
    const tip = (hand: typeof open) => hand.fingers[2].joints[4]

    expect(blend(open, closed, 0).fingers).toEqual(open.fingers)
    expect(blend(open, closed, 1).fingers).toEqual(closed.fingers)
    expect(blend(open, closed, 0.5).fingers[2].joints[4][2]).toBeCloseTo((tip(open)[2] + tip(closed)[2]) / 2)
    expect(blend(open, closed, 0.5).grab).toBeCloseTo(0.5)
  })
})

describe('the gesture a lesson plays', () => {
  it('starts in the pose the lesson is about', () => {
    for (const pose of ['flat', 'fist', 'edge', 'thumb-up', 'thumb-down', 'aim'] as const) {
      expect(poseOf(only(DEMOS[pose](0).hands))).toBe(pose)
    }
    expect(DEMOS.spread(0).hands.every(isOpen)).toBe(true)
    expect(poseOf(only(DEMOS.pistol(0).hands))).toBe('aim')
  })

  it('keeps a hand that steers or aims in its pose all along', () => {
    for (let seconds = 0; seconds < 12; seconds += 0.25) {
      expect(poseOf(only(DEMOS.flat(seconds).hands))).toBe('flat')
      expect(poseOf(only(DEMOS.aim(seconds).hands))).toBe('aim')
      expect(poseOf(only(DEMOS.edge(seconds).hands))).toBe('edge')
    }
  })

  it('moves two hands apart, then together', () => {
    const gap = (seconds: number) => {
      const [one, other] = DEMOS.spread(seconds).hands
      return (one?.palm[0] ?? 0) - (other?.palm[0] ?? 0)
    }

    expect(gap(2)).toBeGreaterThan(gap(0) + 50)
    expect(gap(4)).toBeCloseTo(gap(0))
  })

  it('opens a fist and closes it again once it has wound both ways', () => {
    expect(only(DEMOS.fist(1).hands).palm[0]).toBeGreaterThan(50)
    expect(only(DEMOS.fist(3).hands).palm[0]).toBeLessThan(-50)
    expect(poseOf(only(DEMOS.fist(5).hands))).toBe('flat')
    expect(poseOf(only(DEMOS.fist(5.9).hands))).toBe('fist')
  })

  it('sweeps a hand on its edge across the sensor and back', () => {
    expect(only(DEMOS.edge(0).hands).palm[0]).toBeGreaterThan(50)
    expect(only(DEMOS.edge(1.8).hands).palm[0]).toBeLessThan(-50)
    expect(only(DEMOS.edge(3.5).hands).palm[0]).toBeGreaterThan(50)
  })

  it('fills the ring for as long as a thumb must be held, then lights it', () => {
    const demo = DEMOS['thumb-down']

    expect(demo(0)).toMatchObject({ hold: 0, flash: 0 })
    expect(demo(HOLD / 2).hold).toBeCloseTo(0.5)
    expect(demo(HOLD + 0.01).hold).toBe(1)
    expect(demo(HOLD + 0.01).flash).toBeGreaterThan(0.9)
    expect(demo(HOLD + 1).hold).toBeNull()
  })

  it('fires the pistol: the thumb drawn back comes down, and the shot is lit', () => {
    expect(hammerOf(only(DEMOS.pistol(0).hands))).toBeLessThanOrEqual(HAMMER_BACK)
    expect(DEMOS.pistol(0.8).flash).toBe(0)
    expect(hammerOf(only(DEMOS.pistol(1.1).hands))).toBeGreaterThanOrEqual(HAMMER_DOWN)
    expect(DEMOS.pistol(1.1).flash).toBeGreaterThan(0.5)
    expect(hammerOf(only(DEMOS.pistol(2.5).hands))).toBeLessThanOrEqual(HAMMER_BACK)
  })

  it('shows no hand for the gesture that is not told, and the pistol once it is found', () => {
    const secret = LESSONS.find(({ id }) => id === 'secret')

    for (const seconds of [0, 1, 7.3]) expect(secret?.demo(seconds).hands).toHaveLength(0)
    expect(secret?.secret?.demo).toBe(DEMOS.pistol)
  })
})

describe('project', () => {
  const camera = { target: [0, 200, 0] as [number, number, number], distance: 800, yaw: 0, pitch: 0 }

  it('puts what is looked at in the middle, at its own size', () => {
    const [x, y, scale] = project([0, 200, 0], camera)

    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(scale).toBe(1)
  })

  it('sees the hands as the Operator does: their right to the right, up upward, and larger when nearer', () => {
    expect(project([50, 200, 0], camera)[0]).toBeCloseTo(50)
    expect(project([0, 250, 0], camera)[1]).toBeCloseTo(-50)
    expect(project([0, 200, 100], camera)[2]).toBeGreaterThan(1)
    expect(project([0, 200, -100], camera)[2]).toBeLessThan(1)
  })

  it('looks down on them once raised: what is further from the Operator is drawn higher', () => {
    expect(project([0, 200, -100], { ...camera, pitch: 1 })[1]).toBeLessThan(0)
  })

  it('goes round them with the yaw: turned to the right, the right is the nearer side', () => {
    expect(project([100, 200, 0], { ...camera, yaw: Math.PI / 2 })[2]).toBeGreaterThan(1)
  })

  it('never turns a point over, however near the eye', () => {
    expect(project([0, 200, 5000], camera)[2]).toBeGreaterThan(0)
  })
})
