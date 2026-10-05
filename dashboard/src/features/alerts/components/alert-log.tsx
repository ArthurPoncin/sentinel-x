import { useMemo } from 'react'
import type { Frame } from '@/shared/contract'
import { clock } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { alertLog } from '../utils/alert-log'
import { describeAlert, KIND_LABEL, SOURCE_LABEL } from '../utils/describe'
import { SeverityBadge } from './severity-badge'

// The Alert transitions of the live feed, the latest first.
export function AlertLog({ history, className }: { history: readonly Frame[]; className?: string }) {
  const entries = useMemo(() => alertLog(history), [history])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Alert log</CardTitle>
        <CardDescription>Every change of state since this screen opened, the latest first</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No Alert yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead className="hidden md:table-cell">Detail</TableHead>
                  <TableHead className="hidden sm:table-cell">Source</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead className="text-right">State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((alert) => (
                  <TableRow key={`${alert.alert_id}-${alert.state}-${alert.ts}`}>
                    <TableCell className="tabular-nums text-muted-foreground">{clock(alert.ts)}</TableCell>
                    <TableCell className="font-medium">{KIND_LABEL[alert.kind]}</TableCell>
                    <TableCell className="hidden max-w-64 truncate text-muted-foreground md:table-cell">
                      {describeAlert(alert)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{SOURCE_LABEL[alert.source]}</TableCell>
                    <TableCell>
                      <SeverityBadge severity={alert.severity} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={alert.state === 'raised' ? 'secondary' : 'outline'}>
                        {alert.state === 'raised' ? 'Raised' : 'Cleared'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
