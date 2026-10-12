import { useCallback, useMemo, useState } from 'react'
import type { Frame, Incident } from '@/shared/contract'
import { fetchIncidentReplay } from '../api/incidents-client'
import { incidents } from '../utils/incidents'
import { replayOf } from '../utils/replay'
import type { Player } from './use-player'
import { useRecordedIncidents } from './use-recorded-incidents'

export interface IncidentsToReplay {
  // The Incidents there are to replay, newest first.
  listed: readonly Incident[]
  // Where they come from: the Command Post's records, or the feed this window received while it cannot be
  // reached. `asking` until it has answered once.
  source: 'asking' | 'command-post' | 'window'
  // The Incident whose replay could not be loaded, and why; null once another is asked for.
  failed: { incident: Incident; cause: string } | null
  // Asks the Command Post for its Incidents again.
  refresh(): void
  // Replays an Incident of the list on the player.
  open(incident: Incident): Promise<void>
}

// The Incidents a screen can replay, and how one is: one list for all that shows them on it. They are the Command
// Post's recorded ones; if it cannot be reached, those of the feed this window received (`history`, oldest
// first), grouped by the same rule.
export function useIncidentsToReplay(history: readonly Frame[], player: Player): IncidentsToReplay {
  const session = useMemo(() => incidents(history), [history])
  // Asked again of the Command Post when an Incident opens or closes in the live feed.
  const latest = session.at(-1)
  const { recorded, refresh } = useRecordedIncidents(`${session.length}:${latest?.end ?? latest?.start}`)
  const [failed, setFailed] = useState<IncidentsToReplay['failed']>(null)
  const fromCommandPost = recorded.state === 'loaded'
  const listed = useMemo(
    () => (recorded.state === 'loaded' ? recorded.incidents : session).toReversed(),
    [recorded, session],
  )
  const { load } = player

  const open = useCallback(
    async (incident: Incident) => {
      setFailed(null)
      if (!fromCommandPost) return load(replayOf(history, incident))
      try {
        const { incident: replayed, records } = await fetchIncidentReplay(incident.incident_id)
        load(replayOf(records, replayed))
      } catch (cause) {
        // The network dropped since the list came: this window may have seen it too, opening on the same Alert.
        const seen = session.find((known) => known.start === incident.start)
        if (seen) return load(replayOf(history, seen))
        setFailed({ incident, cause: String(cause) })
      }
    },
    [fromCommandPost, history, session, load],
  )

  const source = recorded.state === 'loading' ? 'asking' : fromCommandPost ? 'command-post' : 'window'
  return { listed, source, failed, refresh, open }
}
