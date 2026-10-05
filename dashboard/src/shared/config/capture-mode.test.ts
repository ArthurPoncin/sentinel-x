import { describe, expect, it } from 'vitest'
import { captureMode } from './capture-mode'

describe('captureMode', () => {
  it('is on when the address carries ?capture', () => {
    expect(captureMode({ search: '?capture' })).toBe(true)
  })

  it('is on whatever value the parameter is given', () => {
    expect(captureMode({ search: '?capture=' })).toBe(true)
    expect(captureMode({ search: '?capture=1' })).toBe(true)
  })

  it('is on among other parameters', () => {
    expect(captureMode({ search: '?scenario=gas&capture' })).toBe(true)
    expect(captureMode({ search: '?capture&scenario=gas' })).toBe(true)
  })

  it('is off without the parameter', () => {
    expect(captureMode({ search: '' })).toBe(false)
    expect(captureMode({ search: '?scenario=gas' })).toBe(false)
  })

  it('is off for a parameter that only looks like it', () => {
    expect(captureMode({ search: '?captured' })).toBe(false)
    expect(captureMode({ search: '?mode=capture' })).toBe(false)
  })
})
