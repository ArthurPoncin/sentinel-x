import { describe, expect, it } from 'vitest'
import { handLine } from '@/features/gestures/components/hand-hud'
import { HANDS_OFF } from '@/features/gestures/stores/hand-store'
import { screens, TUTORIAL } from './app-sidebar'
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

  it('never leads to the tutorial', () => {
    for (const from of ['/', '/twin']) {
      expect(pageAfter(from, 'page-left')).not.toBe(TUTORIAL)
      expect(pageAfter(from, 'page-right')).not.toBe(TUTORIAL)
    }
  })
})

describe('screens', () => {
  it('has the tutorial in the menu only while the hand control is on', () => {
    expect(screens(false).map(({ to }) => to)).toEqual(['/', '/twin'])
    expect(screens(true).map(({ to }) => to)).toEqual(['/', '/twin', TUTORIAL])
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
