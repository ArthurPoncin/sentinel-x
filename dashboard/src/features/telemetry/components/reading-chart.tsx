import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { clock } from '@/shared/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/shared/ui/chart'
import type { ReadingPoint, TrendKey } from '../utils/series'

export interface ReadingLine {
  key: TrendKey
  label: string
  color: string
  // A second curve on the same chart stays a plain line, so its fill does not hide the first.
  fill?: boolean
}

interface ReadingChartProps {
  title: string
  description: string
  series: readonly ReadingPoint[]
  lines: readonly ReadingLine[]
  domain?: [number | 'auto', number | 'auto']
  className?: string
}

// One live curve card. No animation: a snapshot a second would keep the curve forever in motion.
export function ReadingChart({ title, description, series, lines, domain = ['auto', 'auto'], className }: ReadingChartProps) {
  const config = Object.fromEntries(lines.map(({ key, label, color }) => [key, { label, color }])) satisfies ChartConfig

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-6">
        {series.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            En attente des premières mesures…
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
            <AreaChart data={series as ReadingPoint[]} margin={{ left: 0, right: 8, top: 4 }}>
              <defs>
                {lines.map(({ key }) => (
                  <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.1} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={clock}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={48}
              />
              <YAxis domain={domain} tickLine={false} axisLine={false} tickMargin={8} width={40} />
              <ChartTooltip
                content={<ChartTooltipContent indicator="line" labelFormatter={(_, [point]) => clock(point?.payload.time)} />}
              />
              {lines.map(({ key, fill = true }) => (
                <Area
                  key={key}
                  dataKey={key}
                  type="monotone"
                  stroke={`var(--color-${key})`}
                  strokeWidth={2}
                  fill={fill ? `url(#fill-${key})` : 'none'}
                  isAnimationActive={false}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
