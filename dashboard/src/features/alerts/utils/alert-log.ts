import type { Alert, Frame } from '@/shared/contract'

export const LOG_LIMIT = 50

// Every Alert transition in the live history, the latest first. An intruder that moves sends a
// raised per position on the same alert_id: only its first one is kept, the log is not a track.
export function alertLog(history: readonly Frame[], limit = LOG_LIMIT): Alert[] {
  const entries: Alert[] = []
  const open = new Set<string>()
  for (const frame of history) {
    if (frame.type !== 'alert') continue
    const alert = frame.payload
    if (alert.state === 'cleared') {
      open.delete(alert.alert_id)
      entries.push(alert)
    } else if (alert.kind !== 'intrusion' || !open.has(alert.alert_id)) {
      if (alert.kind === 'intrusion') open.add(alert.alert_id)
      entries.push(alert)
    }
  }
  return entries.reverse().slice(0, limit)
}
