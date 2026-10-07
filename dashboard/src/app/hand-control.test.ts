import { describe, expect, it } from 'vitest'
import { handLine } from '@/features/gestures/components/hand-hud'
import { HANDS_OFF } from '@/features/gestures/stores/hand-store'
import { pageAfter } from './hand-control'

describe('pageAfter', () => {
  it('goes to the other screen, whichever way the hand sweeps', () => {
    expect(pageAfter('/', 'page-left')).toBe('/twin')
    expect(pageAfter('/', 'page-right')).toBe('/twin')
    expect(pageAfter('/twin', 'page-left')).toBe('/')
    expect(pageAfter('/twin', 'page-right')).toBe('/')
  })

  it('starts from the first screen when the app is on none of them', () => {
    expect(pageAfter('/nowhere', 'page-left')).toBe('/twin')
  })
})

describe('handLine', () => {
  const open = { ...HANDS_OFF, bridge: 'open' as const }

  it('says the first thing that is missing, from the bridge to the hand', () => {
    expect(handLine({ ...HANDS_OFF, bridge: 'closed' })).toMatch(/Pont du capteur injoignable/)
    expect(handLine(open)).toMatch(/En attente du capteur/)
    expect(handLine({ ...open, tracking: true })).toMatch(/approchez la main/)
  })

  it('then says what the hand does', () => {
    const seen = { ...open, tracking: true, present: true }

    expect(handLine({ ...seen, pose: 'flat' })).toMatch(/pilote la caméra/)
    expect(handLine({ ...seen, pose: 'thumb-down' })).toMatch(/déclencher la sirène/)
    expect(handLine({ ...seen, pose: 'none' })).toBe('Main détectée')
  })
})
