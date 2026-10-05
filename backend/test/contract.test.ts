import { describe, expect, it } from 'vitest'
import { AlertSchema, CommandRequestSchema, CommandSchema, FrameSchema } from '../src/contract.js'

// The examples of docs/ARCHITECTURE.md, verbatim.
const telemetry = {
  sentinel: 'sentinel-01',
  ts: '2026-10-05T14:23:00Z',
  readings: {
    temp: 31.2,
    humidity: 44.0,
    air: 180,
    pir: false,
    sound: 1350,
  },
}

const alert = {
  alert_id: 'a1b2c3d4',
  sentinel: 'sentinel-01',
  source: 'esp32',
  kind: 'gas',
  severity: 'warning',
  state: 'raised',
  value: 420,
  detail: {},
  ts: '2026-10-05T14:23:05Z',
}

const detailOf = {
  intrusion: { x_norm: 0.42, confidence: 0.88, bbox: [120, 80, 60, 180] },
  predictive: { anomaly_score: 0.91, drivers: ['temp_slope', 'air_slope'] },
}

const command = {
  cmd_id: 'c9f8e7',
  sentinel: 'sentinel-01',
  actuator: 'buzzer',
  action: 'on',
  params: { pattern: 'siren', led: 'red' },
  ts: '2026-10-05T14:23:10Z',
}

describe('contract', () => {
  it('accepts the documented telemetry frame', () => {
    const frame = { type: 'telemetry', payload: telemetry }

    expect(FrameSchema.parse(frame)).toEqual(frame)
  })

  it('accepts the documented alert frame', () => {
    const frame = { type: 'alert', payload: alert }

    expect(FrameSchema.parse(frame)).toEqual(frame)
  })

  it.each(Object.entries(detailOf))('accepts the documented detail of a %s Alert', (kind, detail) => {
    expect(AlertSchema.parse({ ...alert, kind, detail })).toEqual({ ...alert, kind, detail })
  })

  it('accepts an Alert without a triggering value', () => {
    const { value: _value, ...withoutValue } = alert

    expect(AlertSchema.parse(withoutValue)).toEqual(withoutValue)
  })

  it('rejects an Alert carrying the detail of another kind', () => {
    expect(AlertSchema.safeParse({ ...alert, kind: 'gas', detail: detailOf.intrusion }).success).toBe(false)
    expect(AlertSchema.safeParse({ ...alert, kind: 'intrusion', detail: {} }).success).toBe(false)
  })

  it('rejects an intruder placed outside the frame', () => {
    const detail = { ...detailOf.intrusion, x_norm: 1.2 }

    expect(AlertSchema.safeParse({ ...alert, kind: 'intrusion', detail }).success).toBe(false)
  })

  it.each([
    ['kind', 'flood'],
    ['source', 'drone'],
    ['severity', 'elevated'],
    ['state', 'acknowledged'],
  ])('rejects an Alert whose %s is %s', (field, value) => {
    expect(AlertSchema.safeParse({ ...alert, [field]: value }).success).toBe(false)
  })

  it('rejects an Alert without an alert_id', () => {
    const { alert_id: _id, ...withoutId } = alert

    expect(AlertSchema.safeParse(withoutId).success).toBe(false)
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

  it('accepts the documented actuator command', () => {
    expect(CommandSchema.parse(command)).toEqual(command)
  })

  it('accepts a command without params, or with only some of them', () => {
    const { params: _params, ...bare } = command

    expect(CommandSchema.parse(bare)).toEqual(bare)
    expect(CommandSchema.parse({ ...bare, params: { led: 'red' } })).toEqual({ ...bare, params: { led: 'red' } })
  })

  it.each([
    ['actuator', 'laser'],
    ['action', 'toggle'],
    ['ts', '05/10/2026 14:23'],
    ['params', { volume: 11 }],
  ])('rejects a command whose %s is %j', (field, value) => {
    expect(CommandSchema.safeParse({ ...command, [field]: value }).success).toBe(false)
  })

  it.each(['cmd_id', 'sentinel', 'actuator', 'action', 'ts'])('rejects a command without its %s', (field) => {
    expect(CommandSchema.safeParse({ ...command, [field]: undefined }).success).toBe(false)
  })

  it.each(['sentinel-01/actuator', '+', '#', 'sentinel 01', ''])(
    'rejects a command for "%s", which is not one topic level',
    (sentinel) => {
      expect(CommandSchema.safeParse({ ...command, sentinel }).success).toBe(false)
    },
  )

  it('takes the request of the Operator without cmd_id and ts, and refuses it with either', () => {
    const { cmd_id, ts, ...request } = command

    expect(CommandRequestSchema.parse(request)).toEqual(request)
    expect(CommandRequestSchema.safeParse({ ...request, cmd_id }).success).toBe(false)
    expect(CommandRequestSchema.safeParse({ ...request, ts }).success).toBe(false)
  })
})
