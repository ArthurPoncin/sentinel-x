import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type { MqttClient } from 'mqtt'
import { z } from 'zod'
import { createAlertPipeline, normalizeAlert } from './alerts.js'
import {
  cookieOf,
  createSessions,
  isAllowedOrigin,
  SESSION_COOKIE,
  type Service,
  type ServiceTokens,
  serviceOf,
  sessionCookie,
  verifyPassword,
} from './auth.js'
import { type CommandRelay, createCommandRelay } from './commands.js'
import {
  type AlertKind,
  type BrokerState,
  CommandRequestSchema,
  type Health,
  type History,
  HistoryQuerySchema,
  IncidentParamsSchema,
  type Incidents,
  LoginSchema,
} from './contract.js'
import type { HistoryRepository } from './history.js'
import { createHub, type Hub } from './hub.js'
import { listIncidents, replayIncident } from './incidents.js'
import { startMockFeed } from './mock-feed.js'
import { connectBroker, type MqttConfig } from './mqtt.js'
import { startMqttIngress } from './mqtt-ingress.js'
import { createRateLimit, type RateLimit } from './rate-limit.js'
import { createTelemetryPipeline } from './telemetry.js'

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub
  }
  interface FastifyRequest {
    // The AI service whose token came with the request, on POST /api/v1/alerts.
    service?: Service
  }
}

export interface ServerConfig {
  // Plays the scripted scenario instead of waiting for a Sentinel; `false` turns it off.
  mockFeed: false | { intervalMs: number }
  // The broker shared with the Sentinels; `false` leaves it out: no telemetry in, no command out.
  mqtt: false | MqttConfig
  // Where the telemetry and Alerts that come in are kept, for GET /api/v1/history.
  history: HistoryRepository
  // Origins of the front-ends served elsewhere than the API, allowed to call it from the browser.
  corsOrigins: string[]
  // The bearer token of each AI service on POST /api/v1/alerts. A service without one cannot post.
  serviceTokens: ServiceTokens
  // The Operator's password hash: a session is required on every other endpoint and on /ws.
  // `false` lets anyone in, for development only.
  operatorAuth: false | { passwordHash: string }
}

const ALERT_BODY_LIMIT = 16 * 1024
const LOGIN_BODY_LIMIT = 1024

// What answers without an Operator session: Docker's healthcheck, the way to log in and to
// check a session, and the AI services' entry point, which takes their tokens instead.
const OPEN_ROUTES = new Set(['/health', '/api/v1/auth/login', '/api/v1/auth/check', '/api/v1/alerts'])
// A command is a handful of short fields, and the broker takes no packet above 4096 bytes.
const COMMAND_BODY_LIMIT = 1024

// The one kind each AI service may post. The Sentinel's kinds only come in over MQTT.
const KIND_OF_SERVICE: Record<Service, AlertKind> = {
  vision: 'intrusion',
  predictive: 'predictive',
}

// Same body as the errors Fastify raises on its own (malformed JSON, body too large…).
function refuse(reply: FastifyReply, statusCode: 400 | 401 | 403 | 404 | 429 | 503, error: string, message: string) {
  return reply.code(statusCode).send({ statusCode, error, message })
}

