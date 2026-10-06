import { describe, expect, it } from 'vitest'
import type { Frame } from '@/shared/contract'
import { incidents } from './incidents'
import { framesAt } from './replay'
import { SCENARIO_SECONDS, scenario, scenarioFrames } from './scenario'

const START = Date.parse('2026-10-06T09:00:00Z')
const at = (second: number) => new Date(START + second * 1000).toISOString()

const telemetries = (frames: readonly Frame[]) =>
  frames.flatMap((frame) => (frame.type === 'telemetry' ? [frame.payload] : []))

describe('the scenario', () => {
  it('is the reference scenario: 8 Alerts, 1 Incident, with calm before and after it', () => {
    expect(incidents(scenarioFrames(START))).toEqual([
      {
        incident_id: 1,
        start: at(5),
        end: at(55),
        ongoing: false,
        alerts: 8,
        kinds: ['gas', 'presence'],
        peak: 'critical',
      },
    ])
  })

  it('takes the gas nominal → warning → critical → warning → nominal', () => {
    const gas = scenarioFrames(START).flatMap((frame) =>
      frame.type === 'alert' && frame.payload.kind === 'gas' ? [`${frame.payload.severity} ${frame.payload.state}`] : [],
    )
    expect(gas).toEqual(['warning raised', 'critical raised', 'warning raised', 'warning cleared'])
  })

  it('gives the Status of the Command Post along it', () => {
    const statuses = scenarioFrames(START).flatMap((frame) => (frame.type === 'status' ? [frame.payload.status] : []))
    expect(statuses).toEqual([
      'elevated',
      'elevated',
      'elevated',
      'critical',
      'critical',
      'critical',
      'elevated',
      'nominal',
    ])
  })

  it('sends one telemetry snapshot a second, the gas rising to its peak and back to calm', () => {
    const snapshots = telemetries(scenarioFrames(START))
    const air = snapshots.map((snapshot) => snapshot.readings.air)

    expect(snapshots).toHaveLength(SCENARIO_SECONDS + 1)
    expect(snapshots.map((snapshot) => snapshot.ts)).toEqual(snapshots.map((_, second) => at(second)))
    expect(air[0]).toBe(185)
    expect(Math.max(...air)).toBe(680)
    expect(air.at(-1)).toBe(185)
  })

  it('shows the PIR on while someone is in front of it, and only then', () => {
    const pir = telemetries(scenarioFrames(START)).flatMap((snapshot, second) => (snapshot.readings.pir ? [second] : []))
    expect(pir).toEqual([15, 16, 35, 36, 37])
  })

  it('plays the same every time, from whenever it is started', () => {
    const later = START + 3_600_000
    expect(scenarioFrames(later).map((frame) => Date.parse(frame.payload.ts) - later)).toEqual(
      scenarioFrames(START).map((frame) => Date.parse(frame.payload.ts) - START),
    )
  })

  it('runs over its whole length, labelled as the scenario', () => {
    const replay = scenario(START)

    expect(replay).toMatchObject({ title: 'Scenario', from: START, to: START + SCENARIO_SECONDS * 1000 })
    expect(framesAt(replay, replay.to)).toEqual(replay.frames)
  })
})
