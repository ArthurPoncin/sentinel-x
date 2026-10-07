import type { AlertPipeline } from './alerts.js'
import type { Alert, Telemetry } from './contract.js'
import type { TelemetryPipeline } from './telemetry.js'

type Ramp = readonly [from: number, to: number]

const SENTINEL = 'sentinel-01'

// An Alert as one of the producers would send it, before the tick stamps it.
type ScriptedAlert = Omit<Alert, 'alert_id' | 'sentinel' | 'ts'> & { id: string }

interface Segment {
  ticks: number
  // Readings move linearly across the segment.
  air: Ramp
  temp: Ramp
  sound: Ramp
  pir: boolean
  // What the producers send on a given tick of the segment.
  alerts?: Record<number, ScriptedAlert[]>
}

const gas = (severity: 'warning' | 'critical', state: 'raised' | 'cleared', value: number): ScriptedAlert => ({
  id: 'gas',
  source: 'esp32',
  kind: 'gas',
  severity,
  state,
  value,
  detail: {},
})

// Someone in the camera's image: where across it, and how tall in it.
type Seen = readonly [x_norm: number, h_norm: number]

// What the vision service sends as its camera, turned by `pan` degrees, follows someone, with someone else
// in its image or not. The box is that of a 640x480 frame.
const intruder = (state: 'raised' | 'cleared', [x_norm, h_norm]: Seen, pan: number, other?: Seen): ScriptedAlert => {
  const height = Math.round(h_norm * 480)
  const width = Math.round(height / 3)
  return {
    id: 'intruder',
    source: 'vision',
    kind: 'intrusion',
    severity: 'critical',
    state,
    detail: {
      x_norm,
      confidence: 0.88,
      bbox: [Math.round(x_norm * 640 - width / 2), Math.round((480 - height) / 2), width, height],
      id: 1,
      h_norm,
      pan,
      others: other ? [{ id: 2, x_norm: other[0], h_norm: other[1], confidence: 0.74 }] : [],
    },
  }
}

const drift = (state: 'raised' | 'cleared'): ScriptedAlert => ({
  id: 'drift',
  source: 'predictive',
  kind: 'predictive',
  severity: 'warning',
  state,
  detail: { anomaly_score: 0.91, drivers: ['temp_slope', 'air_slope'] },
})

const simple = (
  kind: 'thermal' | 'presence' | 'noise',
  severity: 'info' | 'warning',
  state: 'raised' | 'cleared',
  value?: number,
): ScriptedAlert => ({ id: kind, source: 'esp32', kind, severity, state, value, detail: {} })

const calm = { air: [180, 190], temp: [31.0, 31.2], sound: [0.02, 0.04], pir: false } as const

// One loop of the Outpost's life, every kind of Alert in it, each raised one cleared before the end:
// - a gas leak the predictive model flags first, the gas Alert going warning → critical → warning
//   → cleared, the heat with it, and someone walking past the PIR on the way;
// - a clap next to the sound sensor;
// - an intruder who comes in on the right of the camera's image, by the fence, and walks in toward the
//   plant: the camera turns to them, then follows them to its left as they come nearer, someone else behind
//   them for the last two sightings.
const SCENARIO: Segment[] = [
  { ticks: 6, ...calm },
  { ticks: 4, air: [200, 260], temp: [31.4, 32.4], sound: [0.03, 0.03], pir: false, alerts: { 0: [drift('raised')] } },
  {
    ticks: 5,
    air: [320, 480],
    temp: [32.8, 34.5],
    sound: [0.03, 0.05],
    pir: false,
    alerts: { 0: [gas('warning', 'raised', 320)], 3: [simple('presence', 'warning', 'raised')] },
  },
  {
    ticks: 5,
    air: [620, 840],
    temp: [36.0, 41.0],
    sound: [0.04, 0.04],
    pir: true,
    alerts: {
      0: [gas('critical', 'raised', 620), simple('presence', 'warning', 'cleared')],
      2: [simple('thermal', 'warning', 'raised', 38.5)],
    },
  },
  {
    ticks: 4,
    air: [420, 260],
    temp: [36.0, 33.0],
    sound: [0.03, 0.03],
    pir: false,
    alerts: { 0: [gas('warning', 'raised', 420), simple('thermal', 'warning', 'cleared', 36.0)] },
  },
  { ticks: 4, ...calm, alerts: { 0: [gas('warning', 'cleared', 190), drift('cleared')] } },
  {
    ticks: 2,
    ...calm,
    sound: [0.82, 0.06],
    alerts: { 0: [simple('noise', 'info', 'raised', 0.82)], 1: [simple('noise', 'info', 'cleared', 0.06)] },
  },
  { ticks: 2, ...calm },
  {
    ticks: 5,
    ...calm,
    alerts: {
      0: [intruder('raised', [0.886, 0.3], 0)],
      1: [intruder('raised', [0.439, 0.36], 14)],
      2: [intruder('raised', [0.439, 0.46], -2, [0.716, 0.31])],
      3: [intruder('raised', [0.439, 0.66], -20, [0.886, 0.33])],
      4: [intruder('cleared', [0.439, 0.66], -20, [0.886, 0.33])],
    },
  },
  { ticks: 3, ...calm },
]

export interface MockTick {
  telemetry: Telemetry
  alerts: Alert[]
}

function along([from, to]: Ramp, progress: number): number {
  return from + (to - from) * progress
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals

// Plays the scenario forever, one telemetry snapshot per tick plus the Alerts sent on it.
// Each loop has its own alert_ids, unique to this run: they pair a raised with its cleared.
export function* mockTicks(run = Date.now().toString(36)): Generator<MockTick, never> {
  for (let loop = 1; ; loop++) {
    for (const segment of SCENARIO) {
      for (let tick = 0; tick < segment.ticks; tick++) {
        const progress = segment.ticks > 1 ? tick / (segment.ticks - 1) : 0
        const ts = new Date().toISOString()
        yield {
          telemetry: {
            sentinel: SENTINEL,
            ts,
            readings: {
              temp: round(along(segment.temp, progress), 1),
              humidity: 44,
              air: Math.round(along(segment.air, progress)),
              pir: segment.pir,
              sound: round(along(segment.sound, progress), 2),
            },
          },
          alerts: (segment.alerts?.[tick] ?? []).map(({ id, ...alert }) => ({
            ...alert,
            alert_id: `mock-${run}-${loop}-${id}`,
            sentinel: SENTINEL,
            ts,
          })) as Alert[],
        }
      }
    }
  }
}

// Plays one tick of the scenario every `intervalMs` through the same pipelines as the real
// producers: recorded, broadcast, Status recomputed. Returns the function that stops it.
export function startMockFeed(
  pipelines: { telemetry: TelemetryPipeline; alerts: AlertPipeline },
  intervalMs: number,
): () => void {
  const ticks = mockTicks()
  const timer = setInterval(() => {
    const { telemetry, alerts } = ticks.next().value
    pipelines.telemetry.accept(telemetry)
    for (const alert of alerts) pipelines.alerts.accept(alert)
  }, intervalMs)
  return () => clearInterval(timer)
}
