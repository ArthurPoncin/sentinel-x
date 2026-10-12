import type { Alert, AlertKind, Frame } from '@/shared/contract'

export const LOG_LIMIT = 50

// The kinds raised again and again under one alert_id while they go on: an intruder at each position,
// an attack at each attempt refused.
const RAISED_AGAIN: ReadonlySet<AlertKind> = new Set(['intrusion', 'cyber'])

// Every Alert transition in the live history, the latest first. Of an intruder that moves or an attack
// that goes on, only the first raised is kept: the log is not a track, nor a count of attempts.
export function alertLog(history: readonly Frame[], limit = LOG_LIMIT): Alert[] {
  const entries: Alert[] = []
  const open = new Set<string>()
  for (const frame of history) {
    if (frame.type !== 'alert') continue
    const alert = frame.payload
    if (alert.state === 'cleared') {
      open.delete(alert.alert_id)
      entries.push(alert)
    } else if (!RAISED_AGAIN.has(alert.kind) || !open.has(alert.alert_id)) {
      if (RAISED_AGAIN.has(alert.kind)) open.add(alert.alert_id)
      entries.push(alert)
    }
  }
  return entries.reverse().slice(0, limit)
}
