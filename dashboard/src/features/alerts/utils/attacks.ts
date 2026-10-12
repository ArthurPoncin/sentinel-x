import type { Alert, CyberVector, Frame } from '@/shared/contract'

// An attack on the Command Post going on: a `cyber` Alert raised and not cleared, in figures.
export interface Attack {
  alertId: string
  // The entry point it goes for.
  vector: CyberVector
  // Where it comes from, when the Command Post knows.
  address?: string
  // The attempts refused so far.
  attempts: number
  // When it was first raised, in ms since the epoch.
  since: number
}

// The attacks going on, in the order they began: the active `cyber` Alerts, each with the instant it was
// first raised. An Alert raised again carries the instant of its last attempt, so the first is read from the
// frames; where they no longer hold it, the Alert's own instant stands for it.
export function attacks(active: readonly Alert[], frames: readonly Frame[]): Attack[] {
  const began = new Map<string, number>()
  for (const frame of frames) {
    if (frame.type !== 'alert' || frame.payload.kind !== 'cyber') continue
    const { alert_id, state, ts } = frame.payload
    if (state === 'cleared') began.delete(alert_id)
    else if (!began.has(alert_id)) began.set(alert_id, Date.parse(ts))
  }
  return active.flatMap((alert) => {
    if (alert.kind !== 'cyber') return []
    const { vector, attempts, address } = alert.detail
    const since = began.get(alert.alert_id) ?? Date.parse(alert.ts)
    return [{ alertId: alert.alert_id, vector, ...(address === undefined ? {} : { address }), attempts, since }]
  })
}
