import { useMemo } from 'react'
import { useLocation } from 'react-router'
import { useLiveFeed } from '@/features/live-feed'
import { OutpostTwin, toScene } from '@/features/twin'
import { captureMode } from '@/shared/config/capture-mode'

// The Digital Twin's screen: the 3D Outpost graded by the Status, its Enclosure showing the Status and
// reacting to gas, on the whole window under the top bar. Next: intrusion and predictive pulse (#13).
// With `?capture` it is the Twin alone, on the same feed: no top bar, no caption, the whole stage held in
// frame, to be filmed in a vertical window for the teaser.
export function TwinRoute() {
  const capture = captureMode(useLocation())
  const status = useLiveFeed((state) => state.status)
  const latestTelemetry = useLiveFeed((state) => state.latestTelemetry)
  const activeAlerts = useLiveFeed((state) => state.activeAlerts)
  const scene = useMemo(
    () => toScene({ status, latestTelemetry, activeAlerts }),
    [status, latestTelemetry, activeAlerts],
  )

  return (
    <section className="stage" data-capture={capture || undefined}>
      <OutpostTwin scene={scene} wholeStage={capture} />
      {!capture && (
        <div className="stage-caption">
          <h1>Digital Twin</h1>
          <p>
            Outpost Status: <strong data-status={status}>{status}</strong> · Gas:{' '}
            {latestTelemetry?.readings.air ?? '—'}
          </p>
        </div>
      )}
    </section>
  )
}
