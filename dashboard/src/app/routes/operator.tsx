import { FeedInspector } from '@/features/live-feed'

// The Operator's screen. Next: gas curve (#21), then every curve, Status badge and Alerts (#11),
// camera and actuators (#14).
export function OperatorRoute() {
  return (
    <section>
      <h1>Operator</h1>
      <FeedInspector />
    </section>
  )
}
