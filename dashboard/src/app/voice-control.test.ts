import { describe, expect, it } from 'vitest'
import { acknowledge, type Command } from '@/features/voice'
import { NO_WINDOWS_STATE, WINDOW_IDS, windowsAfter } from '@/features/windows'
import type { Incident } from '@/shared/contract'
import { NAV, screens, TUTORIAL } from './app-sidebar'
import { pageAfter } from './hand-control'
import { askedReplay, replayAsked } from './replay-asked'
import { alarmSaid, pageOfVoice } from './voice-control'
import { askedWindows, windowsAsked, windowsOfVoice } from './windows-asked'

const ALL: readonly Command[] = [
  'siren',
  'siren-off',
  'operator',
  'twin',
  'tutorial',
  'replay-last',
  'report',
  'silence',
  'speak',
  ...WINDOW_IDS.flatMap((id): Command[] => [`show-${id}`, `close-${id}`]),
  'close-all',
]

describe('pageOfVoice', () => {
  it('leads to the screen that is named', () => {
    expect(pageOfVoice('operator', '/twin')).toBe('/')
    expect(pageOfVoice('twin', '/')).toBe('/twin')
    expect(pageOfVoice('tutorial', '/')).toBe(TUTORIAL)
  })

  it('has a name for each screen of the menu', () => {
    for (const { to } of NAV) {
      const from = to === '/' ? '/twin' : '/'
      expect(ALL.map((command) => pageOfVoice(command, from))).toContain(to)
    }
  })

  it('leads nowhere from the screen that is named: there already', () => {
    expect(pageOfVoice('operator', '/')).toBeNull()
    expect(pageOfVoice('twin', '/twin')).toBeNull()
    expect(pageOfVoice('twin', '/twin/')).toBeNull()
    expect(pageOfVoice('tutorial', `${TUTORIAL}/`)).toBeNull()
  })

  it('leads out of the tutorial too: a name is not a gesture that is tried there', () => {
    expect(pageOfVoice('twin', TUTORIAL)).toBe('/twin')
    expect(pageOfVoice('operator', TUTORIAL)).toBe('/')
  })

  it('leads nowhere for a command that names no screen', () => {
    expect(pageOfVoice('siren', '/')).toBeNull()
    expect(pageOfVoice('siren-off', '/')).toBeNull()
    expect(pageOfVoice('replay-last', '/')).toBeNull()
    expect(pageOfVoice('report', '/')).toBeNull()
    expect(pageOfVoice('silence', '/')).toBeNull()
    expect(pageOfVoice('speak', '/')).toBeNull()
    expect(pageOfVoice('show-camera', '/')).toBeNull()
    expect(pageOfVoice('close-all', '/')).toBeNull()
  })

  it('reaches every screen a swipe of the hand reaches', () => {
    for (const { to: from } of screens(false)) {
      for (const swipe of ['page-left', 'page-right'] as const) {
        expect(ALL.map((command) => pageOfVoice(command, from))).toContain(pageAfter(from, swipe))
      }
    }
  })
})

describe('what answers a command for the Alarm', () => {
  const first = () => 0

  it('says it is done once the Command Post relayed it', () => {
    const relayed = { success: true, title: 'Sirène', description: 'Commande vocale · commande transmise à sentinel-01' }

    expect(alarmSaid('siren', relayed, first)).toEqual([acknowledge('siren', first)])
    expect(alarmSaid('siren-off', relayed, first)).toEqual([acknowledge('siren-off', first)])
  })

  it('says what happened when the relay failed, never that the siren sounds', () => {
    const failed = { success: false, title: 'Commande non transmise', description: 'Le poste de commande est injoignable.' }

    expect(alarmSaid('siren', failed, first)).toEqual([
      acknowledge('alarm-failed', first),
      'Commande non transmise. Le poste de commande est injoignable.',
    ])
    for (let draw = 0; draw < 1; draw += 0.1) {
      expect(alarmSaid('siren', failed, () => draw)).not.toContain(acknowledge('siren', () => draw))
    }
  })
})

