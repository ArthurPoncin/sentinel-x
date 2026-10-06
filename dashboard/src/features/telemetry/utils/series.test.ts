import { describe, expect, it } from 'vitest'
import type { Frame } from '@/shared/contract'
import { toSeries, trend } from './series'

const at = (second: number) => new Date(Date.UTC(2026, 9, 5, 14, 0, second)).toISOString()

function telemetry(second: number, air: number, pir = false): Frame {
  return {
    type: 'telemetry',
    payload: { sentinel: 'sentinel-01', ts: at(second), readings: { temp: 31, humidity: 44, air, pir, sound: 0.02 } },
  }
}

const status: Frame = { type: 'status', payload: { status: 'elevated', ts: at(0) } }

describe('toSeries', () => {
  it('keeps one point per telemetry snapshot, oldest first, and skips the other frames', () => {
    const series = toSeries([telemetry(0, 180), status, telemetry(1, 320, true)])

    expect(series).toEqual([
      { time: Date.parse(at(0)), temp: 31, humidity: 44, air: 180, sound: 0.02, pir: 0 },
      { time: Date.parse(at(1)), temp: 31, humidity: 44, air: 320, sound: 0.02, pir: 1 },
    ])
  })

  it('keeps only the window before the latest snapshot', () => {
    const series = toSeries([telemetry(0, 1), telemetry(10, 2), telemetry(20, 3)], 10_000)

    expect(series.map((point) => point.air)).toEqual([2, 3])
  })

  it('is empty before any telemetry', () => {
    expect(toSeries([status])).toEqual([])
  })
})

describe('trend', () => {
  it('compares the latest Reading with the oldest one within the span', () => {
    const series = toSeries([telemetry(0, 100), telemetry(20, 180), telemetry(40, 420)])

    expect(trend(series, 'air', 30_000)).toBe(240)
  })

  it('is null until there are two points to compare', () => {
    expect(trend(toSeries([telemetry(0, 180)]), 'air')).toBeNull()
    expect(trend([], 'air')).toBeNull()
  })
})
