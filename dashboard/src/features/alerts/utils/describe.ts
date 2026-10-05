import type { Alert, AlertSource, Severity } from '@/shared/contract'

export { KIND_LABEL, SEVERITY_LABEL } from '@/shared/lib/labels'

export const SOURCE_LABEL: Record<AlertSource, string> = {
  esp32: 'Sentinel',
  vision: 'Vision AI',
  predictive: 'Predictive AI',
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 }

// The one line that says what an Alert is about, from what its kind carries.
export function describeAlert(alert: Alert): string {
  switch (alert.kind) {
    case 'intrusion':
      return `Person seen, ${Math.round(alert.detail.confidence * 100)} % confidence`
    case 'predictive':
      return `Anomaly score ${alert.detail.anomaly_score.toFixed(2)} on ${alert.detail.drivers.join(', ') || 'the Readings'}`
    case 'gas':
      return alert.value === undefined ? 'Gas Reading out of band' : `Air Reading at ${alert.value}`
    case 'thermal':
      return alert.value === undefined ? 'Temperature out of band' : `Temperature at ${alert.value} °C`
    case 'noise':
      return alert.value === undefined ? 'Loud sound' : `Sound ${Math.round(alert.value * 100)} % of the cycle`
    case 'presence':
      return 'Motion on the PIR'
  }
}

// The active Alerts, the most severe first, then the latest first: what to look at now.
export function byUrgency(alerts: readonly Alert[]): Alert[] {
  return alerts.toSorted(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || Date.parse(b.ts) - Date.parse(a.ts),
  )
}

// The Alerts to announce: those raised in `next` that `previous` did not hold at the same or a
// higher severity. An intruder moving keeps its alert_id and severity, so it is announced once.
export function newlyRaised(previous: readonly Alert[], next: readonly Alert[]): Alert[] {
  const known = new Map(previous.map((alert) => [alert.alert_id, alert.severity]))
  return next.filter((alert) => {
    const before = known.get(alert.alert_id)
    return before === undefined || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[before]
  })
}
