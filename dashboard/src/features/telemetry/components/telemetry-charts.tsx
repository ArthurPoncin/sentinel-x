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
      title="Gas"
      description="MQ-2 air Reading, last 5 minutes"
      series={series}
      lines={[{ key: 'air', label: 'Air', color: 'var(--chart-1)' }]}
      domain={[0, 'auto']}
    />
  )
}

export function ClimateChart({ series, className }: ChartProps) {
  return (
    <ReadingChart
      className={className}
      title="Temperature & humidity"
      description="DHT22, °C and %"
      series={series}
      lines={[
        { key: 'temp', label: 'Temperature (°C)', color: 'var(--chart-3)' },
        { key: 'humidity', label: 'Humidity (%)', color: 'var(--chart-2)', fill: false },
      ]}
    />
  )
}

export function SoundChart({ series, className }: ChartProps) {
  return (
    <ReadingChart
      className={className}
      title="Noise"
      description="Share of the cycle the sound Probe heard sound"
      series={series}
      lines={[{ key: 'sound', label: 'Sound', color: 'var(--chart-4)' }]}
      domain={[0, 1]}
    />
  )
}
