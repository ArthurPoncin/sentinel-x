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
    // Share of the cycle the sound sensor heard sound, 0–1: the CZN-15E only says above or below its threshold.
    sound: z.number(),
  }),
})
export type Telemetry = z.infer<typeof TelemetrySchema>

export const SeveritySchema = z.enum(['info', 'warning', 'critical'])
export type Severity = z.infer<typeof SeveritySchema>

export const AlertSourceSchema = z.enum(['esp32', 'vision', 'predictive'])
export type AlertSource = z.infer<typeof AlertSourceSchema>

export const AlertKindSchema = z.enum(['gas', 'thermal', 'presence', 'noise', 'intrusion', 'predictive'])
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
  alertOf('noise', NoDetailSchema),
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

export const ActuatorSchema = z.enum(['buzzer', 'led'])
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

const TelemetryFrameSchema = z.strictObject({ type: z.literal('telemetry'), payload: TelemetrySchema })
const AlertFrameSchema = z.strictObject({ type: z.literal('alert'), payload: AlertSchema })

export const FrameSchema = z.discriminatedUnion('type', [
  TelemetryFrameSchema,
  AlertFrameSchema,
  z.strictObject({ type: z.literal('status'), payload: StatusSchema }),
])
export type Frame = z.infer<typeof FrameSchema>

// What the history keeps: the telemetry and Alert frames, as they went out live. The Status is
// not kept: it follows from the Alerts.
export const HistoryRecordSchema = z.discriminatedUnion('type', [TelemetryFrameSchema, AlertFrameSchema])
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>

// Query of GET /api/v1/history: from and to are both included.
export const HistoryQuerySchema = z
  .object({ from: z.iso.datetime(), to: z.iso.datetime() })
  .refine(({ from, to }) => Date.parse(from) <= Date.parse(to), { error: '`from` comes after `to`', path: ['to'] })
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>

// Body of GET /api/v1/history: the records of the range, oldest first.
export const HistorySchema = z.strictObject({ records: z.array(HistoryRecordSchema) })
export type History = z.infer<typeof HistorySchema>

// An Incident: from the first `raised` Alert until every Alert raised since is `cleared`. Built
// from the history, never stored.
export const IncidentSchema = z.strictObject({
  // Numbered from 1 in the order they started.
  incident_id: z.number().int().positive(),
  // ts of the Alert that opened it.
  start: z.iso.datetime(),
  // ts of the `cleared` that closed it; null while it is still going on.
  end: z.iso.datetime().nullable(),
  ongoing: z.boolean(),
  // How many Alerts it holds, raised and cleared alike.
  alerts: z.number().int().positive(),
  // The kinds of its Alerts, in the order they first came.
  kinds: z.array(AlertKindSchema),
  // The highest severity it reached.
  peak: SeveritySchema,
})
export type Incident = z.infer<typeof IncidentSchema>

// Body of GET /api/v1/incidents: every Incident, oldest first.
export const IncidentsSchema = z.strictObject({ incidents: z.array(IncidentSchema) })
export type Incidents = z.infer<typeof IncidentsSchema>

// Path of GET /api/v1/incidents/:incident_id.
export const IncidentParamsSchema = z.object({ incident_id: z.coerce.number().int().positive() })

// Body of GET /api/v1/incidents/:incident_id: the Incident, and what the Twin replays of it — its
// Alerts and the telemetry of its span, oldest first.
export const IncidentReplaySchema = z.strictObject({ incident: IncidentSchema, records: z.array(HistoryRecordSchema) })
export type IncidentReplay = z.infer<typeof IncidentReplaySchema>

// The api's link to the broker: `off` when it runs without one (MQTT_URL unset).
export const BrokerStateSchema = z.enum(['connected', 'disconnected', 'off'])
export type BrokerState = z.infer<typeof BrokerStateSchema>

// Body of GET /health: `degraded` while a broker is set but out of reach, with a 503.
export const HealthSchema = z.strictObject({
  status: z.enum(['ok', 'degraded']),
  broker: BrokerStateSchema,
})
export type Health = z.infer<typeof HealthSchema>

// Body of POST /api/v1/auth/login: the Operator's password, nothing else.
export const LoginSchema = z.strictObject({ password: z.string().min(1).max(256) })
export type Login = z.infer<typeof LoginSchema>
