import { describe, expect, it } from 'vitest'
import {
  FIGURE,
  figureHeight,
  headBase,
  headHeight,
  hipHeight,
  SWEEP_SECONDS,
  shoulderHeight,
  sweptTo,
  torsoSpan,
} from './figure'
import { FADE_SECONDS } from './fade'
import { SITE } from './site'

describe("the intruder's figurine", () => {
  it('measures about 0.45 unit, nearly twice the fence', () => {
    expect(figureHeight()).toBeCloseTo(0.45, 2)
    expect(figureHeight() / SITE.fence.height).toBeGreaterThan(1.6)
    expect(figureHeight() / SITE.fence.height).toBeLessThan(2)
  })

  it('stands on the ground: its legs, in two segments, reach it from the hips', () => {
    const { thigh, shin } = FIGURE
    expect(hipHeight() - thigh.length - shin.length - shin.radius[1]).toBeCloseTo(0)
  })

  it('is stacked like a body: legs, torso, head, with the legs coming out of the torso', () => {
    const { base, top } = torsoSpan()

    expect(base).toBeGreaterThan(0)
    expect(base).toBeLessThan(hipHeight())
    expect(top).toBeGreaterThan(hipHeight())
    expect(headBase()).toBeGreaterThan(top)
    expect(figureHeight()).toBeGreaterThan(headBase())
  })

  it('hangs its arms, in two segments, from the shoulders to above the knees, clear of the torso', () => {
    const { shoulder, torso, upperArm, forearm, thigh } = FIGURE
    const hand = shoulderHeight() - upperArm.length - forearm.length - forearm.radius[1]

    expect(shoulderHeight()).toBeLessThanOrEqual(torsoSpan().top)
    expect(hand).toBeGreaterThan(hipHeight() - thigh.length)
    expect(hand).toBeLessThan(hipHeight())
    expect(shoulder.x - upperArm.radius[0]).toBeGreaterThanOrEqual(torso.width / 2)
  })

  it('keeps its legs apart', () => {
    expect(FIGURE.hip.x).toBeGreaterThan(FIGURE.thigh.radius[0])
  })

  it('gives the middle of its head for the line from the lens to end at', () => {
    expect(headHeight()).toBeGreaterThan(headBase())
    expect(headHeight()).toBeLessThan(figureHeight())
    expect(headHeight()).toBeCloseTo((headBase() + figureHeight()) / 2)
  })
})

describe("the figurine's sweep", () => {
  it('shows nothing of it as its Alert is raised, all of it once the sweep is over', () => {
    expect(sweptTo(0)).toBe(0)
    expect(sweptTo(SWEEP_SECONDS)).toBe(1)
    expect(sweptTo(60)).toBe(1)
  })

  it('goes up from the feet to the head, at a steady pace', () => {
    const shares = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map(sweptTo)

    expect(shares).toEqual([...shares].sort((a, b) => a - b))
    expect(sweptTo(SWEEP_SECONDS / 4)).toBeCloseTo(0.25)
    expect(sweptTo(SWEEP_SECONDS / 2)).toBeCloseTo(0.5)
  })

  it('takes no longer than a fade: nothing in the Twin is slower to show', () => {
    expect(SWEEP_SECONDS).toBeGreaterThan(0)
    expect(SWEEP_SECONDS).toBeLessThanOrEqual(FADE_SECONDS)
  })

  it('has not started before its Alert is raised', () => {
    expect(sweptTo(-1)).toBe(0)
  })
})
