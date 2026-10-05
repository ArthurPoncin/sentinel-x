import websocket from '@fastify/websocket'
import fastify, { type FastifyInstance } from 'fastify'
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

export async function buildServer(config: ServerConfig): Promise<FastifyInstance> {
  const app = fastify()
  const hub = createHub()
  app.decorate('hub', hub)
  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket) => {
    const disconnect = hub.connect(socket)
    socket.on('close', disconnect)
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
