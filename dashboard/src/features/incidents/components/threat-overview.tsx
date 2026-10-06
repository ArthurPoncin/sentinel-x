import { useMemo } from 'react'
import { Bar, BarChart, XAxis, YAxis } from 'recharts'
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
    <div className="flex flex-col gap-1 border-l px-4 first:border-l-0 first:pl-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-2xl font-semibold tabular-nums', className)}>{value}</span>
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
        <CardTitle>Menaces</CardTitle>
        <CardDescription>
          {failed ? 'Historique injoignable, derniers chiffres reçus' : 'Tous les incidents enregistrés'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {!summary ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-4">
              <Stat label="Incidents" value={summary.total} />
              <Stat label="Neutralisés" value={summary.resolved} />
              <Stat label="En cours" value={summary.ongoing} className={summary.ongoing > 0 ? 'text-critical' : undefined} />
              <Stat
                label="Retour au nominal"
                value={summary.meanResolutionMs === null ? '—' : duration(summary.meanResolutionMs)}
              />
            </div>
            {bars.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Aucun incident enregistré.</p>
            ) : (
              <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: 32 * bars.length + 8 }}>
                <BarChart data={bars} layout="vertical" margin={{ left: 0, right: 16 }}>
                  <XAxis type="number" dataKey="incidents" domain={[0, 'dataMax']} hide />
                  <YAxis dataKey="kind" type="category" tickLine={false} axisLine={false} tickMargin={8} width={110} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="incidents" fill="var(--color-incidents)" radius={5} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