describe('a replay asked for from another screen', () => {
  const INCIDENT: Incident = {
    incident_id: 3,
    start: '2026-10-12T09:00:00Z',
    end: '2026-10-12T09:01:10Z',
    ongoing: false,
    alerts: 4,
    kinds: ['gas', 'presence'],
    peak: 'critical',
  }

  it('comes to the Twin with the way to it', () => {
    expect(askedReplay(replayAsked(INCIDENT))).toEqual(INCIDENT)
  })

  it('is none on a way that carries nothing, or something else', () => {
    expect(askedReplay(null)).toBeNull()
    expect(askedReplay(undefined)).toBeNull()
    expect(askedReplay({ from: '/' })).toBeNull()
    expect(askedReplay({ replay: { incident_id: 'three' } })).toBeNull()
  })
})

describe('windowsOfVoice', () => {
  it('opens each window of the catalogue by its name, on the Twin and from another screen', () => {
    for (const id of WINDOW_IDS) {
      expect(windowsOfVoice(`show-${id}`, '/twin')).toEqual({ type: 'open', id })
      expect(windowsOfVoice(`show-${id}`, '/')).toEqual({ type: 'open', id })
    }
  })

  it('closes each window by its name, and all of them at once, on the Twin', () => {
    for (const id of WINDOW_IDS) expect(windowsOfVoice(`close-${id}`, '/twin')).toEqual({ type: 'close', id })
    expect(windowsOfVoice('close-all', '/twin/')).toEqual({ type: 'close-all' })
  })

  it('closes nothing from another screen: no window is open there', () => {
    expect(windowsOfVoice('close-camera', '/')).toBeNull()
    expect(windowsOfVoice('close-all', '/')).toBeNull()
  })

  it('does nothing in the tutorial: a command is tried there, not meant', () => {
    for (const command of ALL) expect(windowsOfVoice(command, TUTORIAL)).toBeNull()
    expect(windowsOfVoice('show-camera', `${TUTORIAL}/`)).toBeNull()
  })

  it('asks nothing for a command that is about something else', () => {
    for (const command of ['siren', 'siren-off', 'operator', 'twin', 'tutorial', 'replay-last'] as const) {
      expect(windowsOfVoice(command, '/twin')).toBeNull()
    }
  })
})

describe('what the voice asks of the windows', () => {
  it('comes to the Twin with the way to it', () => {
    expect(askedWindows(windowsAsked({ type: 'open', id: 'camera' }))).toEqual({ type: 'open', id: 'camera' })
    expect(askedWindows(windowsAsked({ type: 'close', id: 'gas' }))).toEqual({ type: 'close', id: 'gas' })
    expect(askedWindows(windowsAsked({ type: 'close-all' }))).toEqual({ type: 'close-all' })
  })

  it('is nothing on a way that carries nothing, or something else', () => {
    expect(askedWindows(null)).toBeNull()
    expect(askedWindows({ replay: {} })).toBeNull()
    expect(askedWindows({ windows: { type: 'open', id: 'weather' } })).toBeNull()
    expect(askedWindows({ windows: { type: 'open' } })).toBeNull()
  })

  it('opens a window that is the Operator\'s: it does not close by itself', () => {
    const ask = askedWindows(windowsAsked({ type: 'open', id: 'gas' }))
    if (ask?.type !== 'open') throw new Error('an open was asked')
    // Raised, opened by its Alert, then asked for by the voice; the Alert clears, and a long time passes.
    const state = [
      { type: 'alerts', kinds: ['gas'], at: 1000 } as const,
      { ...ask, by: 'operator', at: 2000 } as const,
      { type: 'alerts', kinds: [], at: 3000 } as const,
      { type: 'alerts', kinds: [], at: 3_600_000 } as const,
    ].reduce(windowsAfter, NO_WINDOWS_STATE)

    expect(state.open.map(({ id, by }) => [id, by])).toEqual([['gas', 'operator']])
  })
})
