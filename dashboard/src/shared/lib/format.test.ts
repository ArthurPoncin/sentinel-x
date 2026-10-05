import { describe, expect, it } from 'vitest'
import { duration } from './format'

describe('duration', () => {
  it('reads seconds, minutes and hours at a glance', () => {
    expect(duration(42_000)).toBe('42 s')
    expect(duration(185_000)).toBe('3 min 05 s')
    expect(duration(4_320_000)).toBe('1 h 12 min')
  })

  it('never goes negative, even on skewed clocks', () => {
    expect(duration(-500)).toBe('0 s')
  })
})
