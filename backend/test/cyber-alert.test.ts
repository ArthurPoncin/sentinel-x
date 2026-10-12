import { beforeAll, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth.js'
import { type Alert, COMMAND_POST, type Frame, HistorySchema, IncidentReplaySchema, IncidentsSchema } from '../src/contract.js'
import { QUIET_MS, THRESHOLD } from '../src/cyber-watch.js'
import { intrusionAlert, predictiveAlert } from './support/alerts.js'
import { startBroker } from './support/broker.js'
import { startServer, TOKEN } from './support/server.js'
import type { TestClient } from './support/ws-client.js'

vi.spyOn(console, 'log').mockImplementation(() => {})

const PASSWORD = 'correct horse battery staple'
let passwordHash: string
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

const START = Date.parse('2026-10-05T14:23:00Z')
// Where the tests reach the API from: no reverse proxy in front, the address of the connection.
const HERE = '127.0.0.1'
const DAY = { from: '2026-10-05T00:00:00Z', to: '2026-10-06T00:00:00Z' }

const marker: Frame = {
  type: 'telemetry',
  payload: {
    sentinel: 'sentinel-01',
    ts: '2026-10-05T14:23:00Z',
    readings: { temp: 31.2, humidity: 44, air: 180, pir: false, sound: 0.02 },
  },
}

function alertsOf(client: TestClient): Alert[] {
  return client.frames.flatMap((frame) => {
    const { type, payload } = frame as Frame
    return type === 'alert' ? [payload] : []
  })
}

function statusesOf(client: TestClient): string[] {
  return client.frames.flatMap((frame) => {
    const { type, payload } = frame as Frame
    return type === 'status' ? [payload.status] : []
  })
}

// A Command Post with the Operator logged in and watching the feed, on a clock the test moves.
async function startOutpost(config: Parameters<typeof startServer>[0] = {}) {
  const clock = { now: START }
  const server = await startServer({ operatorAuth: { passwordHash }, now: () => clock.now, ...config })
  const login = (password: string) =>
    server.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })

  const [cookie = ''] = ((await login(PASSWORD)).headers.get('set-cookie') ?? '').split(';')
  // The Operator's own login is behind: the attacker starts on a login limit that is whole.
  clock.now += 60_000
  const feed = await server.connect({ cookie })

  return {
    ...server,
    clock,
    feed,
    // The attacker tries `count` passwords, one after the other: the statuses they got.
    guess: async (count: number) => {
      const statuses: number[] = []
      for (let tried = 0; tried < count; tried++) statuses.push((await login(`guess-${tried}`)).status)
      return statuses
    },
    asOperator: (path: string) => server.request(path, { headers: { cookie } }),
  }
}

