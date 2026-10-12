import type { ReadingPoint } from '../utils/series'
import { ReadingChart, ReadingCurve, type ReadingLine } from './reading-chart'

interface ChartProps {
  series: readonly ReadingPoint[]
  className?: string
}

// A curve with no card: shorter than a card's, and shorter still where its frame runs out of room.
const CURVE = 'h-[150px] min-h-[96px] shrink'
const GAS: ReadingLine = { key: 'air', label: 'Gaz', color: 'var(--chart-1)' }
const TEMPERATURE: ReadingLine = { key: 'temp', label: 'Température (°C)', color: 'var(--chart-5)' }

export function GasChart({ series, className }: ChartProps) {
  return (
    <ReadingChart
      className={className}
      title="Gaz"
      description="Sonde MQ-2 · 5 dernières minutes"
      series={series}
      lines={[GAS]}
      domain={[0, 'auto']}
    />
  )
}

// The gas curve alone, with what it reads under it: for a glass window of the Twin, which is its frame.
export function GasCurve({ series }: { series: readonly ReadingPoint[] }) {
  return (
    <div className="flex flex-col gap-1">
      <ReadingCurve className={CURVE} series={series} lines={[GAS]} domain={[0, 'auto']} />
      <p className="text-xs text-muted-foreground">Sonde MQ-2 · 5 dernières minutes</p>
    </div>
  )
}

// The temperature curve alone, the same way.
export function TemperatureCurve({ series }: { series: readonly ReadingPoint[] }) {
  return (
    <div className="flex flex-col gap-1">
      {/* Whole degrees at both ends: over a few seconds the curve moves by hundredths, which the scale has no
          room to print. */}
      <ReadingCurve className={CURVE} series={series} lines={[TEMPERATURE]} domain={[Math.floor, Math.ceil]} />
      <p className="text-xs text-muted-foreground">Sonde DHT22 · °C · 5 dernières minutes</p>
    </div>
  )
}

export function ClimateChart({ series, className }: ChartProps) {
  return (
    <ReadingChart
      className={className}
      title="Température et humidité"
      description="Sonde DHT22 · °C et %"
      series={series}
      lines={[
        TEMPERATURE,
        { key: 'humidity', label: 'Humidité (%)', color: 'var(--chart-2)', fill: false },
      ]}
    />
  )
}

export function SoundChart({ series, className }: ChartProps) {
  return (
    <ReadingChart
      className={className}
      title="Bruit"
      description="Part du cycle où la sonde a capté du son"
      series={series}
      lines={[{ key: 'sound', label: 'Son', color: 'var(--chart-4)' }]}
      domain={[0, 1]}
    />
  )
}
