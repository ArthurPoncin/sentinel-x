import { describe, expect, it } from 'vitest'
import { MAX_PIXEL_RATIO, MAX_PIXELS, pixelRatio } from './pixel-ratio'

const drawn = (devicePixelRatio: number, width: number, height: number) =>
  width * height * pixelRatio(devicePixelRatio, width, height) ** 2

describe('pixelRatio', () => {
  it('is the density of the screen when the canvas fits the budget', () => {
    expect(pixelRatio(1, 1920, 1033)).toBe(1)
    expect(pixelRatio(1.5, 1280, 720)).toBe(1.5)
    expect(pixelRatio(2, 900, 600)).toBe(2)
  })

  it('never goes past the maximum, however dense the screen', () => {
    expect(pixelRatio(3, 400, 300)).toBe(MAX_PIXEL_RATIO)
    expect(pixelRatio(4, 400, 300)).toBe(MAX_PIXEL_RATIO)
  })

  it('goes down just enough to stay within the budget on a large or dense screen', () => {
    for (const [devicePixelRatio, width, height] of [
      [2, 1440, 853],
      [2, 1920, 1033],
      [1, 3840, 2113],
      [3, 1280, 673],
    ] as const) {
      expect(pixelRatio(devicePixelRatio, width, height)).toBeLessThan(Math.min(devicePixelRatio, MAX_PIXEL_RATIO))
      expect(drawn(devicePixelRatio, width, height)).toBeCloseTo(MAX_PIXELS, 0)
    }
  })

  it('keeps the density of the screen before the canvas has a size', () => {
    expect(pixelRatio(2, 0, 0)).toBe(2)
  })
})
