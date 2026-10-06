import { useMemo } from 'react'
import type { Alert } from '@/shared/contract'
import { clock } from '@/shared/lib/format'
import { plural } from '@/shared/lib/labels'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { byUrgency, describeAlert, KIND_LABEL, SOURCE_LABEL } from '../utils/describe'
import { SeverityBadge } from './severity-badge'

// What is going on right now: the Alerts raised and not cleared yet.
export function ActiveAlerts({ alerts, className }: { alerts: readonly Alert[]; className?: string }) {
  const sorted = useMemo(() => byUrgency(alerts), [alerts])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Alertes actives</CardTitle>
        <CardDescription>
          {sorted.length === 0 ? 'Aucune alerte en cours' : `${plural(sorted.length, 'alerte')} en cours, la plus grave en tête`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Rien à signaler.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {sorted.map((alert) => (
              <li key={alert.alert_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{KIND_LABEL[alert.kind]}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {describeAlert(alert)} · {SOURCE_LABEL[alert.source]} · depuis {clock(alert.ts)}
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
