import type { Alert, Severity } from '@/shared/contract'
import { decimal } from '@/shared/lib/format'

export { KIND_LABEL, SEVERITY_LABEL, SOURCE_LABEL } from '@/shared/lib/labels'

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 }

// The one line that says what an Alert is about, from what its kind carries.
export function describeAlert(alert: Alert): string {
  switch (alert.kind) {
    case 'intrusion':
      return `Personne détectée, confiance ${Math.round(alert.detail.confidence * 100)} %`
    case 'predictive':
      return `Score d'anomalie ${decimal(alert.detail.anomaly_score, 2)} sur ${alert.detail.drivers.join(', ') || 'les mesures'}`
    case 'gas':
      return alert.value === undefined ? 'Gaz hors seuil' : `Mesure de gaz à ${alert.value}`
    case 'thermal':
      return alert.value === undefined ? 'Température hors seuil' : `Température à ${decimal(alert.value, 1)} °C`
    case 'noise':
      return alert.value === undefined ? 'Bruit fort' : `Son sur ${Math.round(alert.value * 100)} % du cycle`
    case 'presence':
      return 'Mouvement détecté par le PIR'
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
