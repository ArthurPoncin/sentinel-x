import type { MqttClient } from 'mqtt'
import { z } from 'zod'
import { type Telemetry, TelemetrySchema } from './contract.js'
import { logLine } from './mqtt.js'
import type { TelemetryPipeline } from './telemetry.js'

const TELEMETRY_TOPICS = 'sentinel/+/telemetry'

function parseJson(text: string): { success: true; data: unknown } | { success: false } {
  try {
    return { success: true, data: JSON.parse(text) }
  } catch {
    return { success: false }
  }
}

// Reads what a Sentinel published on its telemetry topic, or says why it is not a snapshot.
export function readTelemetry(
  topic: string,
  payload: Buffer,
): { success: true; data: Telemetry } | { success: false; reason: string } {
  const json = parseJson(payload.toString())
  if (!json.success) return { success: false, reason: 'not JSON' }

  // sentinel/<id>/telemetry: the topic names the Sentinel, whatever the payload claims.
  const [, sentinel] = topic.split('/')
  const raw = json.data
  const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
  const parsed = TelemetrySchema.safeParse(isObject ? { ...raw, sentinel } : raw)
  return parsed.success ? parsed : { success: false, reason: z.prettifyError(parsed.error) }
}

// Subscribes to the Sentinels' telemetry each time the broker connection comes up, and
// passes every valid snapshot on.
export function startMqttIngress(telemetry: TelemetryPipeline, client: MqttClient): void {
  client.on('connect', () => {
    client.subscribe(TELEMETRY_TOPICS, (error) => {
      if (error) console.warn(logLine(`MQTT: cannot subscribe to ${TELEMETRY_TOPICS}: ${error.message}`))
    })
  })

  client.on('message', (topic, payload) => {
    const snapshot = readTelemetry(topic, payload)
    if (snapshot.success) telemetry.accept(snapshot.data)
    else console.warn(logLine(`MQTT: dropped a message on ${topic}: ${snapshot.reason}`))
  })
}
