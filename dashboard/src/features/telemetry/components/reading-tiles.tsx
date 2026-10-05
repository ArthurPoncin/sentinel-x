import { TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import type { Telemetry } from '@/shared/contract'
import { decimal } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { type ReadingPoint, trend, type TrendKey } from '../utils/series'

interface TileProps {
  label: string
  value: string
  // Change over the last 30 s, already formatted with its sign, or null while unknown. Shown
  // only when the Reading moved.
  change?: { text: string; rising: boolean; moving: boolean } | null
  headline: string
  detail: string
}

function Tile({ label, value, change, headline, detail }: TileProps) {
  const Trend = change?.rising ? TrendingUp : TrendingDown
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {change?.moving && (
          <CardAction>
            <Badge variant="outline">
              <Trend />
              {change.text}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 font-medium">{headline}</div>
        <div className="text-muted-foreground">{detail}</div>
      </CardFooter>
    </Card>
  )
}

const STEADY = 'Stable sur 30 s'

interface ReadingTilesProps {
  telemetry: Telemetry | null
  series: readonly ReadingPoint[]
}

// The latest Readings, with how fast each one moves: a slow climb shows before any threshold.
export function ReadingTiles({ telemetry, series }: ReadingTilesProps) {
  const changes = useMemo(() => {
    const of = (key: TrendKey, digits: number, unit = '') => {
      const change = trend(series, key)
      if (change === null) return null
      return { text: `${change >= 0 ? '+' : ''}${decimal(change, digits)}${unit}`, rising: change >= 0, moving: Math.abs(change) >= 10 ** -digits }
    }
    return { temp: of('temp', 1, ' °C'), humidity: of('humidity', 0, ' %'), air: of('air', 0) }
  }, [series])

  if (!telemetry) {
    return Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[150px] rounded-xl" />)
  }

  const { temp, humidity, air, pir, sound } = telemetry.readings
  const headline = (change: { rising: boolean; moving: boolean } | null, up: string, down: string) =>
    !change?.moving ? STEADY : change.rising ? up : down

  return (
    <>
      <Tile
        label="Température"
        value={`${decimal(temp, 1)} °C`}
        change={changes.temp}
        headline={headline(changes.temp, 'En hausse sur 30 s', 'En baisse sur 30 s')}
        detail="Sonde DHT22"
      />
      <Tile
        label="Humidité"
        value={`${decimal(humidity, 0)} %`}
        change={changes.humidity}
        headline={headline(changes.humidity, 'En hausse sur 30 s', 'En baisse sur 30 s')}
        detail="Sonde DHT22"
      />
      <Tile
        label="Gaz"
        value={`${air}`}
        change={changes.air}
        headline={headline(changes.air, 'Concentration en hausse', 'Concentration en baisse')}
        detail="Sonde MQ-2, valeur brute"
      />
      <Tile
        label="Présence"
        value={pir ? 'Mouvement' : 'Aucune'}
        headline={pir ? 'Le PIR détecte un mouvement' : 'Zone calme'}
        detail={`Bruit : ${Math.round(sound * 100)} % du cycle`}
      />
    </>
  )
}
