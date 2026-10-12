import { LevelBadge } from '@/shared/components/level-badge'
import type { Incident } from '@/shared/contract'
import { clock, duration } from '@/shared/lib/format'
import { KIND_LABEL, SEVERITY_LABEL } from '@/shared/lib/labels'
import { toneOfSeverity } from '@/shared/lib/tone'
import type { IncidentsToReplay } from '../hooks/use-incidents-to-replay'

const SOURCE: Record<IncidentsToReplay['source'], string> = {
  asking: 'Interrogation du Command Post…',
  'command-post': 'Enregistrés par le Command Post',
  window: 'Command Post injoignable : incidents vus par cette fenêtre',
}

function span(incident: Incident): string {
  return incident.end === null ? 'en cours' : duration(Date.parse(incident.end) - Date.parse(incident.start))
}

// The Incidents there are to replay, newest first, with no frame around them: each is a button, and choosing one
// replays it. The same list as the time-scrubber's, in the Operator's French.
export function IncidentList({ incidents }: { incidents: IncidentsToReplay }) {
  const { listed, source, failed } = incidents

  return (
    <div className="flex flex-col gap-2">
      {listed.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Aucun incident enregistré.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {listed.map((incident) => (
            <li key={incident.incident_id}>
              <button
                type="button"
                className="incident-choice"
                title={`Rejouer l'incident n° ${incident.incident_id}`}
                onClick={() => void incidents.open(incident)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium tabular-nums">
                    N° {incident.incident_id} · {clock(incident.start)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {span(incident)} · {incident.kinds.map((kind) => KIND_LABEL[kind]).join(', ')}
                  </span>
                </span>
                <LevelBadge tone={toneOfSeverity[incident.peak]}>{SEVERITY_LABEL[incident.peak]}</LevelBadge>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{SOURCE[source]}</p>
      {failed && (
        <p className="text-xs text-critical" role="alert">
          L'incident n° {failed.incident.incident_id} n'a pas pu être chargé : {failed.cause}
        </p>
      )}
    </div>
  )
}
