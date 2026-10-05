import websocket from '@fastify/websocket'
import fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import { z } from 'zod'
import { createAlertPipeline, normalizeAlert } from './alerts.js'
import type { AlertKind, AlertSource } from './contract.js'
import { createHub, type Hub } from './hub.js'
import { startMockFeed } from './mock-feed.js'

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub
  }
}

export interface ServerConfig {
  // Plays the scripted scenario instead of waiting for a Sentinel; `false` turns it off.
  mockFeed: false | { intervalMs: number }
}

const ALERT_BODY_LIMIT = 16 * 1024

// The one kind each AI service may post. The Sentinel's kinds only come in over MQTT.
const KIND_OF_SERVICE: Partial<Record<AlertSource, AlertKind>> = {
  vision: 'intrusion',
  predictive: 'predictive',
}

// Same body as the errors Fastify raises on its own (malformed JSON, body too large…).
function refuse(reply: FastifyReply, statusCode: 400 | 403, error: string, message: string) {
  return reply.code(statusCode).send({ statusCode, error, message })
}

export async function buildServer(config: ServerConfig): Promise<FastifyInstance> {
  const app = fastify()
  const hub = createHub()
  const alerts = createAlertPipeline(hub)
  app.decorate('hub', hub)
  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket) => {
    const disconnect = hub.connect(socket)
    socket.on('close', disconnect)
  })

  app.post('/api/v1/alerts', { bodyLimit: ALERT_BODY_LIMIT }, (request, reply) => {
    const parsed = normalizeAlert(request.body)
    if (!parsed.success) return refuse(reply, 400, 'Bad Request', z.prettifyError(parsed.error))

    // Until service tokens name the caller, the service is the `source` it declares.
    const alert = parsed.data
    if (KIND_OF_SERVICE[alert.source] !== alert.kind) {
      return refuse(reply, 403, 'Forbidden', `${alert.source} may not post "${alert.kind}" Alerts here`)
    }

    alerts.accept(alert)
    return reply.code(202).send()
  })

  if (config.mockFeed) {
    const { intervalMs } = config.mockFeed
    let stop = () => {}
    app.addHook('onReady', async () => {
      stop = startMockFeed(hub, intervalMs)
    })
    app.addHook('onClose', async () => stop())
  }

  return app
}