describe('a brute force on the login', () => {
  it('raises nothing on one wrong password', async () => {
    const { feed, guess, hub } = await startOutpost()

    expect(await guess(1)).toEqual([401])
    hub.broadcast(marker)

    await vi.waitFor(() => expect(feed.frames).toMatchObject([{ type: 'status' }, marker]))
  })

  it('raises a cyber Alert on the feed once the wrong passwords reach the threshold, and keeps it', async () => {
    const { asOperator, feed, guess } = await startOutpost()

    expect(await guess(THRESHOLD - 1)).toEqual(Array(THRESHOLD - 1).fill(401))
    expect(alertsOf(feed)).toEqual([])
    await guess(1)

    const raised = {
      alert_id: expect.stringMatching(/^cyber-login-/),
      // The Command Post is what is attacked: no Sentinel is named.
      sentinel: COMMAND_POST,
      source: 'api',
      kind: 'cyber',
      severity: 'warning',
      state: 'raised',
      value: THRESHOLD,
      detail: { vector: 'login', attempts: THRESHOLD, address: HERE },
      ts: new Date(START + 60_000).toISOString(),
    }
    await vi.waitFor(() => {
      expect(feed.frames.slice(1)).toEqual([
        { type: 'alert', payload: raised },
        { type: 'status', payload: { status: 'elevated', ts: expect.any(String) } },
      ])
    })
    const history = HistorySchema.parse(await (await asOperator(`/api/v1/history?${new URLSearchParams(DAY)}`)).json())
    expect(history.records).toEqual([{ type: 'alert', payload: raised }])
  })

  it('counts the logins past the limit as refusals, and raises the same Alert again with the count', async () => {
    const { feed, guess } = await startOutpost()

    // 5 logins a minute: the sixth and the seventh are turned away before their password is read.
    expect(await guess(THRESHOLD + 2)).toEqual([401, 401, 401, 401, 401, 429, 429])

    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(3))
    const alerts = alertsOf(feed)
    expect(new Set(alerts.map((alert) => alert.alert_id)).size).toBe(1)
    expect(alerts.map((alert) => alert.state)).toEqual(['raised', 'raised', 'raised'])
    expect(alerts.map((alert) => alert.value)).toEqual([THRESHOLD, THRESHOLD + 1, THRESHOLD + 2])
    expect(alerts.map((alert) => alert.detail)).toEqual(
      [THRESHOLD, THRESHOLD + 1, THRESHOLD + 2].map((attempts) => ({ vector: 'login', attempts, address: HERE })),
    )
  })

  it('clears the Alert by itself after the quiet time, without any request', async () => {
    const { clock, feed, guess } = await startOutpost()
    await guess(THRESHOLD + 1)
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(2))

    clock.now += QUIET_MS

    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(3), { timeout: 3000 })
    const [raised, , cleared] = alertsOf(feed)
    expect(cleared).toEqual({
      ...raised,
      state: 'cleared',
      value: THRESHOLD + 1,
      detail: { vector: 'login', attempts: THRESHOLD + 1, address: HERE },
      ts: new Date(clock.now).toISOString(),
    })
    // Never critical: a refused attack is not a compromised site.
    await vi.waitFor(() => expect(statusesOf(feed)).toEqual(['nominal', 'elevated', 'elevated', 'nominal']))
  })

  it('opens a new Alert, under another alert_id, when the attack resumes after the clearing', async () => {
    const { clock, feed, guess } = await startOutpost()
    await guess(THRESHOLD)
    clock.now += QUIET_MS
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(2), { timeout: 3000 })

    await guess(THRESHOLD)

    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(3))
    const [first, , second] = alertsOf(feed)
    expect(second).toMatchObject({ kind: 'cyber', state: 'raised', value: THRESHOLD })
    expect(second?.alert_id).not.toBe(first?.alert_id)
  })

  it('replays the Incident with every time the Alert was raised again, in order, each at its own instant', async () => {
    const { asOperator, clock, feed, guess } = await startOutpost()

    await guess(THRESHOLD)
    for (let again = 0; again < 3; again++) {
      clock.now += 700
      await guess(1)
    }
    clock.now += QUIET_MS
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(5), { timeout: 3000 })

    const replay = IncidentReplaySchema.parse(await (await asOperator('/api/v1/incidents/1')).json())
    const alerts = replay.records.flatMap((record) => (record.type === 'alert' ? [record.payload] : []))
    const raised = START + 60_000

    expect(alerts.map(({ state, value, ts }) => [state, value, Date.parse(ts) - raised])).toEqual([
      ['raised', THRESHOLD, 0],
      ['raised', THRESHOLD + 1, 700],
      ['raised', THRESHOLD + 2, 1400],
      ['raised', THRESHOLD + 3, 2100],
      ['cleared', THRESHOLD + 3, 2100 + QUIET_MS],
    ])
    expect(new Set(alerts.map((alert) => alert.alert_id)).size).toBe(1)
  })

  it('opens an Incident and closes it with the clearing, cyber among its kinds', async () => {
    const { asOperator, clock, feed, guess } = await startOutpost()
    const incidents = async () => IncidentsSchema.parse(await (await asOperator('/api/v1/incidents')).json()).incidents

    await guess(THRESHOLD + 1)
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(2))
    expect(await incidents()).toEqual([
      { incident_id: 1, start: expect.any(String), end: null, ongoing: true, alerts: 2, kinds: ['cyber'], peak: 'warning' },
    ])

    clock.now += QUIET_MS
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(3), { timeout: 3000 })

    expect(await incidents()).toEqual([
      {
        incident_id: 1,
        start: new Date(START + 60_000).toISOString(),
        end: new Date(clock.now).toISOString(),
        ongoing: false,
        alerts: 3,
        kinds: ['cyber'],
        peak: 'warning',
      },
    ])
  })

  it('sends no command to the Sentinel: the Alarm keeps its meaning', async () => {
    const broker = await startBroker()
    const { clock, feed, guess } = await startOutpost({ mqtt: broker.config })
    await broker.subscribed()
    const commands = await broker.subscribe('command/#')

    await guess(THRESHOLD + 1)
    clock.now += QUIET_MS
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(3), { timeout: 3000 })

    expect(commands).toEqual([])
    expect(broker.published).toEqual([])
  })

  it('raises nothing when the Operator logs in, however many times', async () => {
    const { feed, hub, request } = await startOutpost()
    const login = () =>
      request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      })

    for (let logged = 0; logged < THRESHOLD; logged++) expect((await login()).status).toBe(204)
    hub.broadcast(marker)

    await vi.waitFor(() => expect(feed.frames).toMatchObject([{ type: 'status' }, marker]))
  })
})

