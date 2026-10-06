import { useMemo } from 'react'
import type { Frame } from '@/shared/contract'
import { clock } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { alertLog } from '../utils/alert-log'
import { describeAlert, KIND_LABEL, SOURCE_LABEL } from '../utils/describe'
import { SeverityBadge } from './severity-badge'

// The Alert transitions of the live feed, the latest first. A bare table: the page frames it.
export function AlertLog({ history }: { history: readonly Frame[] }) {
  const entries = useMemo(() => alertLog(history), [history])

  if (entries.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Aucune alerte depuis l'ouverture de cet écran.</p>
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead className="pl-4">Heure</TableHead>
            <TableHead>Alerte</TableHead>
            <TableHead className="hidden md:table-cell">Détail</TableHead>
            <TableHead className="hidden sm:table-cell">Source</TableHead>
            <TableHead>Gravité</TableHead>
            <TableHead className="pr-4 text-right">État</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((alert) => (
            <TableRow key={`${alert.alert_id}-${alert.state}-${alert.ts}`}>
              <TableCell className="pl-4 text-muted-foreground tabular-nums">{clock(alert.ts)}</TableCell>
              <TableCell className="font-medium">{KIND_LABEL[alert.kind]}</TableCell>
              <TableCell className="hidden max-w-72 truncate text-muted-foreground md:table-cell">{describeAlert(alert)}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{SOURCE_LABEL[alert.source]}</TableCell>
              <TableCell>
                <SeverityBadge severity={alert.severity} />
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Badge variant={alert.state === 'raised' ? 'secondary' : 'outline'} className="text-muted-foreground">
                  {alert.state === 'raised' ? 'Levée' : 'Résolue'}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
