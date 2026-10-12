import { describe, expect, it } from 'vitest'
import type { Alert, CyberVector, Frame, Severity } from '@/shared/contract'
import { alertLog } from './alert-log'
import { byUrgency, describeAlert, KIND_LABEL, newlyRaised, SOURCE_LABEL } from './describe'

const at = (second: number) => new Date(Date.UTC(2026, 9, 5, 14, 0, second)).toISOString()

function gas(id: string, severity: Severity, state: 'raised' | 'cleared' = 'raised', second = 0): Alert {
  return { alert_id: id, sentinel: 'sentinel-01', source: 'esp32', kind: 'gas', severity, state, value: 420, detail: {}, ts: at(second) }
}

function intruder(x_norm: number, state: 'raised' | 'cleared' = 'raised', second = 0): Alert {
  return {
    alert_id: 'intruder',
    sentinel: 'sentinel-01',
    source: 'vision',
    kind: 'intrusion',
    severity: 'critical',
    state,
    detail: { x_norm, confidence: 0.88, bbox: [120, 80, 60, 180] },
    ts: at(second),
  }
}

// A brute force the API refuses, `attempts` refusals in.
function attack(attempts: number, vector: CyberVector = 'login', id = 'cyber-login-1', state: 'raised' | 'cleared' = 'raised'): Alert {
  return {
    alert_id: id,
    sentinel: 'command-post',
    source: 'api',
    kind: 'cyber',
    severity: 'warning',
    state,
    value: attempts,
    detail: { vector, attempts },
    ts: at(attempts),
  }
}

const frame = (alert: Alert): Frame => ({ type: 'alert', payload: alert })

describe('describeAlert', () => {
  it('says what the Alert is about from its kind', () => {
    expect(describeAlert(intruder(0.4))).toBe('Personne détectée, confiance 88 %')
    expect(describeAlert(gas('g', 'warning'))).toBe('Mesure de gaz à 420')
    expect(
      describeAlert({
        ...gas('p', 'warning'),
        source: 'predictive',
        kind: 'predictive',
        detail: { anomaly_score: 0.91, drivers: ['temp_slope', 'air_slope'] },
      }),
    ).toBe("Score d'anomalie 0,91 sur temp_slope, air_slope")
  })

  it('says which entry point an attack goes for, and how many attempts were refused', () => {
    expect(describeAlert(attack(14))).toBe('14 tentatives refusées sur le login')
    expect(describeAlert(attack(1))).toBe('1 tentative refusée sur le login')
    expect(describeAlert(attack(6, 'service-token'))).toBe("6 tentatives refusées sur l'entrée des Alerts")
    expect(describeAlert(attack(6, 'feed-origin'))).toBe('6 tentatives refusées sur le flux en direct')
  })

  it('says where the attempts come from when the Alert carries the address', () => {
    const from = (attempts: number): Alert => {
      const alert = attack(attempts)
      return alert.kind === 'cyber' ? { ...alert, detail: { ...alert.detail, address: '192.168.4.66' } } : alert
    }

    expect(describeAlert(from(14))).toBe('14 tentatives refusées sur le login, depuis 192.168.4.66')
    expect(describeAlert(from(1))).toBe('1 tentative refusée sur le login, depuis 192.168.4.66')
  })

  it('has a French label for the kind and the source of an attack', () => {
    expect(KIND_LABEL.cyber).toBe('Cyberattaque')
    expect(SOURCE_LABEL.api).toBe('Command Post')
  })
})

describe('byUrgency', () => {
  it('puts the most severe first, then the latest', () => {
    const older = gas('a', 'warning', 'raised', 1)
    const newer = gas('b', 'warning', 'raised', 5)
    const critical = gas('c', 'critical', 'raised', 0)

    expect(byUrgency([older, critical, newer]).map((alert) => alert.alert_id)).toEqual(['c', 'b', 'a'])
  })
})

describe('newlyRaised', () => {
  it('announces an Alert the first time it is raised', () => {
    expect(newlyRaised([], [gas('a', 'warning')])).toEqual([gas('a', 'warning')])
  })

  it('announces it again when it escalates, not when it holds or eases', () => {
    expect(newlyRaised([gas('a', 'warning')], [gas('a', 'critical')])).toHaveLength(1)
    expect(newlyRaised([gas('a', 'critical')], [gas('a', 'critical')])).toEqual([])
    expect(newlyRaised([gas('a', 'critical')], [gas('a', 'warning')])).toEqual([])
  })

  it('announces an attack once, however many attempts it goes on for', () => {
    expect(newlyRaised([], [attack(5)])).toHaveLength(1)
    expect(newlyRaised([attack(5)], [attack(6)])).toEqual([])
  })

  it('announces a moving intruder once', () => {
    expect(newlyRaised([intruder(0.15)], [intruder(0.35)])).toEqual([])
  })
})

describe('alertLog', () => {
  it('lists the transitions latest first, skipping everything but Alerts', () => {
    const status: Frame = { type: 'status', payload: { status: 'elevated', ts: at(0) } }
    const log = alertLog([frame(gas('a', 'warning', 'raised', 0)), status, frame(gas('a', 'warning', 'cleared', 3))])

    expect(log.map((alert) => alert.state)).toEqual(['cleared', 'raised'])
  })

  it('keeps one entry for an intruder crossing the field, and its clearing', () => {
    const log = alertLog([0.15, 0.35, 0.55].map((x, i) => frame(intruder(x, 'raised', i))).concat(frame(intruder(0.55, 'cleared', 4))))

    expect(log.map((alert) => alert.state)).toEqual(['cleared', 'raised'])
  })

  it('logs a new intrusion once the previous one cleared', () => {
    const log = alertLog([intruder(0.1), intruder(0.1, 'cleared', 1), intruder(0.9, 'raised', 2)].map(frame))

    expect(log).toHaveLength(3)
  })

  it('keeps one entry for an attack raised again at each attempt, and its clearing', () => {
    const attempts = Array.from({ length: 10 }, (_, i) => frame(attack(5 + i)))
    const log = alertLog([...attempts, frame(attack(14, 'login', 'cyber-login-1', 'cleared'))])

    expect(log.map((alert) => alert.state)).toEqual(['cleared', 'raised'])
    expect(log[1]).toEqual(attack(5))
  })

  it('gives each of two attacks in a row its entry', () => {
    const first = [attack(5), attack(6), attack(6, 'login', 'cyber-login-1', 'cleared')]
    const second = [attack(7, 'login', 'cyber-login-2'), attack(8, 'login', 'cyber-login-2')]
    const log = alertLog([...first, ...second].map(frame))

    expect(log.map((alert) => `${alert.alert_id} ${alert.state}`)).toEqual([
      'cyber-login-2 raised',
      'cyber-login-1 cleared',
      'cyber-login-1 raised',
    ])
  })

  it('keeps the attacks on two entry points apart', () => {
    const log = alertLog([attack(5), attack(5, 'feed-origin', 'cyber-feed-1'), attack(6), attack(6, 'feed-origin', 'cyber-feed-1')].map(frame))

    expect(log.map((alert) => alert.alert_id)).toEqual(['cyber-feed-1', 'cyber-login-1'])
  })

  it('keeps the latest entries only', () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(gas(`a${i}`, 'warning', 'raised', i)))

    expect(alertLog(frames, 3).map((alert) => alert.alert_id)).toEqual(['a9', 'a8', 'a7'])
  })
})