describe('where a brute force comes from', () => {
  const guessFrom = (request: (path: string, init?: RequestInit) => Promise<Response>, forwardedFor: string) =>
    request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
      body: JSON.stringify({ password: 'a guess' }),
    })

  // The tests reach the API from 127.0.0.1: trusting it makes them the reverse proxy.
  it('is in the detail of the Alert: the address the reverse proxy forwards', async () => {
    const { feed, request } = await startOutpost({ trustedProxy: '127.0.0.1' })

    for (let tried = 0; tried < THRESHOLD; tried++) await guessFrom(request, '192.168.4.66')

    await expect.poll(() => alertsOf(feed).at(-1)?.detail).toEqual({
      vector: 'login',
      attempts: THRESHOLD,
      address: '192.168.4.66',
    })
  })

  it('is the address of the connection when the header comes from anyone else', async () => {
    const { feed, request } = await startOutpost()

    for (let tried = 0; tried < THRESHOLD; tried++) await guessFrom(request, '192.168.4.66')

    await expect.poll(() => alertsOf(feed).at(-1)?.detail).toMatchObject({ address: HERE })
  })
})

describe('an attack on the Alerts entry', () => {
  it('raises a cyber Alert of its own once the requests without a token, or with an unknown one, reach the threshold', async () => {
    const { feed, post } = await startOutpost()
    const body = JSON.stringify(intrusionAlert())

    for (let tried = 0; tried < THRESHOLD - 1; tried++) {
      expect((await post(body, tried % 2 ? null : 'Bearer not-a-token')).status).toBe(401)
    }
    expect(alertsOf(feed)).toEqual([])
    await post(body, null)

    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(1))
    expect(alertsOf(feed)).toEqual([
      {
        alert_id: expect.stringMatching(/^cyber-service-token-/),
        sentinel: COMMAND_POST,
        source: 'api',
        kind: 'cyber',
        severity: 'warning',
        state: 'raised',
        value: THRESHOLD,
        detail: { vector: 'service-token', attempts: THRESHOLD, address: HERE },
        ts: new Date(START + 60_000).toISOString(),
      },
    ])
  })

  it('counts a valid token used for a kind that is not its own', async () => {
    const { feed, postAlert } = await startOutpost()

    for (let tried = 0; tried < THRESHOLD; tried++) {
      expect((await postAlert(intrusionAlert(), TOKEN.predictive)).status).toBe(403)
    }

    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(1))
    expect(alertsOf(feed)[0]).toMatchObject({
      alert_id: expect.stringMatching(/^cyber-service-token-/),
      state: 'raised',
      detail: { vector: 'service-token', attempts: THRESHOLD, address: HERE },
    })
  })
})

