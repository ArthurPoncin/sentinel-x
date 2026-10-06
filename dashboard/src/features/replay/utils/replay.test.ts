import { describe, expect, it } from 'vitest'
import type { Frame, Incident, Severity } from '@/shared/contract'
import { framesAt, instantAt, LEAD_MS, lengthOf, type Replay, replayOf, timeOf, withStatus } from './replay'

const at = (time: string) => `2026-10-05T${time}Z`
const ms = (time: string) => Date.parse(at(time))

function telemetry(time: string, air = 180): Frame {
  return {
    type: 'telemetry',
    payload: { sentinel: 'sentinel-01', ts: at(time), readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 0.02 } },
  }
}

function gas(time: string, severity: Severity, state: 'raised' | 'cleared', alert_id = 'gas-1'): Frame {
  return {
    type: 'alert',
    payload: { alert_id, sentinel: 'sentinel-01', source: 'esp32', kind: 'gas', severity, state, detail: {}, ts: at(time) },
  }
}

const statuses = (frames: readonly Frame[]) =>
  frames.flatMap((frame) => (frame.type === 'status' ? [frame.payload.status] : []))

describe('withStatus', () => {
  it('follows each Alert with the Status it leads to: the highest severity among the active ones', () => {
    const frames = withStatus([
      gas('14:23:00', 'warning', 'raised'),
      gas('14:23:05', 'critical', 'raised', 'gas-2'),
      gas('14:23:10', 'critical', 'cleared', 'gas-2'),
      gas('14:23:20', 'warning', 'cleared'),
    ])

    expect(statuses(frames)).toEqual(['elevated', 'critical', 'elevated', 'nominal'])
    expect(frames[1]).toEqual({ type: 'status', payload: { status: 'elevated', ts: at('14:23:00') } })
  })

  it('takes an `info` Alert for nominal, as the Command Post does', () => {
    expect(statuses(withStatus([gas('14:23:00', 'info', 'raised')]))).toEqual(['nominal'])
  })

  it('drops the Status frames already there: one rule only', () => {
    const recorded: Frame = { type: 'status', payload: { status: 'critical', ts: at('14:23:00') } }
    expect(withStatus([recorded, telemetry('14:23:00')])).toEqual([telemetry('14:23:00')])
  })

  it('copies the frames instead of handing over the ones it was given', () => {
    const live = [telemetry('14:23:00'), gas('14:23:01', 'warning', 'raised')]
    const replayed = withStatus(live)

    expect(replayed[0]).toEqual(live[0])
    expect(replayed[0]).not.toBe(live[0])
    expect(replayed[1]).not.toBe(live[1])
  })
})

const INCIDENT: Incident = {
  incident_id: 2,
  start: at('14:23:00'),
  end: at('14:23:20'),
  ongoing: false,
  alerts: 2,
  kinds: ['gas'],
  peak: 'warning',
}

const HISTORY: Frame[] = [
  telemetry('14:22:00', 170),
  telemetry('14:22:56', 185),
  telemetry('14:22:58', 200),
  gas('14:23:00', 'warning', 'raised'),
  telemetry('14:23:00', 420),
  telemetry('14:23:10', 450),
  gas('14:23:20', 'warning', 'cleared'),
  telemetry('14:23:20', 190),
  telemetry('14:23:23', 185),
  telemetry('14:23:30', 180),
]

describe('replayOf', () => {
  it('spans the Incident with LEAD_MS of calm on each side', () => {
    const replay = replayOf(HISTORY, INCIDENT)

    expect(replay.title).toBe('Incident #2')
    expect(replay.from).toBe(ms('14:23:00') - LEAD_MS)
    expect(replay.to).toBe(ms('14:23:20') + LEAD_MS)
  })

  it('holds the frames of its span, the last telemetry before it, and the Status after each Alert', () => {
    const replay = replayOf(HISTORY, INCIDENT)

    expect(replay.frames.map((frame) => frame.payload.ts)).toEqual([
      at('14:22:56'),
      at('14:22:58'),
      at('14:23:00'),
      at('14:23:00'),
      at('14:23:00'),
      at('14:23:10'),
      at('14:23:20'),
      at('14:23:20'),
      at('14:23:20'),
      at('14:23:23'),
    ])
    expect(statuses(replay.frames)).toEqual(['elevated', 'nominal'])
  })

  it('runs up to the last frame of the history while the Incident is going on', () => {
    const replay = replayOf(HISTORY.slice(0, 6), { ...INCIDENT, end: null, ongoing: true })
    expect(replay.to).toBe(ms('14:23:10'))
  })

  it('replays what the Command Post sends for an Incident: its own records, nothing before', () => {
    const records = HISTORY.slice(3, 8)
    const replay = replayOf(records, INCIDENT)

    expect(replay.frames.filter((frame) => frame.type !== 'status')).toEqual(records)
  })
})

describe('the scrubber over a replay', () => {
  const replay: Replay = replayOf(HISTORY, INCIDENT)

  it('runs second by second, its last second on `to`', () => {
    expect(lengthOf(replay)).toBe(26)
    expect(instantAt(replay, 0)).toBe(replay.from)
    expect(instantAt(replay, 3)).toBe(ms('14:23:00'))
    expect(instantAt(replay, 26)).toBe(replay.to)
    expect(instantAt(replay, 99)).toBe(replay.to)
  })

  it('rounds a span that is not a whole number of seconds up', () => {
    expect(lengthOf({ ...replay, to: replay.from + 2_500 })).toBe(3)
  })

  it('gives what has been received by an instant, oldest first', () => {
    expect(framesAt(replay, ms('14:22:59')).map(timeOf)).toEqual([ms('14:22:56'), ms('14:22:58')])
    expect(framesAt(replay, ms('14:23:00'))).toHaveLength(5)
    expect(framesAt(replay, replay.to)).toEqual(replay.frames)
  })

  it('gives the last telemetry before the span from its first second on', () => {
    expect(framesAt(replay, replay.from)).toMatchObject([{ type: 'telemetry', payload: { ts: at('14:22:56') } }])
  })
})
