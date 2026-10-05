import { useLiveFeed } from '../hooks/use-live-feed'

// The raw live state, to check the feed end to end. Scaffolding: the telemetry, status and alerts
// features replace it on the Operator view.
export function FeedInspector() {
  const status = useLiveFeed((state) => state.status)
  const telemetry = useLiveFeed((state) => state.latestTelemetry)
  const activeAlerts = useLiveFeed((state) => state.activeAlerts)
  const received = useLiveFeed((state) => state.history.length)

  return (
    <dl className="inspector">
      <dt>Status</dt>
      <dd data-status={status}>{status}</dd>

      <dt>Latest Readings</dt>
      <dd>
        {telemetry
          ? `${telemetry.readings.temp} °C · ${telemetry.readings.humidity} % · air ${telemetry.readings.air} · PIR ${telemetry.readings.pir ? 'on' : 'off'}`
          : '—'}
      </dd>

      <dt>Active Alerts</dt>
      <dd>
        {activeAlerts.length === 0 ? (
          'none'
        ) : (
          <ul>
            {activeAlerts.map((alert) => (
              <li key={alert.alert_id} data-severity={alert.severity}>
                {alert.kind} · {alert.severity}
              </li>
            ))}
          </ul>
        )}
      </dd>

      <dt>Frames received</dt>
      <dd>{received}</dd>
    </dl>
  )
}
