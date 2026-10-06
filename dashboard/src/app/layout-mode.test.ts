import { describe, expect, it } from 'vitest'
import { layoutMode } from './layout-mode'

const operator = [{ handle: undefined }, { handle: undefined }]
const twin = [{ handle: undefined }, { handle: { stage: true } }]

describe('layoutMode', () => {
  it('keeps the padded page on a route that is not a stage', () => {
    expect(layoutMode(operator, { search: '' })).toBe('page')
  })

  it('ignores ?capture outside a stage', () => {
    expect(layoutMode(operator, { search: '?capture' })).toBe('page')
  })

  it('gives a stage route the whole space under the header', () => {
    expect(layoutMode(twin, { search: '' })).toBe('stage')
  })

  it('leaves a stage alone on the window with ?capture, whatever its value', () => {
    expect(layoutMode(twin, { search: '?capture' })).toBe('capture')
    expect(layoutMode(twin, { search: '?capture=0' })).toBe('capture')
  })
})
