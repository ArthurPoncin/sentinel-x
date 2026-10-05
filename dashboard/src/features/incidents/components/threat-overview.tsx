import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { Incident } from '@/shared/contract'
import { duration } from '@/shared/lib/format'
import { KIND_LABEL } from '@/shared/lib/labels'
import { cn } from '@/shared/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/shared/ui/chart'
import { Skeleton } from '@/shared/ui/skeleton'
import { summarize } from '../utils/summary'

const chartConfig = { incidents: { label: 'Incidents', color: 'var(--chart-1)' } } satisfies ChartConfig

function Stat({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', className)}>{value}</p>
    </div>
  )
}

interface ThreatOverviewProps {
  incidents: readonly Incident[] | null
  failed: boolean
  className?: string
}

// The threats the Outpost has faced since the history began, and how many it came back from.
export function ThreatOverview({ incidents, failed, className }: ThreatOverviewProps) {
  const summary = useMemo(() => (incidents ? summarize(incidents) : null), [incidents])
  const bars = useMemo(
    () => summary?.byKind.map(({ kind, incidents }) => ({ kind: KIND_LABEL[kind], incidents })) ?? [],
    [summary],
  )

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Threats</CardTitle>
        <CardDescription>
          {failed ? 'History out of reach, showing the last figures received' : 'Every Incident in the recorded history'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!summary ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Incidents" value={summary.total} />
              <Stat label="Neutralized" value={summary.resolved} className="text-nominal" />
              <Stat label="Under way" value={summary.ongoing} className={summary.ongoing > 0 ? 'text-critical' : undefined} />
              <Stat
                label="Mean time to nominal"
                value={summary.meanResolutionMs === null ? '—' : duration(summary.meanResolutionMs)}
              />
            </div>
            {bars.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No Incident recorded yet.</p>
            ) : (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">Incidents per kind of Alert</p>
                <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: 36 * bars.length + 16 }}>
                  <BarChart data={bars} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" domain={[0, 'dataMax']} allowDecimals={false} hide />
                    <YAxis dataKey="kind" type="category" tickLine={false} axisLine={false} width={110} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Bar dataKey="incidents" fill="var(--color-incidents)" radius={4} isAnimationActive={false} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
