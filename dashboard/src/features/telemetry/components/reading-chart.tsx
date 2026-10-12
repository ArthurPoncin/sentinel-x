import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { clock } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
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

// One end of the scale: a value, the curve's own, or one worked out from the curve's.
type Bound = number | 'auto' | ((value: number) => number)

interface ReadingCurveProps {
  series: readonly ReadingPoint[]
  lines: readonly ReadingLine[]
  domain?: [Bound, Bound]
  // How tall the curve is: a card's by default, less where what frames it is smaller.
  className?: string
}

interface ReadingChartProps extends ReadingCurveProps {
  title: string
  description: string
}

// One live curve with no card around it, for what brings its own frame. No animation: a snapshot a second would
// keep the curve forever in motion.
export function ReadingCurve({ series, lines, domain = ['auto', 'auto'], className = 'h-[220px]' }: ReadingCurveProps) {
  const config = Object.fromEntries(lines.map(({ key, label, color }) => [key, { label, color }])) satisfies ChartConfig

  if (series.length === 0) {
    return (
      <div className={cn('flex items-center justify-center text-sm text-muted-foreground', className)}>
        En attente des premières mesures…
      </div>
    )
  }

  return (
    <ChartContainer config={config} className={cn('aspect-auto w-full', className)}>
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
  )
}

// One live curve as a card of the Operator's screen.
export function ReadingChart({ title, description, className, ...curve }: ReadingChartProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-6">
        <ReadingCurve {...curve} />
      </CardContent>
    </Card>
  )
}
