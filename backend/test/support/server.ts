import type { AddressInfo } from 'node:net'
import { onTestFinished } from 'vitest'
import { buildServer, type ServerConfig } from '../../src/server.js'
import { connectClient } from './ws-client.js'

// Starts the API on a free port and closes it when the calling test ends.
// Every feed is off unless the test turns it on.
export async function startServer(config: Partial<ServerConfig> = {}) {
  const server = await buildServer({ mockFeed: false, mqtt: false, ...config })
  onTestFinished(() => server.close())
  await server.listen({ port: 0, host: '127.0.0.1' })
  const { port } = server.server.address() as AddressInfo

  // Posts the body as is, so a test can also send what is not JSON.
  const postTo = (path: string, body: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
  const post = (body: string) => postTo('/api/v1/alerts', body)

  return {
    hub: server.hub,
    connect: () => connectClient(`ws://127.0.0.1:${port}/ws`),
    post,
    postAlert: (alert: unknown) => post(JSON.stringify(alert)),
    postCommand: (command: unknown) => postTo('/api/v1/commands', JSON.stringify(command)),
  }
}
