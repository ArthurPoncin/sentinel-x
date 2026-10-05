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

export const SeveritySchema = z.enum(['info', 'warning', 'critical'])
export type Severity = z.infer<typeof SeveritySchema>

export const AlertSourceSchema = z.enum(['esp32', 'vision', 'predictive'])
export type AlertSource = z.infer<typeof AlertSourceSchema>

export const AlertKindSchema = z.enum(['gas', 'thermal', 'presence', 'tamper', 'intrusion', 'predictive'])
export type AlertKind = z.infer<typeof AlertKindSchema>

export const AlertStateSchema = z.enum(['raised', 'cleared'])
export type AlertState = z.infer<typeof AlertStateSchema>

// Shared by every kind; only `kind` and its `detail` vary.
const alertFields = {
  // Stable id: pairs a raised with its later cleared.
  alert_id: z.string().min(1),
  sentinel: z.string().min(1),
  source: AlertSourceSchema,
  severity: SeveritySchema,
  state: AlertStateSchema,
  // Triggering measurement, kind-dependent.
  value: z.number().optional(),
  ts: z.iso.datetime(),
}

function alertOf<Kind extends AlertKind, Detail extends z.ZodType>(kind: Kind, detail: Detail) {
  return z.strictObject({ ...alertFields, kind: z.literal(kind), detail })
}

const NoDetailSchema = z.strictObject({})

export const AlertSchema = z.discriminatedUnion('kind', [
  alertOf('gas', NoDetailSchema),
  alertOf('thermal', NoDetailSchema),
  alertOf('presence', NoDetailSchema),
  alertOf('tamper', z.strictObject({ magnitude: z.number(), axis: z.enum(['x', 'y', 'z']) })),
  alertOf(
    'intrusion',
    z.strictObject({
      // 0 = left, 1 = right: where the Digital Twin places the intruder.
      x_norm: z.number().min(0).max(1),
      confidence: z.number(),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    }),
  ),
  alertOf('predictive', z.strictObject({ anomaly_score: z.number(), drivers: z.array(z.string()) })),
])
export type Alert = z.infer<typeof AlertSchema>

export const StatusLevelSchema = z.enum(['nominal', 'elevated', 'critical'])
export type StatusLevel = z.infer<typeof StatusLevelSchema>

export const StatusSchema = z.strictObject({
  status: StatusLevelSchema,
  ts: z.iso.datetime(),
})
export type Status = z.infer<typeof StatusSchema>

export const ActuatorSchema = z.enum(['buzzer', 'speaker', 'led'])
export type Actuator = z.infer<typeof ActuatorSchema>

export const CommandActionSchema = z.enum(['on', 'off', 'pattern'])
export type CommandAction = z.infer<typeof CommandActionSchema>

// What the Operator sends to POST /api/v1/commands.
export const CommandRequestSchema = z.strictObject({
  // Becomes one level of the topic, command/<sentinel>/actuator: no separator, no wildcard.
  sentinel: z.string().regex(/^[\w-]{1,64}$/),
  actuator: ActuatorSchema,
  action: CommandActionSchema,
  params: z
    .strictObject({
      pattern: z.string().min(1).max(32).optional(),
      led: z.string().min(1).max(32).optional(),
    })
    .optional(),
})
export type CommandRequest = z.infer<typeof CommandRequestSchema>

// What the Sentinel reads on command/<id>/actuator: the request, stamped by the api.
export const CommandSchema = z.strictObject({
  cmd_id: z.string().min(1),
  ...CommandRequestSchema.shape,
  ts: z.iso.datetime(),
})
export type Command = z.infer<typeof CommandSchema>

export const FrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('telemetry'), payload: TelemetrySchema }),
  z.strictObject({ type: z.literal('alert'), payload: AlertSchema }),
  z.strictObject({ type: z.literal('status'), payload: StatusSchema }),
])
export type Frame = z.infer<typeof FrameSchema>
