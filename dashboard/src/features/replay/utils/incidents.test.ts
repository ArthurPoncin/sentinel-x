import { describe, expect, it } from 'vitest'
import type { Alert, Frame, Incident } from '@/shared/contract'
import { incidents } from './incidents'

const at = (time: string) => `2026-10-05T${time}Z`

type Common = Omit<Alert, 'kind' | 'detail'>

const common: Common = {
  alert_id: 'gas-1',
  sentinel: 'sentinel-01',
  source: 'esp32',
  severity: 'warning',
  state: 'raised',
  ts: at('14:23:00'),
}

function telemetry(time: string, air = 180): Frame {
  return {
    type: 'telemetry',
    payload: { sentinel: 'sentinel-01', ts: at(time), readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 0.02 } },
  }
}

function gas(overrides: Partial<Common>): Frame {
  return { type: 'alert', payload: { ...common, kind: 'gas', detail: {}, ...overrides } }
}

function presence(overrides: Partial<Common>): Frame {
  return { type: 'alert', payload: { ...common, alert_id: 'pir-1', kind: 'presence', detail: {}, ...overrides } }
}

function intrusion(overrides: Partial<Common>): Frame {
  return {
    type: 'alert',
    payload: {
      ...common,
      alert_id: 'intruder-1',
      source: 'vision',
      severity: 'critical',
      kind: 'intrusion',
      detail: { x_norm: 0.42, confidence: 0.88, bbox: [120, 80, 60, 180] },
      ...overrides,
    },
  }
}

function status(time: string): Frame {
  return { type: 'status', payload: { status: 'elevated', ts: at(time) } }
}

// The reference scenario of the Command Post's own tests (backend/test/incidents.test.ts): the gas goes
// nominal → warning → critical → warning → nominal, and the PIR detects someone twice meanwhile.
const REFERENCE: Frame[] = [
  telemetry('14:22:50'),
  telemetry('14:22:55'),
  gas({ severity: 'warning', value: 420, ts: at('14:23:00') }),
  status('14:23:00'),
  telemetry('14:23:00', 420),
  presence({ alert_id: 'pir-1', ts: at('14:23:10') }),
  presence({ alert_id: 'pir-1', state: 'cleared', ts: at('14:23:12') }),
  gas({ severity: 'critical', value: 650, ts: at('14:23:20') }),
  telemetry('14:23:20', 650),
  presence({ alert_id: 'pir-2', ts: at('14:23:30') }),
  presence({ alert_id: 'pir-2', state: 'cleared', ts: at('14:23:33') }),
  gas({ severity: 'warning', value: 430, ts: at('14:23:40') }),
  telemetry('14:23:40', 430),
  gas({ state: 'cleared', ts: at('14:23:50') }),
  telemetry('14:23:50', 190),
  telemetry('14:24:00'),
]

describe('incidents', () => {
  it('makes one Incident of the reference scenario, with its 8 Alerts', () => {
    expect(incidents(REFERENCE)).toEqual<Incident[]>([
      {
        incident_id: 1,
        start: at('14:23:00'),
        end: at('14:23:50'),
        ongoing: false,
        alerts: 8,
        kinds: ['gas', 'presence'],
        peak: 'critical',
      },
    ])
  })

  it('finds none when nothing was ever raised', () => {
    expect(incidents([telemetry('14:23:00'), status('14:23:00')])).toEqual([])
  })

  it('opens a new Incident on the first raised after a return to nominal', () => {
    expect(
      incidents([
        gas({ ts: at('14:23:00') }),
        gas({ state: 'cleared', ts: at('14:24:00') }),
        intrusion({ ts: at('14:30:00') }),
        intrusion({ state: 'cleared', ts: at('14:31:00') }),
      ]),
    ).toMatchObject([
      { incident_id: 1, start: at('14:23:00'), end: at('14:24:00'), kinds: ['gas'], peak: 'warning' },
      { incident_id: 2, start: at('14:30:00'), end: at('14:31:00'), kinds: ['intrusion'], peak: 'critical' },
    ])
  })

  it('lasts until every Alert is cleared, whichever Alert opened it', () => {
    expect(
      incidents([
        gas({ ts: at('14:23:00') }),
        intrusion({ ts: at('14:23:10') }),
        gas({ state: 'cleared', ts: at('14:23:20') }),
        intrusion({ state: 'cleared', ts: at('14:23:30') }),
      ]),
    ).toMatchObject([{ start: at('14:23:00'), end: at('14:23:30'), alerts: 4 }])
  })

  it('needs one cleared for an Alert raised again on the same alert_id', () => {
    expect(
      incidents([
        gas({ severity: 'warning', ts: at('14:23:00') }),
        gas({ severity: 'critical', ts: at('14:23:10') }),
        gas({ state: 'cleared', ts: at('14:23:20') }),
      ]),
    ).toMatchObject([{ end: at('14:23:20'), ongoing: false, alerts: 3, peak: 'critical' }])
  })

  it('says an Incident is going on until every Alert is cleared', () => {
    expect(
      incidents([
        gas({ ts: at('14:23:00') }),
        presence({ ts: at('14:23:10') }),
        presence({ state: 'cleared', ts: at('14:23:12') }),
      ]),
    ).toEqual([
      {
        incident_id: 1,
        start: at('14:23:00'),
        end: null,
        ongoing: true,
        alerts: 3,
        kinds: ['gas', 'presence'],
        peak: 'warning',
      },
    ])
  })

  it('opens nothing on a cleared with no Incident going on: the history may start after its raised', () => {
    expect(
      incidents([
        gas({ state: 'cleared', ts: at('14:22:00') }),
        gas({ ts: at('14:23:00') }),
        gas({ state: 'cleared', ts: at('14:24:00') }),
        gas({ state: 'cleared', ts: at('14:25:00') }),
      ]),
    ).toMatchObject([{ start: at('14:23:00'), end: at('14:24:00'), alerts: 2 }])
  })

  it('groups the Alerts by date, whatever order they came in, like the Command Post', () => {
    expect(incidents([gas({ state: 'cleared', ts: at('14:24:00') }), gas({ ts: at('14:23:00') })])).toMatchObject([
      { start: at('14:23:00'), end: at('14:24:00'), ongoing: false },
    ])
  })
})
