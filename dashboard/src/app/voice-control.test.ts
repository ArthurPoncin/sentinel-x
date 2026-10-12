import { describe, expect, it } from 'vitest'
import { acknowledge, type Command } from '@/features/voice'
import type { Incident } from '@/shared/contract'
import { NAV, screens, TUTORIAL } from './app-sidebar'
import { pageAfter } from './hand-control'
import { askedReplay, replayAsked } from './replay-asked'
import { alarmSaid, pageOfVoice } from './voice-control'

const ALL: readonly Command[] = ['siren', 'siren-off', 'operator', 'twin', 'tutorial', 'replay-last', 'report', 'silence', 'speak']

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
