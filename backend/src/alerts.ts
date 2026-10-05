import { type Alert, AlertSchema } from './contract.js'
import { type HistoryRepository, keep } from './history.js'
import type { Hub } from './hub.js'
import { computeStatus } from './status.js'

// What an ingress path knows about the Alert whatever the payload claims: the MQTT topic
// names the Sentinel, the authenticated channel names the source.
export type AlertChannel = Partial<Pick<Alert, 'source' | 'sentinel'>>

// Turns a raw payload from any ingress path into the one Alert shape, or says why it cannot.
export function normalizeAlert(raw: unknown, channel: AlertChannel = {}) {
  const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
  return AlertSchema.safeParse(isObject ? { ...raw, ...channel } : raw)
}

export interface AlertPipeline {
  // Takes a normalized Alert in: pairs it by alert_id, records it in the history, broadcasts it,
  // then the Status it leads to.
  accept(alert: Alert): void
}

export function createAlertPipeline(hub: Pick<Hub, 'broadcast'>, history: HistoryRepository): AlertPipeline {
  // Raised and not cleared yet, by alert_id. A raised on a known id replaces it.
  const active = new Map<string, Alert>()

  return {
    accept(alert) {
      if (alert.state === 'raised') active.set(alert.alert_id, alert)
      else active.delete(alert.alert_id)

      const frame = { type: 'alert', payload: alert } as const
      keep(history, frame)
      hub.broadcast(frame)
      hub.broadcast({
        type: 'status',
        payload: { status: computeStatus([...active.values()]), ts: new Date().toISOString() },
      })
    },
  }
}
