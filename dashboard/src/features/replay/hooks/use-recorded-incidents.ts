import { useCallback, useEffect, useState } from 'react'
import type { Incident } from '@/shared/contract'
import { fetchIncidents } from '../api/incidents-client'

export type RecordedIncidents =
  | { state: 'loading' }
  | { state: 'loaded'; incidents: readonly Incident[] }
  // The Command Post did not answer, or refused (no Operator session): the scrubber falls back on the feed
  // this window received.
  | { state: 'unreachable'; reason: string }

// The Incidents of the Command Post's history, asked for again whenever `key` changes (a new Incident in the
// live feed) and on `refresh()`.
export function useRecordedIncidents(key: unknown): { recorded: RecordedIncidents; refresh: () => void } {
  const [recorded, setRecorded] = useState<RecordedIncidents>({ state: 'loading' })
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    fetchIncidents(abort.signal).then(
      (incidents) => setRecorded({ state: 'loaded', incidents }),
      (error: unknown) => {
        if (!abort.signal.aborted) setRecorded({ state: 'unreachable', reason: String(error) })
      },
    )
    return () => abort.abort()
  }, [key, asked])

  const refresh = useCallback(() => setAsked((count) => count + 1), [])
  return { recorded, refresh }
}
