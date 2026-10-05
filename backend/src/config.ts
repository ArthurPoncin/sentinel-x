import { z } from 'zod'
import { isPasswordHash } from './auth.js'
import type { ServerConfig } from './server.js'

export interface Config extends Omit<ServerConfig, 'history'> {
  host: string
  port: number
  // SQLite file of the history, or `:memory:` to keep it in the process only.
  historyFile: string
}

// An origin as browsers send it: scheme, host and port, no path, no trailing slash.
const OriginSchema = z
  .url({ protocol: /^https?$/, error: 'Expected an http:// or https:// origin' })
  .refine(
    (url) => !URL.canParse(url) || new URL(url).origin === url,
    'Expected an origin alone: no path, no trailing slash',
  )

// Long enough not to be guessed: `openssl rand -hex 32` gives 64 characters.
const ServiceTokenSchema = z.string().regex(/^\S{32,}$/, 'Expected at least 32 characters, no space')

const EnvSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  MOCK_FEED: z.enum(['true', 'false']).default('false'),
  MOCK_FEED_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  HISTORY_FILE: z.string().min(1).default('data/history.sqlite'),
  // Comma-separated. None by default: the front-ends reach the API through their own origin.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((list) => list.split(',').map((origin) => origin.trim()).filter((origin) => origin !== ''))
    .pipe(z.array(OriginSchema)),
  // Bearer tokens of the AI services on POST /api/v1/alerts. Unset: that service cannot post.
  VISION_TOKEN: ServiceTokenSchema.optional(),
  PREDICTIVE_TOKEN: ServiceTokenSchema.optional(),
  // `off` lets anyone in without logging in: development only.
  OPERATOR_AUTH: z.enum(['on', 'off']).default('on'),
  OPERATOR_PASSWORD_HASH: z
    .string()
    .refine(isPasswordHash, 'Expected the output of `npm run hash-password`: scrypt:<salt>:<key>')
    .optional(),
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
  const {
    HOST,
    PORT,
    MOCK_FEED,
    MOCK_FEED_INTERVAL_MS,
    HISTORY_FILE,
    CORS_ORIGINS,
    VISION_TOKEN,
    PREDICTIVE_TOKEN,
    OPERATOR_AUTH,
    OPERATOR_PASSWORD_HASH,
  } = read(EnvSchema, env)
  // The token names the source: two services sharing one could post as each other.
  if (VISION_TOKEN !== undefined && VISION_TOKEN === PREDICTIVE_TOKEN) {
    throw new Error('Invalid configuration:\nVISION_TOKEN and PREDICTIVE_TOKEN must differ: one token per service')
  }
  // No way in without a password: refuse to start rather than run open.
  if (OPERATOR_AUTH === 'on' && OPERATOR_PASSWORD_HASH === undefined) {
    throw new Error(
      'Invalid configuration:\nOPERATOR_PASSWORD_HASH is required: `npm run hash-password` makes one ' +
        '(OPERATOR_AUTH=off runs without login, for development only)',
    )
  }
  return {
    host: HOST,
    port: PORT,
    mockFeed: MOCK_FEED === 'true' ? { intervalMs: MOCK_FEED_INTERVAL_MS } : false,
    mqtt: mqttConfig(env),
    historyFile: HISTORY_FILE,
    corsOrigins: CORS_ORIGINS,
    serviceTokens: { vision: VISION_TOKEN, predictive: PREDICTIVE_TOKEN },
    operatorAuth: OPERATOR_AUTH === 'on' && OPERATOR_PASSWORD_HASH ? { passwordHash: OPERATOR_PASSWORD_HASH } : false,
  }
}
