import { describe, expect, it } from 'vitest'
import { handLine } from '@/features/gestures/components/hand-hud'
import { HANDS_OFF } from '@/features/gestures/stores/hand-store'
import { inTutorial, inVoiceTutorial, screens, TUTORIAL, VOICE_TUTORIAL } from './app-sidebar'
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
      expect(pageAfter(from, 'page-left')).not.toBe(VOICE_TUTORIAL)
      expect(pageAfter(from, 'page-right')).not.toBe(VOICE_TUTORIAL)
    }
  })
})

describe('inTutorial', () => {
  it('is the tutorial with a slash at its end too, and no other screen', () => {
    expect(inTutorial(TUTORIAL)).toBe(true)
    expect(inTutorial(`${TUTORIAL}/`)).toBe(true)
    expect(inTutorial('/')).toBe(false)
    expect(inTutorial('/twin')).toBe(false)
  })
})

describe('inVoiceTutorial', () => {
  it("is the voice's tutorial with a slash at its end too, and no other screen", () => {
    expect(inVoiceTutorial(VOICE_TUTORIAL)).toBe(true)
    expect(inVoiceTutorial(`${VOICE_TUTORIAL}/`)).toBe(true)
    expect(inVoiceTutorial('/')).toBe(false)
    expect(inVoiceTutorial(TUTORIAL)).toBe(false)
  })
})

describe('screens', () => {
  it('has the tutorial in the menu only while the hand control is on', () => {
    expect(screens(false).map(({ to }) => to)).toEqual(['/', '/twin'])
    expect(screens(true).map(({ to }) => to)).toEqual(['/', '/twin', TUTORIAL])
  })

  it("has the voice's tutorial only while the voice control is on, next to the gestures'", () => {
    expect(screens(false, true).map(({ to }) => to)).toEqual(['/', '/twin', VOICE_TUTORIAL])
    expect(screens(true, true).map(({ to }) => to)).toEqual(['/', '/twin', TUTORIAL, VOICE_TUTORIAL])
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
