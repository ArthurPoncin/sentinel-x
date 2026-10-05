import { useLiveFeed } from '@/features/live-feed'
import { OutpostTwin } from '@/features/twin'

// The Digital Twin's screen: the 3D Outpost reacting to gas. Next: scene mapper and Status color
// (#12), intrusion and predictive pulse (#13).
export function TwinRoute() {
  const status = useLiveFeed((state) => state.status)
  const air = useLiveFeed((state) => state.latestTelemetry?.readings.air ?? null)

  return (
    <section className="twin">
      <h1>Digital Twin</h1>
      <p>
        Outpost Status: <strong data-status={status}>{status}</strong> · Gas: {air ?? '—'}
      </p>
      <OutpostTwin air={air} />
    </section>
  )
}
