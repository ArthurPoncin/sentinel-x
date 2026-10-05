import { describe, expect, it } from 'vitest'
import type { Alert, Frame, Severity } from '@/shared/contract'
import { alertLog } from './alert-log'
import { byUrgency, describeAlert, newlyRaised } from './describe'

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

  it('keeps the latest entries only', () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(gas(`a${i}`, 'warning', 'raised', i)))

    expect(alertLog(frames, 3).map((alert) => alert.alert_id)).toEqual(['a9', 'a8', 'a7'])
  })
})
