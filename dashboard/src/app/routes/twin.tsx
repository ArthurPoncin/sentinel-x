import { useLiveFeed } from '@/features/live-feed'

// The Digital Twin's screen. Next: the 3D Outpost reacting to gas (#20), scene mapper and Status
// color (#12), intrusion and predictive pulse (#13).
export function TwinRoute() {
  const status = useLiveFeed((state) => state.status)

  return (
    <section>
      <h1>Digital Twin</h1>
      <p>
        Outpost Status: <strong data-status={status}>{status}</strong>
      </p>
    </section>
  )
}
