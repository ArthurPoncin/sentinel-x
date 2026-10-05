import websocket from '@fastify/websocket'
import fastify, { type FastifyInstance } from 'fastify'
import { createHub, type Hub } from './hub.js'

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = fastify()
  const hub = createHub()
  app.decorate('hub', hub)
  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket) => {
    const disconnect = hub.connect(socket)
    socket.on('close', disconnect)
  })

  return app
}
