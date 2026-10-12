import { type Incident, type IncidentReplay, IncidentReplaySchema, IncidentsSchema } from '@/shared/contract'
import { lastClosed } from '../utils/incidents'

// The Incidents the Command Post has recorded, from the app's own origin like the feed (/api is proxied to the
// API). Rides on the Operator session cookie; anything but a 200 with a body in the contract is an error.
async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`)
  return response.json()
}

// Every Incident of the Command Post's history, oldest first: GET /api/v1/incidents.
export async function fetchIncidents(signal?: AbortSignal): Promise<Incident[]> {
  return IncidentsSchema.parse(await get('/api/v1/incidents', signal)).incidents
}

// One Incident and its telemetry + Alerts, oldest first: GET /api/v1/incidents/:incident_id.
export async function fetchIncidentReplay(incidentId: number, signal?: AbortSignal): Promise<IncidentReplay> {
  return IncidentReplaySchema.parse(await get(`/api/v1/incidents/${incidentId}`, signal))
}

// The last Incident of the Command Post's history that has closed, from the list it already gives: no route of
// its own. None while no Incident has closed.
export async function fetchLastClosedIncident(signal?: AbortSignal): Promise<Incident | null> {
  return lastClosed(await fetchIncidents(signal))
}
