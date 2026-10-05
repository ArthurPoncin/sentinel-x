import { useMemo } from 'react'
import { useLiveFeed } from '@/features/live-feed'
import { OutpostTwin, toScene } from '@/features/twin'

// The Digital Twin's screen: the 3D Outpost graded by the Status, reacting to gas. Next: intrusion
// and predictive pulse (#13).
export function TwinRoute() {
  const status = useLiveFeed((state) => state.status)
  const latestTelemetry = useLiveFeed((state) => state.latestTelemetry)
  const activeAlerts = useLiveFeed((state) => state.activeAlerts)
  const scene = useMemo(
    () => toScene({ status, latestTelemetry, activeAlerts }),
    [status, latestTelemetry, activeAlerts],
  )

  return (
    <section className="twin">
      <h1>Digital Twin</h1>
      <p>
        Outpost Status: <strong data-status={status}>{status}</strong> · Gas:{' '}
        {latestTelemetry?.readings.air ?? '—'}
      </p>
      <OutpostTwin scene={scene} />
    </section>
  )
}
