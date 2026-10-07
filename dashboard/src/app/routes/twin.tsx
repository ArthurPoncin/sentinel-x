import { useMemo } from 'react'
import { useLocation } from 'react-router'
import { stateAfter, useLiveFeed } from '@/features/live-feed'
import { TimeScrubber, usePlayer } from '@/features/replay'
import { OutpostTwin, toScene } from '@/features/twin'
import { captureMode } from '@/shared/config/capture-mode'
import { feedEncrypted } from '@/shared/config/feed-url'
import { decimal } from '@/shared/lib/format'

// The Digital Twin's screen: the 3D Outpost graded by the Status, its Enclosure showing the Status, reacting
// to gas and sounding the Alarm, a haze around its gas pipe, its generator hall reacting to heat, on the whole
// space under the header. An intrusion lights the camera's sector and stands the intruder on the perimeter, a
// figurine in hologram walking along the arc, tied to the lens, in the brackets of its detection and labelled
// with the vision model's confidence; a predictive drift pulses the Probes it names and
// labels them with its score, a presence blinks the PIR dome and sweeps the fence in amber, and it or an
// intrusion lights the floodlights on the perimeter,
// a clap sends a wave from the Enclosure over the socle. The camera turns to each Alert as it is raised, then
// orbits again. The Enclosure's antenna sends an impulse for each frame of telemetry, and a padlock reads
// « WSS » by it while the live feed is encrypted: not on a plain one, not in a replay. When the feed drops, it all turns grey: nothing here
// is live any more. The time-scrubber replays a past Incident or the scripted scenario in it, second by second,
// labelled REPLAY: the Twin is then rebuilt from the replayed frames, not the live ones.
// With `?capture` it is the Twin alone, on the same feed: no top bar, no sidebar, no caption, no scrubber, the whole stage
// held in frame, to be filmed in a vertical window for the teaser.
export function TwinRoute() {
  const capture = captureMode(useLocation())
  const connection = useLiveFeed((state) => state.connection)
  const connectedOnce = useLiveFeed((state) => state.connectedOnce)
  const status = useLiveFeed((state) => state.status)
  const latestTelemetry = useLiveFeed((state) => state.latestTelemetry)
  const activeAlerts = useLiveFeed((state) => state.activeAlerts)
  const history = useLiveFeed((state) => state.history)
  const player = usePlayer()
  const shown = useMemo(
    () =>
      player.frames ? stateAfter(player.frames) : { connection, connectedOnce, status, latestTelemetry, activeAlerts },
    [player.frames, connection, connectedOnce, status, latestTelemetry, activeAlerts],
  )
  // Read from the page, as the feed's address is: a replay is no link, and shows no padlock.
  const encrypted = !player.replay && feedEncrypted(window.location)
  const scene = useMemo(() => toScene(shown, { encrypted }), [shown, encrypted])
  const readings = shown.latestTelemetry?.readings

  return (
    <section className="stage" data-capture={capture || undefined} data-replay={player.replay ? true : undefined}>
      <OutpostTwin scene={scene} frames={player.frames ?? history} wholeStage={capture} />
      {!capture && (
        <>
          <div className="stage-caption" data-stale={scene.signalLost}>
            <h1>Digital Twin</h1>
            <p>
              Outpost Status: <strong data-status={shown.status}>{shown.status}</strong> · Gas: {readings?.air ?? '—'}{' '}
              · Temp: {readings ? `${decimal(readings.temp, 1)} °C` : '—'} · Humidity:{' '}
              {readings ? `${decimal(readings.humidity, 0)} %` : '—'}
            </p>
          </div>
          <TimeScrubber history={history} player={player} />
        </>
      )}
    </section>
  )
}
