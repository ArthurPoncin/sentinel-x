import { describe, expect, it } from 'vitest'
import { FIGURE, figureHeight } from './figure'
import { type LimbPose, type Pose, REST_BEND, STRIDE, turnedTo, walkCycle, walkPhase } from './walk'

// All through a cycle.
const PHASES = Array.from({ length: 200 }, (_, step) => step / 200)
const LEG = FIGURE.thigh.length + FIGURE.shin.length
const [LEFT, RIGHT] = [0, 1] as const

// Where a leg puts its foot, from its hip: how far ahead of it, and how far below.
function foot({ swing, bend }: LimbPose): { ahead: number; below: number } {
  const { thigh, shin } = FIGURE
  return {
    ahead: thigh.length * Math.sin(swing) + shin.length * Math.sin(swing - bend),
    below: thigh.length * Math.cos(swing) + shin.length * Math.cos(swing - bend),
  }
}

// How high a leg's foot is off the ground in a pose.
const offGround = (pose: Pose, side: 0 | 1) => LEG - pose.drop - foot(pose.legs[side]).below

const angles = ({ drop, legs, arms }: Pose) => [drop, ...[...legs, ...arms].flatMap(({ swing, bend }) => [swing, bend])]

function expectSamePose(pose: Pose, other: Pose) {
  const expected = angles(other)
  angles(pose).forEach((angle, index) => {
    expect(angle).toBeCloseTo(expected[index] ?? Number.NaN, 6)
  })
}

describe('the walk cycle', () => {
  it('is periodic: a whole cycle later, or earlier, the same pose', () => {
    for (const phase of PHASES) {
      expectSamePose(walkCycle(phase + 1), walkCycle(phase))
      expectSamePose(walkCycle(phase - 3), walkCycle(phase))
    }
  })

  it('is the same pose for the same phase', () => {
    expect(walkCycle(0.37)).toEqual(walkCycle(0.37))
  })

  it('moves its legs in opposition: each is where the other was half a cycle before', () => {
    for (const phase of PHASES) {
      const [now, later] = [walkCycle(phase), walkCycle(phase + 0.5)]

      expect(later.legs[RIGHT].swing).toBeCloseTo(now.legs[LEFT].swing, 6)
      expect(later.legs[RIGHT].bend).toBeCloseTo(now.legs[LEFT].bend, 6)
      expect(later.legs[LEFT].swing).toBeCloseTo(now.legs[RIGHT].swing, 6)
    }
  })

  it('has one foot as far forward as the other is back when both are down: half a stride apart', () => {
    const split = walkCycle(0.25)

    expect(foot(split.legs[LEFT]).ahead).toBeCloseTo(-STRIDE / 4)
    expect(foot(split.legs[RIGHT]).ahead).toBeCloseTo(STRIDE / 4)
    expect(offGround(split, LEFT)).toBeCloseTo(0)
    expect(offGround(split, RIGHT)).toBeCloseTo(0)
  })

  it('swings its arms against each other, each forward as the leg of its side is back', () => {
    for (const phase of PHASES) {
      const { arms, legs } = walkCycle(phase)
      expect(arms[RIGHT].swing).toBeCloseTo(-arms[LEFT].swing)

      for (const side of [LEFT, RIGHT]) {
        const ahead = foot(legs[side]).ahead
        if (Math.abs(ahead) > STRIDE / 20) expect(Math.sign(arms[side].swing)).toBe(-Math.sign(ahead))
      }
    }
    expect(Math.max(...PHASES.map((phase) => walkCycle(phase).arms[LEFT].swing))).toBeGreaterThan(0.3)
  })

  it('keeps the foot it stands on where it was put down, as the figurine goes forward', () => {
    // The left foot is down from a quarter of a cycle before it is under its hip to a quarter after.
    for (const phase of PHASES.filter((at) => at < 0.25 || at >= 0.75)) {
      const pose = walkCycle(phase)
      const gone = (phase < 0.5 ? phase : phase - 1) * STRIDE

      expect(gone + foot(pose.legs[LEFT]).ahead).toBeCloseTo(0, 6)
      expect(offGround(pose, LEFT)).toBeCloseTo(0, 6)
    }
  })

  it('lifts the foot it swings forward, and never sinks one into the ground', () => {
    for (const phase of PHASES) {
      const pose = walkCycle(phase)
      expect(offGround(pose, LEFT)).toBeGreaterThan(-1e-9)
      expect(offGround(pose, RIGHT)).toBeGreaterThan(-1e-9)
    }
    // The left foot passes the right one half a cycle after it stood under its hip.
    expect(offGround(walkCycle(0.5), LEFT)).toBeGreaterThan(0.02)
    expect(foot(walkCycle(0.5).legs[LEFT]).ahead).toBeCloseTo(0)
    expect(offGround(walkCycle(0), RIGHT)).toBeGreaterThan(0.02)
  })

  it('lets its hips ride over the leg it stands on: highest above its foot, lowest as both feet are down', () => {
    const drops = PHASES.map((phase) => walkCycle(phase).drop)

    expect(Math.min(...drops)).toBeCloseTo(walkCycle(0).drop)
    expect(Math.max(...drops)).toBeCloseTo(walkCycle(0.25).drop)
    expect(walkCycle(0).drop).toBeGreaterThan(0)
    expect(walkCycle(0.25).drop).toBeLessThan(0.07 * figureHeight())
  })

  it('folds its knees backward and its elbows forward, never the other way, and no leg locks straight', () => {
    for (const phase of PHASES) {
      const { legs, arms } = walkCycle(phase)
      for (const leg of legs) {
        expect(leg.bend).toBeGreaterThan(0.1)
        expect(leg.bend).toBeLessThan(Math.PI / 2)
      }
      for (const arm of arms) {
        expect(arm.bend).toBeGreaterThanOrEqual(REST_BEND)
        expect(arm.bend).toBeLessThan(Math.PI / 2)
      }
    }
  })

  it('has no jump in it: a hundredth of a cycle moves no joint by much', () => {
    const fine = Array.from({ length: 1000 }, (_, step) => step / 1000)
    for (const phase of fine) {
      const [now, next] = [angles(walkCycle(phase)), angles(walkCycle(phase + 0.001))]
      now.forEach((angle, index) => {
        expect(Math.abs((next[index] ?? Number.NaN) - angle)).toBeLessThan(0.03)
      })
    }
  })
})

