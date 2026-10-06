import { describe, expect, it } from 'vitest'
import { brackets, DETECTION, detectionFrame, detectionLabel } from './detection'
import { FIGURE, figureHeight } from './figure'

describe('the detection label', () => {
  it('reads what the model sees and how sure it is of it: « PERSONNE · 88 % »', () => {
    expect(detectionLabel(0.88)).toBe('PERSONNE · 88 %')
  })

  it('rounds the confidence to the percent', () => {
    expect(detectionLabel(0.876)).toBe('PERSONNE · 88 %')
    expect(detectionLabel(0.874)).toBe('PERSONNE · 87 %')
    expect(detectionLabel(0.5)).toBe('PERSONNE · 50 %')
    expect(detectionLabel(0.07)).toBe('PERSONNE · 7 %')
  })

  it('goes from 0 to 100 %, and no further whatever the Alert carries', () => {
    expect(detectionLabel(0)).toBe('PERSONNE · 0 %')
    expect(detectionLabel(1)).toBe('PERSONNE · 100 %')
    expect(detectionLabel(1.4)).toBe('PERSONNE · 100 %')
    expect(detectionLabel(-0.2)).toBe('PERSONNE · 0 %')
  })
})

describe('the detection frame', () => {
  // How far the figurine reaches from its axis: its arms, beside its torso.
  const reach = FIGURE.shoulder.x + FIGURE.upperArm.radius[0]

  it('holds the whole figurine, clear of it on every side', () => {
    const { width, height, middle } = detectionFrame()

    expect(width / 2).toBeGreaterThan(reach)
    expect(middle - height / 2).toBeLessThan(0)
    expect(middle + height / 2).toBeGreaterThan(figureHeight())
  })

  it('is centred on the figurine, halfway up it', () => {
    expect(detectionFrame().middle).toBeCloseTo(figureHeight() / 2)
  })

  it('stays a frame around the figurine, not around the site: under twice its size', () => {
    const { width, height } = detectionFrame()

    expect(width).toBeLessThan(2 * 2 * reach)
    expect(height).toBeLessThan(2 * figureHeight())
  })

  it('is drawn as four brackets, one at each of its corners', () => {
    const { width, height } = detectionFrame()
    const corners = brackets().map((outline) => {
      const across = outline.map(([x]) => x)
      const up = outline.map(([, y]) => y)
      // The point of the bracket that is farthest from the frame's middle: its corner.
      return [
        across.reduce((far, x) => (Math.abs(x) > Math.abs(far) ? x : far)),
        up.reduce((far, y) => (Math.abs(y) > Math.abs(far) ? y : far)),
      ]
    })

    expect(corners).toHaveLength(4)
    for (const [x, y] of [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [-width / 2, height / 2],
      [width / 2, height / 2],
    ]) {
      expect(corners).toContainEqual([x, y])
    }
  })

  it('keeps every bracket inside the frame', () => {
    const { width, height } = detectionFrame()

    for (const [x, y] of brackets().flat()) {
      expect(Math.abs(x)).toBeLessThanOrEqual(width / 2)
      expect(Math.abs(y)).toBeLessThanOrEqual(height / 2)
    }
  })

  it('gives each bracket two arms of the same length, along the two sides that meet at its corner', () => {
    for (const outline of brackets()) {
      const across = outline.map(([x]) => x)
      const up = outline.map(([, y]) => y)

      expect(Math.max(...across) - Math.min(...across)).toBeCloseTo(DETECTION.arm)
      expect(Math.max(...up) - Math.min(...up)).toBeCloseTo(DETECTION.arm)
    }
  })

  it('leaves its sides open between the brackets: corners, not a box', () => {
    const { width, height } = detectionFrame()

    expect(DETECTION.arm).toBeLessThan(width / 2)
    expect(DETECTION.arm).toBeLessThan(height / 2)
    expect(DETECTION.thickness).toBeLessThan(DETECTION.arm / 2)
  })

  it('draws its brackets off the figurine: thinner than the room the frame leaves around it', () => {
    const { width, height } = detectionFrame()

    expect(DETECTION.thickness).toBeLessThan(width / 2 - reach)
    expect(DETECTION.thickness).toBeLessThan((height - figureHeight()) / 2)
  })

  it('is the same on both sides of the figurine, and above as below its middle', () => {
    const points = brackets()
      .flat()
      .map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`)

    for (const [x, y] of brackets().flat()) {
      expect(points).toContain(`${(-x).toFixed(6)} ${y.toFixed(6)}`)
      expect(points).toContain(`${x.toFixed(6)} ${(-y).toFixed(6)}`)
    }
  })
})
