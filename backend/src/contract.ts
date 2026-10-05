// The wire contract of the Command Post feed. Source of truth: docs/ARCHITECTURE.md.
import { z } from 'zod'

export const TelemetrySchema = z.strictObject({
  sentinel: z.string().min(1),
  ts: z.iso.datetime(),
  readings: z.strictObject({
    temp: z.number(),
    humidity: z.number(),
    air: z.number(),
    pir: z.boolean(),
    accel: z.strictObject({ x: z.number(), y: z.number(), z: z.number() }),
  }),
})
export type Telemetry = z.infer<typeof TelemetrySchema>

export const StatusLevelSchema = z.enum(['nominal', 'elevated', 'critical'])
export type StatusLevel = z.infer<typeof StatusLevelSchema>

export const StatusSchema = z.strictObject({
  status: StatusLevelSchema,
  ts: z.iso.datetime(),
})
export type Status = z.infer<typeof StatusSchema>

export const FrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('telemetry'), payload: TelemetrySchema }),
  z.strictObject({ type: z.literal('status'), payload: StatusSchema }),
])
export type Frame = z.infer<typeof FrameSchema>
