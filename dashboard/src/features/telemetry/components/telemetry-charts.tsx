import type { ReadingPoint } from '../utils/series'
import { ReadingChart } from './reading-chart'

interface ChartProps {
  series: readonly ReadingPoint[]
  className?: string
}

export function GasChart({ series, className }: ChartProps) {
  return (
    <ReadingChart
      className={className}
      title="Gaz"
      description="Sonde MQ-2 · 5 dernières minutes"
      series={series}
      lines={[{ key: 'air', label: 'Gaz', color: 'var(--chart-1)' }]}
      domain={[0, 'auto']}
    />
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
        { key: 'temp', label: 'Température (°C)', color: 'var(--chart-5)' },
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
