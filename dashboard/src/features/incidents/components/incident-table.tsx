import { useMemo, useState } from 'react'
import { LevelBadge } from '@/shared/components/level-badge'
import { Pager, SortByTime } from '@/shared/components/table-paging'
import type { Incident } from '@/shared/contract'
import { clock, duration } from '@/shared/lib/format'
import { KIND_LABEL, SEVERITY_LABEL } from '@/shared/lib/labels'
import { inOrder, paginate, type SortOrder } from '@/shared/lib/paging'
import { toneOfSeverity } from '@/shared/lib/tone'
import { Badge } from '@/shared/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { latestFirst } from '../utils/summary'

function outcome(incident: Incident): string {
  return incident.end === null
    ? 'En cours'
    : `Neutralisé en ${duration(Date.parse(incident.end) - Date.parse(incident.start))}`
}

// Every Incident, ten to a page, newest or oldest first: when, how long, what they involved and how bad they
// got. A bare table: the page frames it.
export function IncidentTable({ incidents }: { incidents: readonly Incident[] | null }) {
  const [order, setOrder] = useState<SortOrder>('desc')
  const [pageNumber, setPageNumber] = useState(1)
  const sorted = useMemo(() => inOrder(latestFirst(incidents ?? [], Infinity), order), [incidents, order])
  const page = paginate(sorted, pageNumber)
  const rows = page.rows
  const changeOrder = (next: SortOrder) => {
    setOrder(next)
    setPageNumber(1)
  }

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Aucun incident enregistré.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="hidden pl-4 sm:table-cell">N°</TableHead>
              <TableHead className="pl-4 sm:pl-2" aria-sort={order === 'desc' ? 'descending' : 'ascending'}>
                <SortByTime order={order} onChange={changeOrder}>
                  Début
                </SortByTime>
              </TableHead>
              <TableHead>Alertes en cause</TableHead>
              <TableHead>Pic</TableHead>
              <TableHead className="hidden pr-4 text-right sm:table-cell">Issue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((incident) => (
              <TableRow key={incident.incident_id}>
                <TableCell className="hidden pl-4 text-muted-foreground tabular-nums sm:table-cell">{incident.incident_id}</TableCell>
                <TableCell className="pl-4 align-top tabular-nums sm:pl-2 sm:align-middle">
                  {clock(incident.start)}
                  {/* On a phone the outcome column gives way: the outcome goes under the start. */}
                  <span className="block text-xs text-muted-foreground sm:hidden">{outcome(incident)}</span>
                </TableCell>
                {/* On a phone the kinds wrap rather than push the peak off the screen. */}
                <TableCell className="min-w-32 whitespace-normal sm:max-w-80 sm:truncate sm:whitespace-nowrap">
                  {incident.kinds.map((kind) => KIND_LABEL[kind]).join(', ')}
                </TableCell>
                <TableCell className="pr-4 sm:pr-2">
                  <LevelBadge tone={toneOfSeverity[incident.peak]}>{SEVERITY_LABEL[incident.peak]}</LevelBadge>
                </TableCell>
                <TableCell className="hidden pr-4 text-right sm:table-cell">
                  <Badge variant="outline" className="text-muted-foreground">
                    {incident.end === null ? (
                      <>
                        <span aria-hidden className="animate-pulse text-elevated">
                          ●
                        </span>
                        {outcome(incident)}
                      </>
                    ) : (
                      <>
                        <span aria-hidden className="text-nominal">
                          ●
                        </span>
                        {outcome(incident)}
                      </>
                    )}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pager page={page} onChange={setPageNumber} noun="incident" />
    </div>
  )
}
