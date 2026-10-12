import { describe, expect, it } from 'vitest'
import { type WindowRect, windowAt } from './aimed'

const camera: WindowRect = { id: 'camera', left: 20, top: 90, right: 300, bottom: 320 }
const gas: WindowRect = { id: 'gas', left: 20, top: 332, right: 300, bottom: 560 }

describe('windowAt', () => {
  it('designates the window whose rectangle holds the sight', () => {
    expect(windowAt([camera, gas], 150, 200)).toBe(camera)
    expect(windowAt([camera, gas], 150, 400)).toBe(gas)
  })

  it('designates one on its very edge', () => {
    expect(windowAt([camera], 20, 90)).toBe(camera)
    expect(windowAt([camera], 300, 320)).toBe(camera)
  })

  it('designates none with the sight outside every rectangle', () => {
    expect(windowAt([camera, gas], 640, 200)).toBeNull()
    expect(windowAt([camera, gas], 150, 326)).toBeNull()
    expect(windowAt([], 150, 200)).toBeNull()
  })

  it('designates one alone of two neighbours whose rectangles meet: the one whose middle is nearest', () => {
    // Tilted, the rectangles two windows take of the screen may run into each other.
    // Middles at 215 and 446 down the screen: at 336, the lower one is 110 away and the upper one 121.
    const upper: WindowRect = { ...camera, bottom: 340 }
    expect(windowAt([upper, gas], 150, 336)).toBe(gas)
    expect(windowAt([gas, upper], 150, 336)).toBe(gas)
    // Middles at 205 and 430: at 305, the upper one is 100 away and the lower one 125.
    const lower: WindowRect = { ...gas, top: 300 }
    expect(windowAt([camera, lower], 150, 305)).toBe(camera)
    expect(windowAt([lower, camera], 150, 305)).toBe(camera)
  })
})
