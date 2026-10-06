import type { Frame, Incident, Severity, StatusLevel } from '@/shared/contract'

// How much of the calm before an Incident, and of the calm after it, its replay shows: the Twin is seen at rest
// before the first Alert and back at rest after the last.
export const LEAD_MS = 3_000

// What the time-scrubber plays: a span of recorded (or scripted) time, second by second.
export interface Replay {
  // What the REPLAY label names: « Incident #3 », « Scenario ».
  title: string
  // The span the scrubber runs over, in ms since the epoch: `from` is its second 0, `to` its last.
  from: number
  to: number
  // What is replayed, oldest first: the frames of the span, the last telemetry before it, and after each Alert
  // the Status it leads to. Copies, never the live feed's own objects: the Twin tells a replayed frame from a
  // live one by identity, and does not play the live feed's claps again on the way back.
  frames: readonly Frame[]
}

export function timeOf(frame: Frame): number {
  return Date.parse(frame.payload.ts)
}

// The Command Post's rule (backend/src/status.ts): the highest severity among the active Alerts.
function statusOf(active: Iterable<Severity>): StatusLevel {
  const severities = new Set(active)
  if (severities.has('critical')) return 'critical'
  if (severities.has('warning')) return 'elevated'
  return 'nominal'
}

// The frames with the Status each Alert leads to right after it. The history keeps no Status (it follows from
// the Alerts), so a replay works it out the way the Command Post does; a Status frame already there is dropped,
// so that there is only one rule. Pairs by alert_id, like the live feed.
export function withStatus(frames: readonly Frame[]): Frame[] {
  const active = new Map<string, Severity>()
  return frames.flatMap((frame): Frame[] => {
    if (frame.type === 'status') return []
    if (frame.type === 'telemetry') return [{ ...frame }]
    const alert = frame.payload
    if (alert.state === 'raised') active.set(alert.alert_id, alert.severity)
    else active.delete(alert.alert_id)
    return [{ ...frame }, { type: 'status', payload: { status: statusOf(active.values()), ts: alert.ts } }]
  })
}

// The replay of an Incident of `history` (the live feed's, or the records the Command Post sends for it): its
// span with LEAD_MS of calm on each side, or up to the last frame while it is still going on.
export function replayOf(history: readonly Frame[], incident: Incident): Replay {
  const from = Date.parse(incident.start) - LEAD_MS
  const last = history.at(-1)
  const to = incident.end === null ? Math.max(from, last ? timeOf(last) : from) : Date.parse(incident.end) + LEAD_MS
  // What the Twin shows at second 0: the Readings of then, not none.
  const seed = history.findLast((frame) => frame.type === 'telemetry' && timeOf(frame) < from)
  const span = history.filter((frame) => from <= timeOf(frame) && timeOf(frame) <= to)

  return { title: `Incident #${incident.incident_id}`, from, to, frames: withStatus(seed ? [seed, ...span] : span) }
}

// How many seconds the scrubber runs over: its last second is `to`, even if the span is not a whole number.
export function lengthOf(replay: Replay): number {
  return Math.ceil((replay.to - replay.from) / 1000)
}

// The instant of a second of the replay, 0 to lengthOf(replay).
export function instantAt(replay: Replay, second: number): number {
  return Math.min(replay.from + second * 1000, replay.to)
}

// What has been received by `t` (ms since the epoch) in a replay, oldest first: the frames the Twin is rebuilt
// from at that instant.
export function framesAt(replay: Replay, t: number): readonly Frame[] {
  return replay.frames.filter((frame) => timeOf(frame) <= t)
}
