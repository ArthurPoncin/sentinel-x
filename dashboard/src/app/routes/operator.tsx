import { useMemo } from 'react'
import { ActuatorPanel } from '@/features/actuators'
import { ActiveAlerts, AlertLog, AlertToasts } from '@/features/alerts'
import { CameraPanel } from '@/features/camera'
import { IncidentTable, ThreatOverview, useIncidents } from '@/features/incidents'
import { useLiveFeed } from '@/features/live-feed'
import { StatusCard } from '@/features/status'
import { ClimateChart, GasChart, ReadingTiles, SoundChart, toSeries } from '@/features/telemetry'
import type { Alert } from '@/shared/contract'
import { Badge } from '@/shared/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

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
    <div className="flex flex-col gap-4 lg:gap-6">
      <AlertToasts alerts={activeAlerts} />

      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs sm:grid-cols-2 xl:grid-cols-5">
        <StatusCard status={status} feed={connection} activeAlerts={activeAlerts.length} />
        <ReadingTiles telemetry={telemetry} series={series} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <GasChart series={series} className="lg:col-span-2" />
        <CameraPanel intrusion={intrusion} />
        <ClimateChart series={series} />
        <SoundChart series={series} />
        <ActuatorPanel sentinel={telemetry?.sentinel ?? null} />
        <ActiveAlerts alerts={activeAlerts} />
        <ThreatOverview incidents={incidents} failed={failed} className="lg:col-span-2" />
      </div>

      <Tabs defaultValue="alerts" className="gap-4">
        <TabsList>
          <TabsTrigger value="alerts">Journal des alertes</TabsTrigger>
          <TabsTrigger value="incidents">
            Incidents
            {incidents && incidents.length > 0 && <Badge variant="secondary">{incidents.length}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="alerts">
          <AlertLog history={history} />
        </TabsContent>
        <TabsContent value="incidents">
          <IncidentTable incidents={incidents} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
