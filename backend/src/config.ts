import { z } from 'zod'
import type { ServerConfig } from './server.js'

export interface Config extends Omit<ServerConfig, 'history'> {
  host: string
  port: number
  // SQLite file of the history, or `:memory:` to keep it in the process only.
  historyFile: string
}

const EnvSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  MOCK_FEED: z.enum(['true', 'false']).default('false'),
  MOCK_FEED_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  HISTORY_FILE: z.string().min(1).default('data/history.sqlite'),
})

// Read only when MQTT_URL is set: it turns MQTT on, and the rest comes with it.
const MqttEnvSchema = z.object({
  // The broker has no plaintext listener: MQTTS or nothing.
  MQTT_URL: z.url({ protocol: /^mqtts$/, error: 'Expected an mqtts:// URL' }),
  MQTT_USERNAME: z.string().min(1).default('api'),
  MQTT_PASSWORD: z.string().min(1),
  MQTT_CA_FILE: z.string().min(1),
})

function read<Schema extends z.ZodType>(schema: Schema, env: Record<string, string | undefined>): z.infer<Schema> {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

function mqttConfig(env: Record<string, string | undefined>): Config['mqtt'] {
  if (env.MQTT_URL === undefined) return false
  const { MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_CA_FILE } = read(MqttEnvSchema, env)
  return { url: MQTT_URL, username: MQTT_USERNAME, password: MQTT_PASSWORD, caFile: MQTT_CA_FILE }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const { HOST, PORT, MOCK_FEED, MOCK_FEED_INTERVAL_MS, HISTORY_FILE } = read(EnvSchema, env)
  return {
    host: HOST,
    port: PORT,
    mockFeed: MOCK_FEED === 'true' ? { intervalMs: MOCK_FEED_INTERVAL_MS } : false,
    mqtt: mqttConfig(env),
    historyFile: HISTORY_FILE,
  }
}
