import { useMemo } from 'react'
import { ActuatorPanel } from '@/features/actuators'
import { ActiveAlerts, AlertLog, AlertToasts } from '@/features/alerts'
import { CameraPanel } from '@/features/camera'
import { IncidentTable, ThreatOverview, useIncidents } from '@/features/incidents'
import { useLiveFeed } from '@/features/live-feed'
import { StatusPanel } from '@/features/status'
import { ClimateChart, GasChart, ReadingTiles, SoundChart, toSeries } from '@/features/telemetry'
import type { Alert } from '@/shared/contract'

type Intrusion = Extract<Alert, { kind: 'intrusion' }>

// The Operator's screen: the Outpost now (Status, Readings, camera, Alerts), what to do about it
// (Alarm control), and what it has been through (threats, Incidents, Alert log).
export function OperatorRoute() {
  const connection = useLiveFeed((state) => state.connection)
  const status = useLiveFeed((state) => state.status)
  const telemetry = useLiveFeed((state) => state.latestTelemetry)
  const activeAlerts = useLiveFeed((state) => state.activeAlerts)
  const history = useLiveFeed((state) => state.history)

  const series = useMemo(() => toSeries(history), [history])
  const intrusion = useMemo(
    () => activeAlerts.find((alert): alert is Intrusion => alert.kind === 'intrusion') ?? null,
    [activeAlerts],
  )
  // Every Alert changes the active ones: the Incidents are fetched again a moment later.
  const { incidents, failed } = useIncidents(activeAlerts)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
      <AlertToasts alerts={activeAlerts} />

      <StatusPanel
        status={status}
        feed={connection}
        activeAlerts={activeAlerts.length}
        className="md:col-span-2 xl:col-span-4"
      />
      <div className="grid grid-cols-2 gap-4 md:col-span-2 lg:grid-cols-4 xl:col-span-8">
        <ReadingTiles telemetry={telemetry} series={series} />
      </div>

      <GasChart series={series} className="md:col-span-2 xl:col-span-7" />
      <CameraPanel intrusion={intrusion} className="md:col-span-2 xl:col-span-5 xl:row-span-2" />
      <ClimateChart series={series} className="xl:col-span-4" />
      <SoundChart series={series} className="xl:col-span-3" />

      <ActiveAlerts alerts={activeAlerts} className="md:col-span-1 xl:col-span-4" />
      <ActuatorPanel sentinel={telemetry?.sentinel ?? null} className="md:col-span-1 xl:col-span-3" />
      <ThreatOverview incidents={incidents} failed={failed} className="md:col-span-2 xl:col-span-5" />

      <AlertLog history={history} className="md:col-span-2 xl:col-span-7" />
      <IncidentTable incidents={incidents} className="md:col-span-2 xl:col-span-5" />
    </div>
  )
}
