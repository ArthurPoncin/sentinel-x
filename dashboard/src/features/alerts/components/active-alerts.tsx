import { CircleCheck } from 'lucide-react'
import { useMemo } from 'react'
import type { Alert } from '@/shared/contract'
import { clock } from '@/shared/lib/format'
import { toneDot, toneOfSeverity } from '@/shared/lib/tone'
import { cn } from '@/shared/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { byUrgency, describeAlert, KIND_LABEL, SOURCE_LABEL } from '../utils/describe'
import { SeverityBadge } from './severity-badge'

// What is going on right now: the Alerts raised and not cleared yet.
export function ActiveAlerts({ alerts, className }: { alerts: readonly Alert[]; className?: string }) {
  const sorted = useMemo(() => byUrgency(alerts), [alerts])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Active Alerts</CardTitle>
        <CardDescription>
          {sorted.length === 0 ? 'Nothing under way' : `${sorted.length} under way, the most severe first`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <CircleCheck className="size-5 text-nominal" />
            The Outpost is quiet.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((alert) => (
              <li key={alert.alert_id} className="flex items-center gap-3 rounded-lg border bg-background/40 p-3">
                <span
                  className={cn('size-2.5 shrink-0 rounded-full', toneDot[toneOfSeverity[alert.severity]], alert.severity === 'critical' && 'animate-pulse')}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{KIND_LABEL[alert.kind]}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {describeAlert(alert)} · {SOURCE_LABEL[alert.source]} · since {clock(alert.ts)}
                  </p>
                </div>
                <SeverityBadge severity={alert.severity} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
