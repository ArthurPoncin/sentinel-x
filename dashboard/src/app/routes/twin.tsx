import { useCallback, useMemo } from 'react'
import { useLocation } from 'react-router'
import { ActiveAlertList } from '@/features/alerts'
import { CameraView } from '@/features/camera'
import { useHandWind, useLiveHands } from '@/features/gestures'
import { stateAfter, useLiveFeed } from '@/features/live-feed'
import { IncidentList, TimeScrubber, useIncidentsToReplay, usePlayer } from '@/features/replay'
import { GasCurve, TemperatureCurve, toSeries } from '@/features/telemetry'
import { type OperatorHands, OutpostTwin, toScene } from '@/features/twin'
import { GlassWindows, useWindows } from '@/features/windows'
import { captureMode } from '@/shared/config/capture-mode'
import { feedEncrypted } from '@/shared/config/feed-url'
import type { Alert } from '@/shared/contract'
import { decimal } from '@/shared/lib/format'

type Intrusion = Extract<Alert, { kind: 'intrusion' }>

// The Digital Twin's screen: the 3D Outpost graded by the Status, its Enclosure showing the Status, reacting
// to gas and sounding the Alarm, a haze around its gas pipe, its generator hall reacting to heat, on the whole
// space under the header. An intrusion lights the camera's sector and stands the intruder on the perimeter, a
// figurine in hologram walking along the arc, tied to the lens, in the brackets of its detection and labelled
// with the vision model's confidence; a predictive drift pulses the Probes it names and
// labels them with its score, a presence blinks the PIR dome and sweeps the fence in amber, and it or an
// intrusion lights the floodlights on the perimeter,
// a clap sends a wave from the Enclosure over the socle, an attack on the Command Post raises a shield around
// the whole Outpost, labelled with the entry point attacked and the attempts refused. The camera turns to each
// Alert as it is raised, then orbits again, and stands back for an attack. The Enclosure's antenna sends an impulse for each frame of telemetry, and a padlock reads
// « WSS » by it while the live feed is encrypted: not on a plain one, not in a replay. When the feed drops, it all turns grey: nothing here
// is live any more. The time-scrubber replays a past Incident or the scripted scenario in it, second by second,
// labelled REPLAY: the Twin is then rebuilt from the replayed frames, not the live ones.
// With the hand control on, a flat hand over the sensor steers the camera and the hands float in hologram in a
// corner of the view, green as a thumb is raised and red as one is turned down; two open hands moved apart or
// together zoom, a fist held to one side winds a replay.
// Glass windows float beside the Outpost, opened and closed from a bar at the foot of the stage, in slots of
// their own on either side of it, four at most: the camera's annotated stream, the gas curve, the temperature
// curve, the active Alerts from the most urgent, and the Incidents, where choosing one replays it. They read
// what the Twin shows, the live feed or the replayed instant; the camera's says in a replay that no picture is
// replayed.
// With `?capture` it is the Twin alone, on the same feed: no top bar, no sidebar, no caption, no scrubber, no window,
// the whole stage held in frame, to be filmed in a vertical window for the teaser.
export function TwinRoute() {
  const capture = captureMode(useLocation())
  const connection = useLiveFeed((state) => state.connection)
  const connectedOnce = useLiveFeed((state) => state.connectedOnce)
  const status = useLiveFeed((state) => state.status)
  const latestTelemetry = useLiveFeed((state) => state.latestTelemetry)
  const activeAlerts = useLiveFeed((state) => state.activeAlerts)
  const history = useLiveFeed((state) => state.history)
  const player = usePlayer()
  const incidents = useIncidentsToReplay(history, player)
  const [windows, sendToWindows] = useWindows()
  const live = useLiveHands()
  const operator = useMemo<OperatorHands | undefined>(
    () =>
      live
        ? {
            steer: live.steer,
            stretch: () => live.reading().stretch,
            aim: () => live.reading().aim,
            shot: () => live.reading().shot,
            hands() {
              const { confirming } = live.reading()
              const tint = confirming ? (confirming.pose === 'thumb-up' ? 'ok' : 'alarm') : 'idle'
              return live.hands().map(({ fingers }) => ({ fingers, tint, charge: confirming?.progress ?? 0 }))
            },
          }
        : undefined,
    [live],
  )
  const { seek, second } = player
  useHandWind(
    player.replay !== null,
    useCallback((by: number) => seek(second + by), [seek, second]),
  )
  const shown = useMemo(
    () =>
      player.frames ? stateAfter(player.frames) : { connection, connectedOnce, status, latestTelemetry, activeAlerts },
    [player.frames, connection, connectedOnce, status, latestTelemetry, activeAlerts],
  )
  // Read from the page, as the feed's address is: a replay is no link, and shows no padlock.
  const encrypted = !player.replay && feedEncrypted(window.location)
  const scene = useMemo(() => toScene(shown, { encrypted }), [shown, encrypted])
  const readings = shown.latestTelemetry?.readings
  // The curves of what is shown: up to the replayed instant in a replay.
  const series = useMemo(() => toSeries(player.frames ?? history), [player.frames, history])
  const intrusion = useMemo(
    () => shown.activeAlerts.find((alert): alert is Intrusion => alert.kind === 'intrusion') ?? null,
    [shown.activeAlerts],
  )

  return (
    <section className="stage" data-capture={capture || undefined} data-replay={player.replay ? true : undefined}>
      <OutpostTwin scene={scene} frames={player.frames ?? history} wholeStage={capture} operator={capture ? undefined : operator} />
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
          <TimeScrubber player={player} incidents={incidents} />
          <GlassWindows
            windows={windows}
            send={sendToWindows}
            content={{
              camera: <CameraView intrusion={intrusion} replayed={player.replay !== null} />,
              gas: <GasCurve series={series} />,
              temperature: <TemperatureCurve series={series} />,
              alerts: <ActiveAlertList alerts={shown.activeAlerts} wrap />,
              incidents: <IncidentList incidents={incidents} />,
            }}
          />
        </>
      )}
    </section>
  )
}
