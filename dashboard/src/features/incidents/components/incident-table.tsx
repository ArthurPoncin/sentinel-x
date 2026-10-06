import { CircleCheck, Loader } from 'lucide-react'
import { useMemo } from 'react'
import { LevelBadge } from '@/shared/components/level-badge'
import type { Incident } from '@/shared/contract'
import { clock, duration } from '@/shared/lib/format'
import { KIND_LABEL, SEVERITY_LABEL } from '@/shared/lib/labels'
import { toneOfSeverity } from '@/shared/lib/tone'
import { Badge } from '@/shared/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { latestFirst } from '../utils/summary'

const SHOWN = 20

// The latest Incidents: when, how long, what they involved and how bad they got. A bare table:
// the page frames it.
export function IncidentTable({ incidents }: { incidents: readonly Incident[] | null }) {
  const rows = useMemo(() => latestFirst(incidents ?? [], SHOWN), [incidents])

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Aucun incident enregistré.</p>
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead className="pl-4">N°</TableHead>
            <TableHead>Début</TableHead>
            <TableHead>Alertes en cause</TableHead>
            <TableHead>Pic</TableHead>
            <TableHead className="pr-4 text-right">Issue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((incident) => (
            <TableRow key={incident.incident_id}>
              <TableCell className="pl-4 text-muted-foreground tabular-nums">{incident.incident_id}</TableCell>
              <TableCell className="tabular-nums">{clock(incident.start)}</TableCell>
              <TableCell className="max-w-80 truncate">{incident.kinds.map((kind) => KIND_LABEL[kind]).join(', ')}</TableCell>
              <TableCell>
                <LevelBadge tone={toneOfSeverity[incident.peak]}>{SEVERITY_LABEL[incident.peak]}</LevelBadge>
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Badge variant="outline" className="text-muted-foreground">
                  {incident.end === null ? (
                    <>
                      <Loader />
                      En cours
                    </>
                  ) : (
                    <>
                      <CircleCheck className="fill-nominal text-background" />
                      Neutralisé en {duration(Date.parse(incident.end) - Date.parse(incident.start))}
                    </>
                  )}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
