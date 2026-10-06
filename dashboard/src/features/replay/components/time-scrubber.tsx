import { useMemo, useState } from 'react'
import type { Frame, Incident } from '@/shared/contract'
import { fetchIncidentReplay } from '../api/incidents-client'
import type { Player } from '../hooks/use-player'
import { useRecordedIncidents } from '../hooks/use-recorded-incidents'
import { incidents } from '../utils/incidents'
import { clockTime, describeIncident, minutes } from '../utils/labels'
import { replayOf } from '../utils/replay'
import { scenario } from '../utils/scenario'

export interface TimeScrubberProps {
  // The live feed's frames, oldest first: the Incidents this window saw, replayed when the Command Post cannot
  // be reached.
  history: readonly Frame[]
  // Plays the replays; whoever holds it rebuilds the Twin from `player.frames`.
  player: Player
}

// The label over the Twin that tells live from replay: LIVE, or REPLAY with what is replayed and the time it
// shows. Never both, never neither.
function ModeLabel({ player }: { player: Player }) {
  const { replay } = player
  return (
    <p className="replay-label" role="status" data-mode={replay ? 'replay' : 'live'}>
      {replay ? (
        <>
          <strong>Replay</strong> · {replay.title} · {clockTime(player.at)}
        </>
      ) : (
        <strong>Live</strong>
      )}
    </p>
  )
}

// The demo's insurance, over the Twin: pick a past Incident and replay it second by second, or play the scripted
// scenario. The Incidents are the Command Post's recorded ones; if it cannot be reached, those of the feed this
// window received, grouped by the same rule.
export function TimeScrubber({ history, player }: TimeScrubberProps) {
  const session = useMemo(() => incidents(history), [history])
  // Asked again of the Command Post when an Incident opens or closes in the live feed.
  const latest = session.at(-1)
  const { recorded, refresh } = useRecordedIncidents(`${session.length}:${latest?.end ?? latest?.start}`)
  const [error, setError] = useState<string | null>(null)
  const fromCommandPost = recorded.state === 'loaded'
  const listed = useMemo(
    () => (recorded.state === 'loaded' ? recorded.incidents : session).toReversed(),
    [recorded, session],
  )

  const open = async (incident: Incident) => {
    setError(null)
    if (!fromCommandPost) return player.load(replayOf(history, incident))
    try {
      const { incident: replayed, records } = await fetchIncidentReplay(incident.incident_id)
      player.load(replayOf(records, replayed))
    } catch (cause) {
      // The network dropped since the list came: this window may have seen it too, opening on the same Alert.
      const seen = session.find((known) => known.start === incident.start)
      if (seen) return player.load(replayOf(history, seen))
      setError(`Incident #${incident.incident_id} could not be loaded: ${String(cause)}`)
    }
  }

  return (
    <>
      <ModeLabel player={player} />
      <section className="scrubber" aria-label="Time-scrubber">
        {player.replay ? (
          <>
            <div className="scrubber-row">
              <button type="button" onClick={player.toggle}>
                {player.playing ? 'Pause' : 'Play'}
              </button>
              <input
                type="range"
                aria-label="Second of the replay"
                min={0}
                max={player.length}
                step={1}
                value={player.second}
                onChange={(event) => player.seek(event.currentTarget.valueAsNumber)}
              />
              <span className="scrubber-time">
                {minutes(player.second)} / {minutes(player.length)}
              </span>
            </div>
            <button type="button" className="scrubber-live" onClick={player.stop}>
              Back to live
            </button>
          </>
        ) : (
          <>
            <div className="scrubber-row">
              <select
                aria-label="Incident to replay"
                value=""
                disabled={listed.length === 0}
                onChange={(event) => {
                  const chosen = listed.find((incident) => incident.incident_id === Number(event.currentTarget.value))
                  if (chosen) void open(chosen)
                }}
              >
                <option value="" disabled>
                  {listed.length > 0 ? 'Replay an Incident…' : 'No Incident yet'}
                </option>
                {listed.map((incident) => (
                  <option key={incident.incident_id} value={incident.incident_id}>
                    {describeIncident(incident)}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="Refresh the Incidents" title="Refresh the Incidents" onClick={refresh}>
                ↻
              </button>
            </div>
            <button type="button" onClick={() => player.load(scenario(Date.now()))}>
              Play the scenario
            </button>
            <p className="scrubber-source">
              {recorded.state === 'loading'
                ? 'Asking the Command Post…'
                : fromCommandPost
                  ? 'Recorded by the Command Post'
                  : 'Command Post unreachable: Incidents seen by this window'}
            </p>
            {error && (
              <p className="scrubber-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </section>
    </>
  )
}
