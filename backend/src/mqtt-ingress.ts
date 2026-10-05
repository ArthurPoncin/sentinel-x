import type { MqttClient } from 'mqtt'
import { z } from 'zod'
import { type AlertPipeline, normalizeAlert } from './alerts.js'
import { type Alert, type AlertKind, type Telemetry, TelemetrySchema } from './contract.js'
import { logLine } from './mqtt.js'
import type { TelemetryPipeline } from './telemetry.js'

const TOPICS = ['sentinel/+/telemetry', 'sentinel/+/alert']

// What the Sentinel decides alone. The others belong to the AI services, over HTTP.
const SENTINEL_KINDS: readonly AlertKind[] = ['gas', 'thermal', 'presence', 'noise']

type Read<T> = { success: true; data: T } | { success: false; reason: string }

function parseJson(text: string): { success: true; data: unknown } | { success: false } {
  try {
    return { success: true, data: JSON.parse(text) }
  } catch {
    return { success: false }
  }
}

function isObject(raw: unknown): raw is object {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

// sentinel/<id>/<what>: the topic names the Sentinel, whatever the payload claims.
function sentinelOf(topic: string): string | undefined {
  return topic.split('/')[1]
}

// Reads what a Sentinel published on its telemetry topic, or says why it is not a snapshot.
export function readTelemetry(topic: string, payload: Buffer): Read<Telemetry> {
  const json = parseJson(payload.toString())
  if (!json.success) return { success: false, reason: 'not JSON' }

  const raw = json.data
  const parsed = TelemetrySchema.safeParse(isObject(raw) ? { ...raw, sentinel: sentinelOf(topic) } : raw)
  return parsed.success ? parsed : { success: false, reason: z.prettifyError(parsed.error) }
}

// Reads what a Sentinel published on its alert topic, or says why it is not one of its Alerts.
// The channel sets `source` and `sentinel`: the payload may leave them out.
export function readAlert(topic: string, payload: Buffer): Read<Alert> {
  const json = parseJson(payload.toString())
  if (!json.success) return { success: false, reason: 'not JSON' }

  const parsed = normalizeAlert(json.data, { source: 'esp32', sentinel: sentinelOf(topic) })
  if (!parsed.success) return { success: false, reason: z.prettifyError(parsed.error) }
  if (!SENTINEL_KINDS.includes(parsed.data.kind)) {
    return { success: false, reason: `a Sentinel may not raise "${parsed.data.kind}" Alerts` }
  }
  return parsed
}

// Subscribes to the Sentinels' telemetry and Alerts each time the broker connection comes up,
// and passes every valid message on to its pipeline.
export function startMqttIngress(
  pipelines: { telemetry: TelemetryPipeline; alerts: AlertPipeline },
  client: MqttClient,
): void {
  client.on('connect', () => {
    client.subscribe(TOPICS, (error) => {
      if (error) console.warn(logLine(`MQTT: cannot subscribe to ${TOPICS.join(', ')}: ${error.message}`))
    })
  })

  client.on('message', (topic, payload) => {
    const what = topic.split('/')[2]
    if (what === 'telemetry') {
      const snapshot = readTelemetry(topic, payload)
      if (snapshot.success) return pipelines.telemetry.accept(snapshot.data)
      return console.warn(logLine(`MQTT: dropped a message on ${topic}: ${snapshot.reason}`))
    }
    if (what === 'alert') {
      const alert = readAlert(topic, payload)
      if (alert.success) return pipelines.alerts.accept(alert.data)
      return console.warn(logLine(`MQTT: dropped a message on ${topic}: ${alert.reason}`))
    }
  })
}
