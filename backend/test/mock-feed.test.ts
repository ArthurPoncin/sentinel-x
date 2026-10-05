import { describe, expect, it } from 'vitest'
import { type Frame, FrameSchema, type StatusLevel } from '../src/contract.js'
import { mockTicks } from '../src/mock-feed.js'

// Enough ticks to play the scenario several times over.
function firstTicks(count = 100): Frame[][] {
  const ticks: Frame[][] = []
  for (const tick of mockTicks()) {
    ticks.push(tick)
    if (ticks.length === count) break
  }
  return ticks
}

describe('mock feed script', () => {
  it('walks the Status from nominal to elevated, critical and back to nominal, in a loop', () => {
    const statuses = firstTicks()
      .flat()
      .flatMap((frame) => (frame.type === 'status' ? [frame.payload.status] : []))

    expect(statuses.slice(0, 6)).toEqual(['elevated', 'critical', 'nominal', 'elevated', 'critical', 'nominal'])
  })

  it('raises the gas reading as the Status worsens', () => {
    const air: Record<StatusLevel, number[]> = { nominal: [], elevated: [], critical: [] }
    let status: StatusLevel = 'nominal'
    for (const tick of firstTicks()) {
      for (const frame of tick) if (frame.type === 'status') status = frame.payload.status
      for (const frame of tick) if (frame.type === 'telemetry') air[status].push(frame.payload.readings.air)
    }

    expect(Math.max(...air.nominal)).toBeLessThan(Math.min(...air.elevated))
    expect(Math.max(...air.elevated)).toBeLessThan(Math.min(...air.critical))
  })

  it('emits one telemetry snapshot per tick', () => {
    for (const tick of firstTicks()) {
      expect(tick.filter((frame) => frame.type === 'telemetry')).toHaveLength(1)
    }
  })

  it('only emits frames that validate against the contract', () => {
    for (const frame of firstTicks().flat()) {
      expect(FrameSchema.safeParse(frame)).toMatchObject({ success: true })
    }
  })
})
