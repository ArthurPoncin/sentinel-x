import type { Frame, Severity, StatusLevel } from './contract.js'
import { computeStatus } from './status.js'

type Ramp = readonly [from: number, to: number]

interface Phase {
  ticks: number
  // Readings move linearly across the phase.
  air: Ramp
  temp: Ramp
  // What the Sentinel would have raised by then.
  activeAlerts: { severity: Severity }[]
}

// A gas leak building up near the Sentinel, then clearing.
const SCENARIO: Phase[] = [
  { ticks: 6, air: [180, 190], temp: [31.0, 31.4], activeAlerts: [] },
  { ticks: 5, air: [320, 480], temp: [32.0, 34.5], activeAlerts: [{ severity: 'warning' }] },
  { ticks: 5, air: [620, 840], temp: [36.0, 41.0], activeAlerts: [{ severity: 'critical' }] },
  { ticks: 6, air: [260, 185], temp: [34.0, 31.2], activeAlerts: [] },
]

function along([from, to]: Ramp, progress: number): number {
  return from + (to - from) * progress
}

// Plays the scenario forever. Each tick is one telemetry snapshot, followed by a
// status frame when the Outpost Status changes on that tick.
export function* mockTicks(sentinel = 'sentinel-01'): Generator<Frame[], never> {
  let status: StatusLevel = 'nominal'
  while (true) {
    for (const phase of SCENARIO) {
      for (let tick = 0; tick < phase.ticks; tick++) {
        const progress = tick / (phase.ticks - 1)
        const ts = new Date().toISOString()
        const frames: Frame[] = [
          {
            type: 'telemetry',
            payload: {
              sentinel,
              ts,
              readings: {
                temp: Math.round(along(phase.temp, progress) * 10) / 10,
                humidity: 44,
                air: Math.round(along(phase.air, progress)),
                pir: false,
                accel: { x: 0.01, y: -0.02, z: 0.98 },
              },
            },
          },
        ]
        const next = computeStatus(phase.activeAlerts)
        if (next !== status) {
          status = next
          frames.push({ type: 'status', payload: { status, ts } })
        }
        yield frames
      }
    }
  }
}
