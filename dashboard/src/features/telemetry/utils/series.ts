import type { Frame, Telemetry } from '@/shared/contract'

// One point per telemetry snapshot, flat for the charts: time in epoch ms, PIR as 0/1.
export interface ReadingPoint {
  time: number
  temp: number
  humidity: number
  air: number
  sound: number
  pir: 0 | 1
}

// How far back the curves go: a few minutes is what the Operator watches live.
export const WINDOW_MS = 5 * 60_000

function toPoint({ ts, readings }: Telemetry): ReadingPoint {
  return { time: Date.parse(ts), ...readings, pir: readings.pir ? 1 : 0 }
}

// The telemetry of the live history within `windowMs` of the latest snapshot, oldest first.
export function toSeries(history: readonly Frame[], windowMs = WINDOW_MS): ReadingPoint[] {
  const points = history.flatMap((frame) => (frame.type === 'telemetry' ? [toPoint(frame.payload)] : []))
  const latest = points.at(-1)
  if (!latest) return []
  return points.filter((point) => point.time >= latest.time - windowMs)
}

export type TrendKey = 'temp' | 'humidity' | 'air' | 'sound'

// Change of a Reading over the last `spanMs`: the latest point against the oldest one still within
// the span. Null until the span holds two points.
export function trend(series: readonly ReadingPoint[], key: TrendKey, spanMs = 30_000): number | null {
  const latest = series.at(-1)
  if (!latest) return null
  const from = series.find((point) => point.time >= latest.time - spanMs)
  if (!from || from === latest) return null
  return latest[key] - from[key]
}
