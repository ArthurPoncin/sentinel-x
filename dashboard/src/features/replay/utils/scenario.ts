import type { Alert, Frame, Severity } from '@/shared/contract'
import { type Replay, withStatus } from './replay'

const SENTINEL = 'sentinel-01'

// The scripted sequence, in seconds from its start: the reference scenario of the Incidents (#7). The gas goes
// nominal → warning → critical → warning → nominal while the PIR detects someone twice: 8 Alerts, 1 Incident,
// with calm before and after it.
export const SCENARIO_SECONDS = 60
const OPENS = 5

type Scripted = Pick<Alert, 'alert_id' | 'severity' | 'state' | 'value'> & { kind: 'gas' | 'presence' }

const gas = (severity: Severity, state: Alert['state'], value: number): Scripted => ({
  alert_id: 'scenario-gas',
  kind: 'gas',
  severity,
  state,
  value,
})
const presence = (n: number, state: Alert['state']): Scripted => ({
  alert_id: `scenario-pir-${n}`,
  kind: 'presence',
  severity: 'warning',
  state,
})

// The two times the PIR sees someone: from its raised to its cleared.
const PRESENCES: ReadonlyArray<readonly [from: number, to: number]> = [
  [OPENS + 10, OPENS + 12],
  [OPENS + 30, OPENS + 33],
]

type Scripting = readonly [second: number, alert: Scripted]

// What the Sentinel raises, and on which second.
const SCRIPT: readonly Scripting[] = [
  [OPENS, gas('warning', 'raised', 420)],
  [OPENS + 20, gas('critical', 'raised', 650)],
  [OPENS + 40, gas('warning', 'raised', 430)],
  [OPENS + 50, gas('warning', 'cleared', 190)],
  ...PRESENCES.flatMap(([from, to], index): Scripting[] => [
    [from, presence(index + 1, 'raised')],
    [to, presence(index + 1, 'cleared')],
  ]),
]
const ALERTS = SCRIPT.toSorted(([a], [b]) => a - b)

// The Readings the MQ-2 and the DHT22 give on given seconds; in between they move linearly.
const AIR: ReadonlyArray<readonly [second: number, air: number]> = [
  [0, 185],
  [OPENS - 2, 230],
  [OPENS, 420],
  [OPENS + 18, 600],
  [OPENS + 22, 680],
  [OPENS + 38, 450],
  [OPENS + 42, 420],
  [OPENS + 50, 190],
  [SCENARIO_SECONDS, 185],
]
const TEMP: ReadonlyArray<readonly [second: number, temp: number]> = [
  [0, 31.2],
  [OPENS, 31.8],
  [OPENS + 22, 34.5],
  [OPENS + 50, 31.6],
  [SCENARIO_SECONDS, 31.2],
]

// The value of a piecewise linear curve at `second`, held flat past its ends.
function along(curve: ReadonlyArray<readonly [number, number]>, second: number): number {
  const next = curve.findIndex(([at]) => at >= second)
  const after = curve[next === -1 ? curve.length - 1 : next] as readonly [number, number]
  const before = curve[next - 1]
  if (next <= 0 || !before) return after[1]
  const [x0, y0] = before
  const [x1, y1] = after
  return y0 + ((y1 - y0) * (second - x0)) / (x1 - x0)
}

const round = (value: number, digits: number) => Number(value.toFixed(digits))

// The scripted sequence as frames, started at `start` (ms since the epoch): one telemetry snapshot a second, the
// Alerts of each second just before it, and the Status they lead to. Scripted, not recorded: it plays the same
// every time, network or not, and is labelled as a replay like any other.
export function scenarioFrames(start: number): Frame[] {
  const frames: Frame[] = []
  for (let second = 0; second <= SCENARIO_SECONDS; second++) {
    const ts = new Date(start + second * 1000).toISOString()
    for (const [at, alert] of ALERTS) {
      if (at !== second) continue
      frames.push({
        type: 'alert',
        payload: { ...alert, sentinel: SENTINEL, source: 'esp32', detail: {}, ts },
      })
    }
    const pir = PRESENCES.some(([from, to]) => from <= second && second < to)
    frames.push({
      type: 'telemetry',
      payload: {
        sentinel: SENTINEL,
        ts,
        readings: { temp: round(along(TEMP, second), 1), humidity: 44, air: Math.round(along(AIR, second)), pir, sound: 0.03 },
      },
    })
  }
  return withStatus(frames)
}

// Scenario mode: the scripted sequence, played from now.
export function scenario(start: number): Replay {
  return { title: 'Scenario', from: start, to: start + SCENARIO_SECONDS * 1000, frames: scenarioFrames(start) }
}
