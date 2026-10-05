import { readFileSync } from 'node:fs'
import { connect } from 'mqtt'
import { z } from 'zod'
import { type Telemetry, TelemetrySchema } from './contract.js'
import type { Hub } from './hub.js'

export interface MqttConfig {
  // mqtts://<host>:<port>. The broker has no plaintext listener.
  url: string
  username: string
  password: string
  // Path of the team CA certificate (PEM) that signed the broker's.
  caFile: string
}

const TELEMETRY_TOPICS = 'sentinel/+/telemetry'

// Payloads and topics are not ours: whatever they hold, a log entry stays one bounded line.
function logLine(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 1000)
}

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

// Subscribes to the Sentinels' telemetry on the broker and broadcasts every valid snapshot.
// Keeps retrying while the broker is away. Returns the function that disconnects.
export function startMqttIngress(hub: Pick<Hub, 'broadcast'>, config: MqttConfig): () => Promise<void> {
  const broker = new URL(config.url).host
  const client = connect(config.url, {
    username: config.username,
    password: config.password,
    // Only the team CA vouches for the broker. Node itself refuses anything below TLS 1.2.
    ca: readFileSync(config.caFile),
    rejectUnauthorized: true,
    // A refused login is retried too: the broker's password file may be fixed while we run.
    reconnectOnConnackError: true,
    // The subscription is taken again on every connection, below.
    resubscribe: false,
  })

  // A broker that stays away fails the same way on every retry: say it once.
  let lastError: string | undefined
  let connected = false

  client.on('connect', () => {
    connected = true
    lastError = undefined
    console.log(`MQTT: connected to ${broker} as ${config.username}`)
    client.subscribe(TELEMETRY_TOPICS, (error) => {
      if (error) console.warn(logLine(`MQTT: cannot subscribe to ${TELEMETRY_TOPICS}: ${error.message}`))
    })
  })

  client.on('close', () => {
    if (connected) console.warn(`MQTT: lost the connection to ${broker}, retrying`)
    connected = false
  })

  // Without this listener, a refused connection would take the whole process down.
  client.on('error', (error) => {
    if (error.message === lastError) return
    lastError = error.message
    console.warn(logLine(`MQTT: ${broker}: ${error.message}`))
  })

  client.on('message', (topic, payload) => {
    const telemetry = readTelemetry(topic, payload)
    if (telemetry.success) hub.broadcast({ type: 'telemetry', payload: telemetry.data })
    else console.warn(logLine(`MQTT: dropped a message on ${topic}: ${telemetry.reason}`))
  })

  return () => client.endAsync(true)
}
