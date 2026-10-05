import type { AddressInfo } from 'node:net'
import { onTestFinished } from 'vitest'
import type { Service } from '../../src/auth.js'
import { createMemoryHistory } from '../../src/history.js'
import { buildServer, type ServerConfig } from '../../src/server.js'
import { connectClient } from './ws-client.js'

// The bearer token each AI service holds in the tests.
export const TOKEN: Record<Service, string> = {
  vision: 'vision-token-0123456789abcdef0123456789',
  predictive: 'predictive-token-0123456789abcdef01234567',
}

// The token of the service a body claims to come from, the vision one when it claims nothing else.
function tokenFor(body: unknown): string {
  const source = typeof body === 'object' && body !== null && 'source' in body ? body.source : undefined
  return source === 'predictive' ? TOKEN.predictive : TOKEN.vision
}

// Starts the API on a free port and closes it when the calling test ends.
// Every feed is off unless the test turns it on, the history starts empty, in memory, both AI
// services hold their TOKEN, and no Operator login is asked for unless the test sets a password.
export async function startServer(config: Partial<ServerConfig> = {}) {
  const server = await buildServer({
    mockFeed: false,
    mqtt: false,
    history: createMemoryHistory(),
    corsOrigins: [],
    serviceTokens: TOKEN,
    operatorAuth: false,
    ...config,
  })
  onTestFinished(() => server.close())
  await server.listen({ port: 0, host: '127.0.0.1' })
  const { port } = server.server.address() as AddressInfo

  // Posts the body as is, so a test can also send what is not JSON.
  const postTo = (path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })
  // Sends the Authorization header as given; null sends none.
  const post = (body: string, authorization: string | null = `Bearer ${TOKEN.vision}`) =>
    postTo('/api/v1/alerts', body, authorization === null ? {} : { authorization })

  return {
    hub: server.hub,
    // As a browser would open it, when the test gives an Origin or a Cookie header.
    connect: (headers: Record<string, string> = {}) => connectClient(`ws://127.0.0.1:${port}/ws`, headers),
    origin: `http://127.0.0.1:${port}`,
    post,
    // As the service the Alert claims to come from, unless the test names the token.
    postAlert: (alert: unknown, token = tokenFor(alert)) => post(JSON.stringify(alert), `Bearer ${token}`),
    postCommand: (command: unknown) => postTo('/api/v1/commands', JSON.stringify(command)),
    // Asks for the history with the query as given, so a test can also leave a bound out.
    getHistory: (query: Record<string, string>) =>
      fetch(`http://127.0.0.1:${port}/api/v1/history?${new URLSearchParams(query)}`),
    getIncidents: () => fetch(`http://127.0.0.1:${port}/api/v1/incidents`),
    // Takes the id as given, so a test can also ask for one that is not a number.
    getIncident: (id: number | string) => fetch(`http://127.0.0.1:${port}/api/v1/incidents/${id}`),
    getHealth: () => fetch(`http://127.0.0.1:${port}/health`),
    // Any request, as a browser would send it from another origin.
    request: (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init),
  }
}