describe('the pose of rest', () => {
  it('is what the figurine takes with no stride, whatever the phase: legs straight down, arms as they hang', () => {
    for (const phase of PHASES) {
      const { drop, legs, arms } = walkCycle(phase, 0)

      expect(drop).toBeCloseTo(0, 6)
      for (const leg of legs) {
        expect(leg.swing).toBeCloseTo(0, 6)
        expect(leg.bend).toBeCloseTo(0, 6)
      }
      for (const arm of arms) {
        expect(arm.swing).toBeCloseTo(0, 6)
        expect(arm.bend).toBeCloseTo(REST_BEND, 6)
      }
    }
  })

  it('is got into and out of without a jump: the stride grows with the share taken of it', () => {
    const spread = (share: number) => {
      const { legs } = walkCycle(0.25, share)
      return foot(legs[RIGHT]).ahead - foot(legs[LEFT]).ahead
    }

    expect(spread(0.001)).toBeCloseTo(0, 3)
    expect(spread(0.5)).toBeCloseTo(STRIDE / 4)
    expect(spread(1)).toBeCloseTo(STRIDE / 2)
    expect(walkCycle(0.5, 0.001).legs[LEFT].bend).toBeLessThan(0.05)
    expect(walkCycle(0.5, 0.5).arms[LEFT].swing).toBeCloseTo(walkCycle(0.5, 1).arms[LEFT].swing / 2)
  })

  it('takes a share between none and all of its stride', () => {
    expectSamePose(walkCycle(0.4, 2), walkCycle(0.4, 1))
    expectSamePose(walkCycle(0.4, -1), walkCycle(0.4, 0))
    expectSamePose(walkCycle(0.4), walkCycle(0.4, 1))
  })
})

describe('the phase of the walk', () => {
  it('goes by the ground covered: one cycle a stride, whatever the time taken', () => {
    expect(walkPhase(0)).toBe(0)
    expect(walkPhase(STRIDE)).toBeCloseTo(1)
    expect(walkPhase(2.5 * STRIDE)).toBeCloseTo(2.5)
  })

  it('does not go on without ground covered: a figurine that stands takes no step', () => {
    expect(walkPhase(0.8)).toBe(walkPhase(0.8))
    expectSamePose(walkCycle(walkPhase(0.8)), walkCycle(walkPhase(0.8)))
  })

  it("is a walker's stride: about four fifths of the figurine's height, within reach of its legs", () => {
    expect(STRIDE / figureHeight()).toBeGreaterThan(0.7)
    expect(STRIDE / figureHeight()).toBeLessThan(0.9)
    expect(STRIDE / 4).toBeLessThan(LEG / 2)
  })

  it('puts each foot down once per stride, and leaves it there, however unevenly the ground is covered', () => {
    // Where the foot it stands on is on the ground, along the way: the same until the other foot takes over.
    const places = new Set<number>()
    for (let walked = 0; walked < 2; walked += 0.007 + 0.005 * Math.sin(walked * 40)) {
      const pose = walkCycle(walkPhase(walked))
      const down = offGround(pose, LEFT) < offGround(pose, RIGHT) ? LEFT : RIGHT
      places.add(Math.round((walked + foot(pose.legs[down]).ahead) * 1e6) / 1e6)
    }
    const put = [...places].sort((a, b) => a - b)

    expect(put.length).toBe(Math.ceil((2 - STRIDE / 4) / (STRIDE / 2)) + 1)
    put.slice(1).forEach((place, index) => {
      expect(place - (put[index] ?? Number.NaN)).toBeCloseTo(STRIDE / 2, 5)
    })
  })
})

describe('the turn', () => {
  it('starts from one bearing and ends at the other', () => {
    expect(turnedTo(0.4, 1.9, 0)).toBeCloseTo(0.4)
    expect(turnedTo(0.4, 1.9, 1)).toBeCloseTo(1.9)
    expect(turnedTo(0.4, 1.9, 0.5)).toBeCloseTo(1.15)
  })

  it('goes the shortest way round, across the back as well', () => {
    const halfway = turnedTo(3, -3, 0.5)

    expect(Math.cos(halfway)).toBeCloseTo(-1)
    expect(Math.abs(halfway - 3)).toBeLessThan(0.2)
    expect(turnedTo(-3, 3, 0.5)).toBeLessThan(-3)
  })
})
