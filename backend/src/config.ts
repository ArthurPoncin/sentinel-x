import { z } from 'zod'
import type { ServerConfig } from './server.js'

export interface Config extends ServerConfig {
  host: string
  port: number
}

const EnvSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  MOCK_FEED: z.enum(['true', 'false']).default('false'),
  MOCK_FEED_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
})

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`)
  }
  const { HOST, PORT, MOCK_FEED, MOCK_FEED_INTERVAL_MS } = parsed.data
  return {
    host: HOST,
    port: PORT,
    mockFeed: MOCK_FEED === 'true' ? { intervalMs: MOCK_FEED_INTERVAL_MS } : false,
  }
}
