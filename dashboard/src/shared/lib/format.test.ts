import { describe, expect, it } from 'vitest'
import { decimal, duration } from './format'
import { plural } from './labels'

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

describe('decimal', () => {
  it('writes the decimal comma', () => {
    expect(decimal(33.46, 1)).toBe('33,5')
  })
})

describe('plural', () => {
  it('adds the s from two on', () => {
    expect(plural(0, 'alerte')).toBe('0 alerte')
    expect(plural(1, 'alerte')).toBe('1 alerte')
    expect(plural(3, 'alerte')).toBe('3 alertes')
  })
})
