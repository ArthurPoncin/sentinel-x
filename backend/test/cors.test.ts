import { describe, expect, it } from 'vitest'
import { startServer } from './support/server.js'

const DASHBOARD = 'https://192.168.4.1'
const TWIN = 'http://localhost:5174'

// What a browser sends before a cross-origin POST with a JSON body.
function preflight(origin: string, method = 'POST') {
  return {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'content-type',
    },
  }
}

describe('CORS', () => {
  it('lets every listed origin read the API', async () => {
    const { request } = await startServer({ corsOrigins: [DASHBOARD, TWIN] })

    for (const origin of [DASHBOARD, TWIN]) {
      const response = await request('/api/v1/incidents', { headers: { origin } })

      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    }
  })

  it('lets a listed origin send a command', async () => {
    const { request } = await startServer({ corsOrigins: [DASHBOARD] })

    const response = await request('/api/v1/commands', preflight(DASHBOARD))

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(DASHBOARD)
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST')
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type')
  })

  it('answers the preflight without an Operator session: browsers never send the cookie with it', async () => {
    const { request } = await startServer({ corsOrigins: [DASHBOARD], operatorAuth: { passwordHash: 'unused' } })

    const response = await request('/api/v1/commands', preflight(DASHBOARD))

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(DASHBOARD)
  })

  it('grants nothing to an origin that is not listed', async () => {
    const { request } = await startServer({ corsOrigins: [DASHBOARD] })

    const read = await request('/api/v1/incidents', { headers: { origin: 'https://evil.example' } })
    const send = await request('/api/v1/commands', preflight('https://evil.example'))

    // Without its origin named back, the browser keeps the response from the page.
    for (const response of [read, send]) expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('grants nothing to any origin unless some are listed', async () => {
    const { request } = await startServer()

    const response = await request('/api/v1/incidents', { headers: { origin: DASHBOARD } })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows no other method than GET and POST', async () => {
    const { request } = await startServer({ corsOrigins: [DASHBOARD] })

    const response = await request('/api/v1/incidents/1', preflight(DASHBOARD, 'DELETE'))

    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST')
  })
})
