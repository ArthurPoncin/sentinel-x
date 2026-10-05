import { readFileSync } from 'node:fs'
import { connect, type MqttClient } from 'mqtt'

export interface MqttConfig {
  // mqtts://<host>:<port>. The broker has no plaintext listener.
  url: string
  username: string
  password: string
  // Path of the team CA certificate (PEM) that signed the broker's.
  caFile: string
}

// Payloads and topics are not ours: whatever they hold, a log entry stays one bounded line.
export function logLine(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 1000)
}

// Opens the api's one connection to the broker: telemetry comes in on it, commands go out on it.
// Keeps retrying while the broker is away.
export function connectBroker(config: MqttConfig): MqttClient {
  const broker = new URL(config.url).host
  const client = connect(config.url, {
    username: config.username,
    password: config.password,
    // Only the team CA vouches for the broker. Node itself refuses anything below TLS 1.2.
    ca: readFileSync(config.caFile),
    rejectUnauthorized: true,
    // A refused login is retried too: the broker's password file may be fixed while we run.
    reconnectOnConnackError: true,
    // Whoever listens on this connection subscribes again each time it comes up.
    resubscribe: false,
  })

  // A broker that stays away fails the same way on every retry: say it once.
  let lastError: string | undefined
  let connected = false

  client.on('connect', () => {
    connected = true
    lastError = undefined
    console.log(`MQTT: connected to ${broker} as ${config.username}`)
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

  return client
}
