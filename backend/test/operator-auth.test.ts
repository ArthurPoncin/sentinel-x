import { beforeAll, describe, expect, it } from 'vitest'
import { createSessions, hashPassword, SESSION_TTL_MS } from '../src/auth.js'
import { intrusionAlert } from './support/alerts.js'
import { startServer } from './support/server.js'

const PASSWORD = 'correct horse battery staple'
let passwordHash: string
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

async function startGuardedServer(config: Parameters<typeof startServer>[0] = {}) {
  const server = await startServer({ operatorAuth: { passwordHash }, ...config })
  const login = (password: string) =>
    server.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
  // Logs in and returns the Cookie header a browser would send back.
  const session = async () => {
    const response = await login(PASSWORD)
    const [cookie] = (response.headers.get('set-cookie') ?? '').split(';')
    return { cookie: cookie ?? '' }
  }
  return { ...server, login, session }
}

const range = new URLSearchParams({ from: '2026-10-05T00:00:00Z', to: '2026-10-06T00:00:00Z' })

// Every endpoint behind the Operator session, as the browser calls it.
const GUARDED: [string, string, RequestInit?][] = [
  ['the history', `/api/v1/history?${range}`],
  ['the Incidents', '/api/v1/incidents'],
  ['an Incident replay', '/api/v1/incidents/1'],
  [
    'an actuator command',
    '/api/v1/commands',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentinel: 'sentinel-01', actuator: 'buzzer', action: 'on' }),
    },
  ],
  ['a route that does not exist', '/api/v1/secrets'],
]

describe('Operator session', () => {
  it.each(GUARDED)('401 on %s without a session', async (_label, path, init) => {
    const { request } = await startGuardedServer()

    expect((await request(path, init)).status).toBe(401)
  })

  it('turns the feed away without a session', async () => {
    const { connect } = await startGuardedServer()

    await expect(connect()).rejects.toThrow(/401/)
  })

  it('opens a session on the right password, in a cookie scripts and other sites cannot use', async () => {
    const { login } = await startGuardedServer()

    const response = await login(PASSWORD)

    expect(response.status).toBe(204)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^sx_session=[\w-]{43};/)
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_TTL_MS / 1000}`]) {
      expect(cookie).toContain(attribute)
    }
  })

  it.each(GUARDED.slice(0, 2))('lets the Operator read %s with the session', async (_label, path, init) => {
    const { request, session } = await startGuardedServer()

    expect((await request(path, { ...init, headers: await session() })).status).toBe(200)
  })

  it('lets the Operator open the feed with the session', async () => {
    const { connect, session } = await startGuardedServer()

    const client = await connect(await session())

    await expect.poll(() => client.frames).toMatchObject([{ type: 'status' }])
  })

  it('401 on a wrong password, and no cookie', async () => {
    const { login } = await startGuardedServer()

    const response = await login('hunter2')

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('400 on a login body that is not just a password', async () => {
    const { request } = await startGuardedServer()
    const post = (body: string) =>
      request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body })

    expect((await post(JSON.stringify({ password: PASSWORD, user: 'admin' }))).status).toBe(400)
    expect((await post(JSON.stringify({ password: '' }))).status).toBe(400)
    expect((await post('{"password": ')).status).toBe(400)
  })

  describe('GET /api/v1/auth/check, forward-auth of the camera feed', () => {
    it('204 with a session, 401 without or with a forged one', async () => {
      const { request, session } = await startGuardedServer()

      expect((await request('/api/v1/auth/check', { headers: await session() })).status).toBe(204)
      expect((await request('/api/v1/auth/check')).status).toBe(401)
      const forged = { cookie: `sx_session=${'A'.repeat(43)}` }
      expect((await request('/api/v1/auth/check', { headers: forged })).status).toBe(401)
    })
  })

  it('closes the session on logout', async () => {
    const { request, session } = await startGuardedServer()
    const headers = await session()

    const response = await request('/api/v1/auth/logout', { method: 'POST', headers })

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await request('/api/v1/auth/check', { headers })).status).toBe(401)
  })

  it('leaves the healthcheck and the AI services out of it', async () => {
    const { getHealth, postAlert } = await startGuardedServer()

    expect((await getHealth()).status).toBe(200)
    expect((await postAlert(intrusionAlert())).status).toBe(202)
  })

  it('ends a session after its time', () => {
    let now = 0
    const sessions = createSessions(() => now)
    const id = sessions.open()

    now = SESSION_TTL_MS - 1
    expect(sessions.isOpen(id)).toBe(true)
    now = SESSION_TTL_MS
    expect(sessions.isOpen(id)).toBe(false)
  })
})

describe('Origin of the feed', () => {
  it('turns away a page from another site, session or not', async () => {
    const { connect, session } = await startGuardedServer()

    await expect(connect({ origin: 'https://evil.example', ...(await session()) })).rejects.toThrow(/403/)
  })

  it('lets in a page served from the API origin, or from one CORS allows', async () => {
    const { connect, session, origin } = await startGuardedServer({ corsOrigins: ['http://localhost:5173'] })
    const cookie = await session()

    await expect(connect({ origin, ...cookie })).resolves.toBeDefined()
    await expect(connect({ origin: 'http://localhost:5173', ...cookie })).resolves.toBeDefined()
  })
})

describe('without Operator login (OPERATOR_AUTH=off)', () => {
  it('lets anyone in, and says so on the check', async () => {
    const { request, connect } = await startServer()

    expect((await request('/api/v1/auth/check')).status).toBe(204)
    expect((await request('/api/v1/incidents')).status).toBe(200)
    await expect(connect()).resolves.toBeDefined()
  })
})
