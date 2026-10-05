import type { Alert, AlertKind, Incident, IncidentReplay, Severity } from './contract.js'
import { type HistoryRepository, instant } from './history.js'

// Where an Incident sits among all the Alerts: from the one that opened it to the last one so far.
interface Span {
  first: number
  last: number
  // Every Alert raised since `first` is cleared by `last`.
  closed: boolean
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 }

// The latest instant a Date holds: the end of the range of an Incident still going on.
const END_OF_TIME = new Date(8.64e15).toISOString()

// Groups the Alerts, oldest first, into Incidents: a `raised` opens one when none is going on,
// it closes on the `cleared` that leaves no Alert raised. Pairs by alert_id, like the Status.
function spansOf(alerts: readonly Alert[]): Span[] {
  const spans: Span[] = []
  const raised = new Set<string>()
  let current: Span | undefined

  alerts.forEach((alert, index) => {
    if (alert.state === 'raised') raised.add(alert.alert_id)
    else raised.delete(alert.alert_id)

    if (!current) {
      // A cleared with no Incident going on closes nothing and opens nothing.
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
  const kinds = [...new Set<AlertKind>(own.map((alert) => alert.kind))]
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
    kinds,
    peak,
  }
}

// Every Incident of the history, oldest first.
export function listIncidents(history: HistoryRepository): Incident[] {
  const alerts = history.alerts()
  return spansOf(alerts).map((span, index) => summarize(alerts, span, index + 1))
}

// One Incident and what the Twin replays of it, or undefined if there is no such Incident.
export function replayIncident(history: HistoryRepository, incident_id: number): IncidentReplay | undefined {
  const alerts = history.alerts()
  const span = spansOf(alerts)[incident_id - 1]
  if (!span) return undefined

  const incident = summarize(alerts, span, incident_id)
  const records = history.query({ from: incident.start, to: incident.end ?? END_OF_TIME })

  // The range starts and ends on an instant other Incidents may share: a cleared closing the one
  // before, a raised opening the next. Its Alerts come in the same order as in `alerts`, so this
  // Incident's own are the ones ranked from `before`, the Alerts of its first instant ahead of it.
  const from = instant(incident.start)
  const before = alerts.slice(0, span.first).filter((alert) => instant(alert.ts) === from).length
  let rank = 0
  const own = records.filter((record) => {
    if (record.type === 'telemetry') return true
    const at = rank++
    return before <= at && at < before + incident.alerts
  })

  return { incident, records: own }
}
