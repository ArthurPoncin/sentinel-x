import { describe, expect, it } from 'vitest'
import { FrameSchema } from '../src/contract.js'

// The examples of docs/ARCHITECTURE.md, verbatim.
const telemetry = {
  sentinel: 'sentinel-01',
  ts: '2026-10-05T14:23:00Z',
  readings: {
    temp: 31.2,
    humidity: 44.0,
    air: 180,
    pir: false,
    accel: { x: 0.01, y: -0.02, z: 0.98 },
  },
}

describe('contract', () => {
  it('accepts the documented telemetry frame', () => {
    const frame = { type: 'telemetry', payload: telemetry }

    expect(FrameSchema.parse(frame)).toEqual(frame)
  })

  it('accepts the documented status frame', () => {
    const frame = { type: 'status', payload: { status: 'elevated', ts: '2026-10-05T14:23:05Z' } }

    expect(FrameSchema.parse(frame)).toEqual(frame)
  })

  it('rejects a status outside nominal / elevated / critical', () => {
    const frame = { type: 'status', payload: { status: 'warning', ts: '2026-10-05T14:23:05Z' } }

    expect(FrameSchema.safeParse(frame).success).toBe(false)
  })

  it('rejects a telemetry frame with a missing reading', () => {
    const { air: _air, ...readings } = telemetry.readings
    const frame = { type: 'telemetry', payload: { ...telemetry, readings } }

    expect(FrameSchema.safeParse(frame).success).toBe(false)
  })

  it('rejects a field the contract does not define', () => {
    const frame = { type: 'telemetry', payload: { ...telemetry, firmware: '1.0.0' } }

    expect(FrameSchema.safeParse(frame).success).toBe(false)
  })

  it('rejects a timestamp that is not ISO 8601', () => {
    const frame = { type: 'telemetry', payload: { ...telemetry, ts: '05/10/2026 14:23' } }

    expect(FrameSchema.safeParse(frame).success).toBe(false)
  })

  it('rejects an unknown frame type', () => {
    expect(FrameSchema.safeParse({ type: 'heartbeat', payload: {} }).success).toBe(false)
  })
})
