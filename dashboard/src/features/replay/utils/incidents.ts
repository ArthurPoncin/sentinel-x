import type { Alert, AlertKind, Frame, Incident, Severity } from '@/shared/contract'

// Where an Incident sits among the Alerts of a history: from the one that opened it to the last one so far.
interface Span {
  first: number
  last: number
  // Every Alert raised since `first` is cleared by `last`.
  closed: boolean
}

const RANK: Readonly<Record<Severity, number>> = { info: 0, warning: 1, critical: 2 }

// The Alerts of a history by date, like the Command Post's: two that came in out of order are taken in the
// order they happened.
function alertsOf(history: readonly Frame[]): Alert[] {
  return history
    .flatMap((frame) => (frame.type === 'alert' ? [frame.payload] : []))
    .toSorted((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}

// Groups the Alerts, oldest first, into Incidents: a `raised` opens one when none is going on, it closes on the
// `cleared` that leaves no Alert raised. Paired by alert_id, the Command Post's own rule (backend/src/incidents.ts).
function spansOf(alerts: readonly Alert[]): Span[] {
  const spans: Span[] = []
  const raised = new Set<string>()
  let current: Span | undefined

  alerts.forEach((alert, index) => {
    if (alert.state === 'raised') raised.add(alert.alert_id)
    else raised.delete(alert.alert_id)

    if (!current) {
      // A cleared with no Incident going on closes nothing and opens nothing: the history may start after
      // its raised.
      if (alert.state === 'cleared') return
      current = { first: index, last: index, closed: false }
      spans.push(current)
    }
    current.last = index
    if (raised.size === 0) {
      current.closed = true
      current = undefined
    }
  })
  return spans
}

function summarize(alerts: readonly Alert[], span: Span, incident_id: number): Incident {
  const own = alerts.slice(span.first, span.last + 1)
  const peak = own
    .filter((alert) => alert.state === 'raised')
    .reduce<Severity>((peak, alert) => (RANK[alert.severity] > RANK[peak] ? alert.severity : peak), 'info')
  const opening = alerts[span.first] as Alert
  const closing = alerts[span.last] as Alert

  return {
    incident_id,
    start: opening.ts,
    end: span.closed ? closing.ts : null,
    ongoing: !span.closed,
    alerts: own.length,
    kinds: [...new Set<AlertKind>(own.map((alert) => alert.kind))],
    peak,
  }
}

// Every Incident of a history of frames, oldest first: from the first `raised` until every Alert raised since is
// `cleared`. Pure: what the Command Post's GET /api/v1/incidents gives for its own history, here for any list
// of frames — the live feed's, a recorded one, a scripted one.
export function incidents(history: readonly Frame[]): Incident[] {
  const alerts = alertsOf(history)
  return spansOf(alerts).map((span, index) => summarize(alerts, span, index + 1))
}
