import type { Alert } from '../../src/contract.js'

type Common = Omit<Alert, 'kind' | 'detail'>

const common: Common = {
  alert_id: 'a1b2c3d4',
  sentinel: 'sentinel-01',
  source: 'esp32',
  severity: 'warning',
  state: 'raised',
  ts: '2026-10-05T14:23:05Z',
}

// A gas Alert, as the Sentinel raises it.
export function gasAlert(overrides: Partial<Common> = {}): Alert {
  return { ...common, kind: 'gas', detail: {}, ...overrides }
}

// Someone in front of the Sentinel's PIR.
export function presenceAlert(overrides: Partial<Common> = {}): Alert {
  return { ...common, alert_id: 'pir-1', kind: 'presence', detail: {}, ...overrides }
}

// An intruder seen by the vision service.
export function intrusionAlert(overrides: Partial<Common> = {}): Alert {
  return {
    ...common,
    alert_id: 'intruder-1',
    source: 'vision',
    severity: 'critical',
    kind: 'intrusion',
    detail: { x_norm: 0.42, confidence: 0.88, bbox: [120, 80, 60, 180] },
    ...overrides,
  }
}

// A drift flagged by the predictive service.
export function predictiveAlert(overrides: Partial<Common> = {}): Alert {
  return {
    ...common,
    alert_id: 'drift-1',
    source: 'predictive',
    kind: 'predictive',
    detail: { anomaly_score: 0.91, drivers: ['temp_slope', 'air_slope'] },
    ...overrides,
  }
}
