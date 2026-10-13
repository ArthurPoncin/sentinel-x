import { describe, expect, it } from 'vitest'
import { levelOf } from './level'

describe('the level of the microphone', () => {
  it('is nothing over a silence, and over no sample at all', () => {
    expect(levelOf(new Float32Array(4096))).toBe(0)
    expect(levelOf(new Float32Array(0))).toBe(0)
  })

  it('grows with the voice, and stops at 1', () => {
    const quiet = levelOf(new Float32Array(4096).fill(0.002))
    const voice = levelOf(new Float32Array(4096).fill(0.05))
    expect(quiet).toBeLessThan(0.1)
    expect(voice).toBeGreaterThan(quiet)
    expect(voice).toBeLessThan(1)
    expect(levelOf(new Float32Array(4096).fill(-0.9))).toBe(1)
  })
})