describe('an attack on the live feed', () => {
  it('raises a cyber Alert of its own once the openings from a refused origin reach the threshold', async () => {
    const { connect, feed } = await startOutpost()
    const open = () => connect({ origin: 'https://evil.example' })

    for (let tried = 0; tried < THRESHOLD - 1; tried++) await expect(open()).rejects.toThrow(/403/)
    expect(alertsOf(feed)).toEqual([])
    await expect(open()).rejects.toThrow(/403/)

    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(1))
    expect(alertsOf(feed)[0]).toMatchObject({
      alert_id: expect.stringMatching(/^cyber-feed-origin-/),
      kind: 'cyber',
      severity: 'warning',
      state: 'raised',
      value: THRESHOLD,
      detail: { vector: 'feed-origin', attempts: THRESHOLD, address: HERE },
    })
  })
})

describe('two vectors attacked at once', () => {
  it('gives two Alerts, each raised again and cleared on its own', async () => {
    const { clock, feed, guess, post } = await startOutpost()
    const forge = () => post(JSON.stringify(intrusionAlert()), 'Bearer not-a-token')
    const told = () => alertsOf(feed).map(({ alert_id, state, value }) => [alert_id.slice(0, -9), state, value])

    await guess(THRESHOLD)
    for (let tried = 0; tried < THRESHOLD; tried++) await forge()
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(2))
    expect(new Set(alertsOf(feed).map((alert) => alert.alert_id)).size).toBe(2)

    // The forged tokens go on, the guesses stop: only the login goes quiet.
    clock.now += QUIET_MS - 1000
    await forge()
    clock.now += 1000
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(4), { timeout: 3000 })
    clock.now += QUIET_MS
    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(5), { timeout: 3000 })

    expect(told()).toEqual([
      ['cyber-login', 'raised', THRESHOLD],
      ['cyber-service-token', 'raised', THRESHOLD],
      ['cyber-service-token', 'raised', THRESHOLD + 1],
      ['cyber-login', 'cleared', THRESHOLD],
      ['cyber-service-token', 'cleared', THRESHOLD + 1],
    ])
    const [login, token, tokenAgain, loginCleared, tokenCleared] = alertsOf(feed)
    expect([loginCleared?.alert_id, tokenAgain?.alert_id, tokenCleared?.alert_id]).toEqual([
      login?.alert_id,
      token?.alert_id,
      token?.alert_id,
    ])
  })
})

describe('what is no attack', () => {
  it('counts no request without a session on a protected route: an expired tab sends them', async () => {
    const { connect, feed, hub, request } = await startOutpost()

    for (let tried = 0; tried < THRESHOLD + 1; tried++) {
      expect((await request(`/api/v1/history?${new URLSearchParams(DAY)}`)).status).toBe(401)
      expect((await request('/api/v1/commands', { method: 'POST' })).status).toBe(401)
      await expect(connect()).rejects.toThrow(/401/)
    }
    hub.broadcast(marker)

    await vi.waitFor(() => expect(feed.frames).toMatchObject([{ type: 'status' }, marker]))
  })

  it('raises nothing when the AI services post their Alerts, however many', async () => {
    const { feed, postAlert } = await startOutpost()

    for (let posted = 0; posted < THRESHOLD; posted++) {
      const state = posted % 2 ? 'cleared' : 'raised'
      expect((await postAlert(intrusionAlert({ state }))).status).toBe(202)
      expect((await postAlert(predictiveAlert({ state }))).status).toBe(202)
    }

    await vi.waitFor(() => expect(alertsOf(feed)).toHaveLength(THRESHOLD * 2))
    expect(alertsOf(feed).map((alert) => alert.kind)).not.toContain('cyber')
  })
})
