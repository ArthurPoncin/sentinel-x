import { beforeAll, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/auth.js'
import { type Alert, COMMAND_POST, type Frame, HistorySchema, IncidentsSchema } from '../src/contract.js'
import { QUIET_MS, THRESHOLD } from '../src/cyber-watch.js'
import { startBroker } from './support/broker.js'
import { startServer } from './support/server.js'
import type { TestClient } from './support/ws-client.js'

vi.spyOn(console, 'log').mockImplementation(() => {})

const PASSWORD = 'correct horse battery staple'
let passwordHash: string
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

const START = Date.parse('2026-10-05T14:23:00Z')
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
      detail: { vector: 'login', attempts: THRESHOLD },
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
      [THRESHOLD, THRESHOLD + 1, THRESHOLD + 2].map((attempts) => ({ vector: 'login', attempts })),
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
      detail: { vector: 'login', attempts: THRESHOLD + 1 },
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
