import { useMemo } from 'react'
import type { Incident } from '@/shared/contract'
import { clock, duration } from '@/shared/lib/format'
import { KIND_LABEL, SEVERITY_LABEL } from '@/shared/lib/labels'
import { toneOfSeverity, toneSurface } from '@/shared/lib/tone'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { latestFirst } from '../utils/summary'

const SHOWN = 8

// The latest Incidents: when, how long, what it involved and how bad it got.
export function IncidentTable({ incidents, className }: { incidents: readonly Incident[] | null; className?: string }) {
  const rows = useMemo(() => latestFirst(incidents ?? [], SHOWN), [incidents])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Latest Incidents</CardTitle>
        <CardDescription>From the first Alert until every Alert cleared</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No Incident recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Involved</TableHead>
                <TableHead>Peak</TableHead>
                <TableHead className="text-right">Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((incident) => (
                <TableRow key={incident.incident_id}>
                  <TableCell className="text-muted-foreground tabular-nums">{incident.incident_id}</TableCell>
                  <TableCell className="tabular-nums">{clock(incident.start)}</TableCell>
                  <TableCell className="max-w-48 truncate">{incident.kinds.map((kind) => KIND_LABEL[kind]).join(', ')}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={toneSurface[toneOfSeverity[incident.peak]]}>
                      {SEVERITY_LABEL[incident.peak]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {incident.end === null ? (
                      <span className="text-critical">Under way</span>
                    ) : (
                      <span className="text-nominal">
                        Neutralized in {duration(Date.parse(incident.end) - Date.parse(incident.start))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
