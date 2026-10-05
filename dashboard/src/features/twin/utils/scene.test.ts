import { describe, expect, it } from 'vitest'
import type { Alert, StatusLevel } from '@/shared/contract'
import { CALM_AIR, CRITICAL_AIR } from './gas-level'
import { CALM_COLOR, GAS_COLOR, mix, STATUS_GRADES, type TwinState, toScene } from './scene'

const ts = '2026-10-05T14:23:00.000Z'

function state(overrides: Partial<TwinState> = {}): TwinState {
  return { status: 'nominal', latestTelemetry: null, activeAlerts: [], ...overrides }
}

function withAir(air: number): TwinState {
  return state({
    latestTelemetry: { sentinel: 'sentinel-01', ts, readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 0.02 } },
  })
}

const base = { sentinel: 'sentinel-01', state: 'raised', ts } as const

function intrusion(alertId: string, x_norm: number): Alert {
  return {
    ...base,
    alert_id: alertId,
    source: 'vision',
    kind: 'intrusion',
    severity: 'critical',
    detail: { x_norm, confidence: 0.88, bbox: [0, 80, 60, 180] },
  }
}

function predictive(alertId: string, drivers: string[]): Alert {
  return {
    ...base,
    alert_id: alertId,
    source: 'predictive',
    kind: 'predictive',
    severity: 'warning',
    detail: { anomaly_score: 0.91, drivers },
  }
}

const gas: Alert = { ...base, alert_id: 'g1', source: 'esp32', kind: 'gas', severity: 'warning', detail: {} }

describe('mix', () => {
  it('goes from one color to the other', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ff8040', 0.5)).toBe('#804020')
  })
})

describe('toScene', () => {
  it('shows a calm, nominal Outpost before anything is received', () => {
    expect(toScene(state())).toEqual({
      enclosure: { color: CALM_COLOR, glow: 0 },
      status: STATUS_GRADES.nominal,
      pulses: [],
      intruder: null,
    })
  })

  it('turns the Enclosure red and makes it glow as gas rises', () => {
    expect(toScene(withAir(CALM_AIR)).enclosure).toEqual({ color: CALM_COLOR, glow: 0 })
    expect(toScene(withAir((CALM_AIR + CRITICAL_AIR) / 2)).enclosure).toEqual({
      color: mix(CALM_COLOR, GAS_COLOR, 0.5),
      glow: 0.5,
    })
    expect(toScene(withAir(CRITICAL_AIR)).enclosure).toEqual({ color: GAS_COLOR, glow: 1 })
  })

  it.each<StatusLevel>(['nominal', 'elevated', 'critical'])('grades the scene by the %s Status', (level) => {
    expect(toScene(state({ status: level })).status).toEqual({ ...STATUS_GRADES[level], level })
  })

  it('gives each Status its own colors', () => {
    const grades = Object.values(STATUS_GRADES)

    for (const key of ['background', 'light', 'perimeter'] as const) {
      expect(new Set(grades.map((grade) => grade[key])).size).toBe(grades.length)
    }
  })

  it('follows the Status, not the gas', () => {
    expect(toScene({ ...withAir(CRITICAL_AIR), status: 'nominal' }).status.level).toBe('nominal')
  })

  it('pulses the drivers of the active predictive Alerts, each once', () => {
    const scene = toScene(
      state({ activeAlerts: [predictive('p1', ['temp_slope', 'air_slope']), gas, predictive('p2', ['air_slope'])] }),
    )

    expect(scene.pulses).toEqual(['temp_slope', 'air_slope'])
  })

  it('places the intruder of the last raised intrusion Alert', () => {
    expect(toScene(state({ activeAlerts: [gas] })).intruder).toBeNull()
    expect(toScene(state({ activeAlerts: [intrusion('i1', 0.2), gas, intrusion('i2', 0.7)] })).intruder).toEqual({
      x_norm: 0.7,
    })
  })

  it('does not change the state it is given', () => {
    const given = state({ status: 'critical', activeAlerts: [intrusion('i1', 0.2)] })
    const copy = structuredClone(given)

    toScene(given)

    expect(given).toEqual(copy)
  })
})
