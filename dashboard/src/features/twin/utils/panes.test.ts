import { describe, expect, it } from 'vitest'
import { inView, onScreen, paneSpot, type ViewFrame } from './panes'
import { BURST } from './shooting'

// The Twin's view beside a sidebar, under a top bar.
const frame: ViewFrame = { left: 240, top: 49, width: 1126, height: 719 }

describe('onScreen', () => {
  it('puts the middle of the view in the middle of its frame', () => {
    expect(onScreen(frame, 0, 0)).toEqual([240 + 563, 49 + 359.5])
  })

  it('puts the right of the view on its right edge and its top on its top edge: y goes up in the view, down on screen', () => {
    expect(onScreen(frame, 1, 1)).toEqual([240 + 1126, 49])
    expect(onScreen(frame, -1, -1)).toEqual([240, 49 + 719])
  })
})

describe('inView', () => {
  it('is the way back from the screen', () => {
    for (const [x, y] of [
      [0, 0],
      [0.92, -0.4],
      [-0.6, 0.75],
    ] as const) {
      const [backX, backY] = inView(frame, ...onScreen(frame, x, y))
      expect(backX).toBeCloseTo(x)
      expect(backY).toBeCloseTo(y)
    }
  })
})

describe('paneSpot', () => {
  const spots = Array.from({ length: BURST.motes }, (_, index) => paneSpot(index))

  it('keeps every mote on the pane', () => {
    for (const [across, up] of spots) {
      expect(Math.abs(across)).toBeLessThanOrEqual(1)
      expect(Math.abs(up)).toBeLessThanOrEqual(1)
    }
  })

  it('spreads them over all of it: each quarter has its share', () => {
    for (const [right, high] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const there = spots.filter(([across, up]) => across * right > 0 && up * high > 0).length
      expect(there).toBeGreaterThan(BURST.motes / 8)
    }
  })

  it('starts them at the same place at every shot', () => {
    expect(paneSpot(17)).toEqual(paneSpot(17))
  })
})
