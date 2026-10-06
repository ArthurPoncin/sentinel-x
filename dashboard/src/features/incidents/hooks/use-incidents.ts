import { useEffect, useRef, useState } from 'react'
import { getJson } from '@/shared/api/http'
import { type Incident, IncidentsSchema } from '@/shared/contract'

export interface IncidentsState {
  incidents: Incident[] | null
  failed: boolean
}

// Gathers Alert frames that arrive together (an intruder moves every second) into one request.
const SETTLE_MS = 600
// In case an Alert went by while this screen was not listening.
const POLL_MS = 15_000

// The Incidents of the whole recorded history, from GET /api/v1/incidents. Fetched again shortly
// after `trigger` changes: pass something that changes with every Alert, like the active Alerts.
export function useIncidents(trigger: unknown): IncidentsState {
  const [state, setState] = useState<IncidentsState>({ incidents: null, failed: false })
  const inFlight = useRef<AbortController | null>(null)

  const load = useRef(() => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    getJson('/api/v1/incidents', IncidentsSchema, controller.signal)
      .then(({ incidents }) => setState({ incidents, failed: false }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, failed: true }))
        if (!(error instanceof DOMException)) console.warn('Could not load the Incidents:', error)
      })
  }).current

  useEffect(() => {
    const poll = setInterval(load, POLL_MS)
    return () => {
      clearInterval(poll)
      inFlight.current?.abort()
    }
  }, [load])

  useEffect(() => {
    const settle = setTimeout(load, SETTLE_MS)
    return () => clearTimeout(settle)
  }, [trigger, load])

  return state
}
