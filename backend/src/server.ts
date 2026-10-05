import websocket from '@fastify/websocket'
import fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import { z } from 'zod'
import { createAlertPipeline, normalizeAlert } from './alerts.js'
import { type CommandRelay, createCommandRelay } from './commands.js'
import { type AlertKind, type AlertSource, CommandRequestSchema } from './contract.js'
import { createHub, type Hub } from './hub.js'
import { startMockFeed } from './mock-feed.js'
import { connectBroker, type MqttConfig } from './mqtt.js'
import { startMqttIngress } from './mqtt-ingress.js'

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub
  }
}

export interface ServerConfig {
  // Plays the scripted scenario instead of waiting for a Sentinel; `false` turns it off.
  mockFeed: false | { intervalMs: number }
  // The broker shared with the Sentinels; `false` leaves it out: no telemetry in, no command out.
  mqtt: false | MqttConfig
}

const ALERT_BODY_LIMIT = 16 * 1024
// A command is a handful of short fields, and the broker takes no packet above 4096 bytes.
const COMMAND_BODY_LIMIT = 1024

// The one kind each AI service may post. The Sentinel's kinds only come in over MQTT.
const KIND_OF_SERVICE: Partial<Record<AlertSource, AlertKind>> = {
  vision: 'intrusion',
  predictive: 'predictive',
}

// Same body as the errors Fastify raises on its own (malformed JSON, body too large…).
function refuse(reply: FastifyReply, statusCode: 400 | 403 | 503, error: string, message: string) {
  return reply.code(statusCode).send({ statusCode, error, message })
}

// Runs a feed from the moment the server is ready until it closes. `start` returns what stops it.
function whileRunning(app: FastifyInstance, start: () => () => void | Promise<void>) {
  let stop: () => void | Promise<void> = () => {}
  app.addHook('onReady', async () => {
    stop = start()
  })
  app.addHook('onClose', async () => stop())
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

  // The way out to the Sentinels, once the server runs with a broker.
  let commands: CommandRelay | undefined

  app.post('/api/v1/commands', { bodyLimit: COMMAND_BODY_LIMIT }, async (request, reply) => {
    const parsed = CommandRequestSchema.safeParse(request.body)
    if (!parsed.success) return refuse(reply, 400, 'Bad Request', z.prettifyError(parsed.error))

    if (!commands) return refuse(reply, 503, 'Service Unavailable', 'No broker to relay the command to')
    const relayed = await commands.relay(parsed.data)
    if (!relayed.success) {
      return refuse(reply, 503, 'Service Unavailable', `The command was not relayed: ${relayed.reason}`)
    }

    return reply.code(202).send(relayed.data)
  })

  if (config.mockFeed) {
    const { intervalMs } = config.mockFeed
    whileRunning(app, () => startMockFeed(hub, intervalMs))
  }

  if (config.mqtt) {
    const broker = config.mqtt
    whileRunning(app, () => {
      const client = connectBroker(broker)
      startMqttIngress(hub, client)
      commands = createCommandRelay(client)
      return () => client.endAsync(true)
    })
  }

  return app
}
