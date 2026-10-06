import { useMemo, useState } from 'react'
import { Pager, SortByTime } from '@/shared/components/table-paging'
import type { Frame } from '@/shared/contract'
import { clock } from '@/shared/lib/format'
import { plural } from '@/shared/lib/labels'
import { inOrder, paginate, type SortOrder } from '@/shared/lib/paging'
import { Badge } from '@/shared/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { alertLog } from '../utils/alert-log'
import { describeAlert, KIND_LABEL, SOURCE_LABEL } from '../utils/describe'
import { filterLog, isFiltering, NO_FILTER } from '../utils/log-filter'
import { AlertLogFilters } from './alert-log-filters'
import { SeverityBadge } from './severity-badge'

// The Alert transitions of the live feed under a filter bar, ten to a page, newest or oldest first. A bare
// table: the page frames it.
export function AlertLog({ history }: { history: readonly Frame[] }) {
  const [filter, setFilter] = useState(NO_FILTER)
  const [order, setOrder] = useState<SortOrder>('desc')
  const [pageNumber, setPageNumber] = useState(1)
  const all = useMemo(() => alertLog(history, Infinity), [history])
  const matching = useMemo(() => inOrder(filterLog(all, filter), order), [all, filter, order])
  const page = paginate(matching, pageNumber)
  const entries = page.rows
  // A new filter or order starts again from the first page.
  const changeFilter = (next: typeof filter) => {
    setFilter(next)
    setPageNumber(1)
  }
  const changeOrder = (next: SortOrder) => {
    setOrder(next)
    setPageNumber(1)
  }

  if (all.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Aucune alerte depuis l'ouverture de cet écran.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <AlertLogFilters filter={filter} onChange={changeFilter} />
      {isFiltering(filter) && (
        <p className="text-xs text-muted-foreground">
          {plural(matching.length, 'alerte')} sur {all.length}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">Aucune alerte ne correspond à ces filtres.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="pl-4" aria-sort={order === 'desc' ? 'descending' : 'ascending'}>
                  <SortByTime order={order} onChange={changeOrder}>
                    Heure
                  </SortByTime>
                </TableHead>
                <TableHead>Alerte</TableHead>
                <TableHead className="hidden md:table-cell">Détail</TableHead>
                <TableHead className="hidden sm:table-cell">Source</TableHead>
                <TableHead>Gravité</TableHead>
                <TableHead className="hidden pr-4 text-right sm:table-cell">État</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((alert) => (
                <TableRow key={`${alert.alert_id}-${alert.state}-${alert.ts}`}>
                  <TableCell className="pl-4 text-muted-foreground tabular-nums">{clock(alert.ts)}</TableCell>
                  <TableCell className="font-medium">
                    {KIND_LABEL[alert.kind]}
                    {/* On a phone the state column gives way: the state goes under the Alert's name. */}
                    <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                      {alert.state === 'raised' ? 'Levée' : 'Résolue'}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-72 truncate text-muted-foreground md:table-cell">{describeAlert(alert)}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{SOURCE_LABEL[alert.source]}</TableCell>
                  <TableCell className="pr-4 sm:pr-2">
                    <SeverityBadge severity={alert.severity} />
                  </TableCell>
                  <TableCell className="hidden pr-4 text-right sm:table-cell">
                    <Badge variant={alert.state === 'raised' ? 'secondary' : 'outline'} className="text-muted-foreground">
                      {alert.state === 'raised' ? 'Levée' : 'Résolue'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page} onChange={setPageNumber} noun="alerte" />
    </div>
  )
}
