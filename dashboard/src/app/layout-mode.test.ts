import { describe, expect, it } from 'vitest'
import { layoutMode, sidebarOpenFrom } from './layout-mode'

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

describe('sidebarOpenFrom', () => {
  it('opens the sidebar when nothing was chosen yet', () => {
    expect(sidebarOpenFrom('')).toBe(true)
    expect(sidebarOpenFrom('theme=dark')).toBe(true)
  })

  it("keeps the Operator's last choice", () => {
    expect(sidebarOpenFrom('sidebar_state=false')).toBe(false)
    expect(sidebarOpenFrom('theme=dark; sidebar_state=true; lang=fr')).toBe(true)
  })

  it('reads no other cookie that ends the same way', () => {
    expect(sidebarOpenFrom('old_sidebar_state=false')).toBe(true)
  })
})
