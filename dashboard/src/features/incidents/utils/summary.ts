import type { AlertKind, Incident } from '@/shared/contract'

export interface IncidentSummary {
  total: number
  // Back to nominal: every Alert of the Incident cleared.
  resolved: number
  ongoing: number
  // Reached `critical` at some point.
  critical: number
  // Mean time from the first Alert to the return to nominal, over the resolved ones. Null if none.
  meanResolutionMs: number | null
  // How many Incidents involved each kind, the most frequent first. Kinds never seen are left out.
  byKind: { kind: AlertKind; incidents: number }[]
}

export function summarize(incidents: readonly Incident[]): IncidentSummary {
  const resolved = incidents.filter((incident) => incident.end !== null)
  const durations = resolved.map((incident) => Date.parse(incident.end as string) - Date.parse(incident.start))
  const counts = new Map<AlertKind, number>()
  for (const incident of incidents) {
    for (const kind of incident.kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }

  return {
    total: incidents.length,
    resolved: resolved.length,
    ongoing: incidents.length - resolved.length,
    critical: incidents.filter((incident) => incident.peak === 'critical').length,
    meanResolutionMs: durations.length === 0 ? null : durations.reduce((sum, ms) => sum + ms, 0) / durations.length,
    byKind: [...counts]
      .map(([kind, count]) => ({ kind, incidents: count }))
      .sort((a, b) => b.incidents - a.incidents),
  }
}

// The latest Incidents first, for the table.
export function latestFirst(incidents: readonly Incident[], limit: number): Incident[] {
  return incidents.toReversed().slice(0, limit)
}
