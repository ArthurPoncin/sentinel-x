import type { IncidentsToReplay } from '../hooks/use-incidents-to-replay'
import type { Player } from '../hooks/use-player'
import { clockTime, describeIncident, minutes } from '../utils/labels'
import { scenario } from '../utils/scenario'

export interface TimeScrubberProps {
  // Plays the replays; whoever holds it rebuilds the Twin from `player.frames`.
  player: Player
  // The Incidents there are to replay on it, from `useIncidentsToReplay`: whatever else lists them on the same
  // screen is handed the same.
  incidents: IncidentsToReplay
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
export function TimeScrubber({ player, incidents }: TimeScrubberProps) {
  const { listed, source, failed, refresh } = incidents

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
                  if (chosen) void incidents.open(chosen)
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
              {source === 'asking'
                ? 'Asking the Command Post…'
                : source === 'command-post'
                  ? 'Recorded by the Command Post'
                  : 'Command Post unreachable: Incidents seen by this window'}
            </p>
            {failed && (
              <p className="scrubber-error" role="alert">
                Incident #{failed.incident.incident_id} could not be loaded: {failed.cause}
              </p>
            )}
          </>
        )}
      </section>
    </>
  )
}
