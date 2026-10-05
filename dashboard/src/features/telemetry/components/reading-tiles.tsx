import { Droplets, Flame, Footprints, type LucideIcon, Thermometer } from 'lucide-react'
import { useMemo } from 'react'
import type { Telemetry } from '@/shared/contract'
import { cn } from '@/shared/lib/utils'
import { Card, CardContent } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { type ReadingPoint, trend, type TrendKey } from '../utils/series'

interface TileProps {
  icon: LucideIcon
  label: string
  value: string
  // A line under the value, e.g. how fast it moved.
  note?: string | null
  highlight?: boolean
}

function Tile({ icon: Icon, label, value, note, highlight }: TileProps) {
  return (
    <Card className={cn('gap-2 py-4', highlight && 'border-elevated/50 bg-elevated/10')}>
      <CardContent className="flex items-start justify-between gap-2 px-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          {note && <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{note}</p>}
        </div>
        <Icon className={cn('size-5 shrink-0 text-muted-foreground', highlight && 'text-elevated')} />
      </CardContent>
    </Card>
  )
}

const signed = (value: number, decimals: number, unit = '') =>
  `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}${unit} over 30 s`

interface ReadingTilesProps {
  telemetry: Telemetry | null
  series: readonly ReadingPoint[]
}

// The latest Readings, with how fast each one moves: a slow climb shows before any threshold.
export function ReadingTiles({ telemetry, series }: ReadingTilesProps) {
  const deltas = useMemo(() => {
    const of = (key: TrendKey, decimals: number, unit?: string) => {
      const change = trend(series, key)
      return change === null ? null : signed(change, decimals, unit)
    }
    return { temp: of('temp', 1, ' °C'), humidity: of('humidity', 0, ' %'), air: of('air', 0) }
  }, [series])

  if (!telemetry) {
    return (
      <>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[104px] rounded-xl" />
        ))}
      </>
    )
  }

  const { temp, humidity, air, pir, sound } = telemetry.readings
  return (
    <>
      <Tile icon={Thermometer} label="Temperature" value={`${temp.toFixed(1)} °C`} note={deltas.temp} />
      <Tile icon={Droplets} label="Humidity" value={`${humidity.toFixed(0)} %`} note={deltas.humidity} />
      <Tile icon={Flame} label="Gas (air)" value={`${air}`} note={deltas.air} />
      <Tile
        icon={Footprints}
        label="Presence"
        value={pir ? 'Motion' : 'Clear'}
        note={`Noise ${Math.round(sound * 100)} % of the cycle`}
        highlight={pir}
      />
    </>
  )
}