// Counts the request against `limit`: false, with a 429 sent, when it is over.
function withinLimit(limit: RateLimit, key: string, reply: FastifyReply): boolean {
  const waitMs = limit.take(key)
  if (waitMs === 0) return true
  reply.header('retry-after', Math.ceil(waitMs / 1000))
  refuse(reply, 429, 'Too Many Requests', `Too many requests, try again in ${Math.ceil(waitMs / 1000)} s`)
  return false
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
  const alerts = createAlertPipeline(hub, config.history)
  const telemetry = createTelemetryPipeline(hub, config.history)
  app.decorate('hub', hub)
  await app.register(websocket)
  // Only the listed origins, never `*`: the Operator session will ride on a cookie.
  await app.register(cors, { origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST'] })

  // The connection to the broker, once the server runs with one.
  let broker: MqttClient | undefined

  // As in docs/ARCHITECTURE.md: login 5/min per IP, commands 2/s, alerts 20/s per token.
  const limits = {
    login: createRateLimit(5, 60_000),
    commands: createRateLimit(2, 1000),
    alerts: createRateLimit(20, 1000),
  }

  const sessions = createSessions()
  const hasSession = (request: FastifyRequest) =>
    !config.operatorAuth || sessions.isOpen(cookieOf(request.headers.cookie, SESSION_COOKIE))

  // Every request, the WebSocket upgrade included, before anything else is read.
  app.addHook('onRequest', async (request, reply) => {
    const route = request.routeOptions.url
    if (route === '/ws') {
      const host = request.headers['x-forwarded-host'] ?? request.headers.host
      if (!isAllowedOrigin(request.headers.origin, Array.isArray(host) ? host[0] : host, config.corsOrigins)) {
        return refuse(reply, 403, 'Forbidden', 'This origin may not open the feed')
      }
    }
    if (route !== undefined && OPEN_ROUTES.has(route)) return
    if (!hasSession(request)) return refuse(reply, 401, 'Unauthorized', 'An Operator session is required')
  })

  app.post('/api/v1/auth/login', { bodyLimit: LOGIN_BODY_LIMIT }, async (request, reply) => {
    if (!withinLimit(limits.login, request.ip, reply)) return reply
    const parsed = LoginSchema.safeParse(request.body)
    if (!parsed.success) return refuse(reply, 400, 'Bad Request', z.prettifyError(parsed.error))
    if (!config.operatorAuth) return reply.code(204).send()

    if (!(await verifyPassword(parsed.data.password, config.operatorAuth.passwordHash))) {
      return refuse(reply, 401, 'Unauthorized', 'Wrong password')
    }
    return reply.code(204).header('set-cookie', sessionCookie(sessions.open())).send()
  })

  // Forward-auth for the reverse proxy in front of the camera feed, and the front's way to know
  // whether to show the login screen.
  app.get('/api/v1/auth/check', (request, reply) => reply.code(hasSession(request) ? 204 : 401).send())

  app.post('/api/v1/auth/logout', (request, reply) => {
    sessions.close(cookieOf(request.headers.cookie, SESSION_COOKIE))
    return reply.code(204).header('set-cookie', sessionCookie('', 0)).send()
  })

  // For Docker's healthcheck, on the internal network: the reverse proxy only routes /api and /ws.
  app.get('/health', (_request, reply) => {
    const state: BrokerState = !config.mqtt ? 'off' : broker?.connected ? 'connected' : 'disconnected'
    const health: Health = { status: state === 'disconnected' ? 'degraded' : 'ok', broker: state }
    return reply.code(health.status === 'ok' ? 200 : 503).send(health)
  })

  app.get('/ws', { websocket: true }, (socket) => {
    const disconnect = hub.connect(socket)
    socket.on('close', disconnect)
  })

  const alertRoute = {
    bodyLimit: ALERT_BODY_LIMIT,
    // Before the body is even read: no token, no say.
    onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
      request.service = serviceOf(request.headers.authorization, config.serviceTokens)
      if (!request.service) {
        reply.header('www-authenticate', 'Bearer')
        return refuse(reply, 401, 'Unauthorized', 'A service token is required')
      }
      if (!withinLimit(limits.alerts, request.service, reply)) return reply
    },
  }

  app.post('/api/v1/alerts', alertRoute, (request, reply) => {
    // The token names the source, whatever the body says.
    const service = request.service as Service
    const parsed = normalizeAlert(request.body, { source: service })
    if (!parsed.success) return refuse(reply, 400, 'Bad Request', z.prettifyError(parsed.error))

    const alert = parsed.data
    if (KIND_OF_SERVICE[service] !== alert.kind) {
      return refuse(reply, 403, 'Forbidden', `${service} may not post "${alert.kind}" Alerts here`)
    }

    alerts.accept(alert)
    return reply.code(202).send()
  })

  app.get('/api/v1/history', (request, reply) => {
    const parsed = HistoryQuerySchema.safeParse(request.query)
    if (!parsed.success) return refuse(reply, 400, 'Bad Request', z.prettifyError(parsed.error))

    const history: History = { records: config.history.query(parsed.data) }
    return reply.send(history)
  })

  app.get('/api/v1/incidents', (_request, reply) => {
    const incidents: Incidents = { incidents: listIncidents(config.history) }
    return reply.send(incidents)
  })

  app.get('/api/v1/incidents/:incident_id', (request, reply) => {
    const parsed = IncidentParamsSchema.safeParse(request.params)
    if (!parsed.success) return refuse(reply, 400, 'Bad Request', z.prettifyError(parsed.error))

    const { incident_id } = parsed.data
    const replay = replayIncident(config.history, incident_id)
    if (!replay) return refuse(reply, 404, 'Not Found', `No Incident ${incident_id}`)
    return reply.send(replay)
  })

  // The way out to the Sentinels, once the server runs with a broker.
  let commands: CommandRelay | undefined

  app.post('/api/v1/commands', { bodyLimit: COMMAND_BODY_LIMIT }, async (request, reply) => {
    if (!withinLimit(limits.commands, 'operator', reply)) return reply
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
    whileRunning(app, () => startMockFeed({ telemetry, alerts }, intervalMs))
  }

  if (config.mqtt) {
    const mqtt = config.mqtt
    whileRunning(app, () => {
      const client = connectBroker(mqtt)
      broker = client
      startMqttIngress({ telemetry, alerts }, client)
      commands = createCommandRelay(client)
      return () => client.endAsync(true)
    })
  }

  return app
}
