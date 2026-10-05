import { describe, expect, it } from 'vitest'
import { createRateLimit } from '../src/rate-limit.js'
import { intrusionAlert, predictiveAlert } from './support/alerts.js'
import { startServer, TOKEN } from './support/server.js'

describe('rate limit', () => {
  it('lets `limit` requests through per window, then says how long to wait', () => {
    let now = 0
    const limit = createRateLimit(2, 1000, () => now)

    expect([limit.take('a'), limit.take('a'), limit.take('a')]).toEqual([0, 0, 1000])
    now = 400
    expect(limit.take('a')).toBe(600)
    now = 1000
    expect(limit.take('a')).toBe(0)
  })

  it('counts each key on its own', () => {
    const limit = createRateLimit(1, 1000, () => 0)

    expect([limit.take('vision'), limit.take('predictive'), limit.take('vision')]).toEqual([0, 0, 1000])
  })
})

// Sends `count` requests at once and returns their statuses, in order.
const statuses = async (count: number, send: (index: number) => Promise<Response>) =>
  (await Promise.all(Array.from({ length: count }, (_, index) => send(index)))).map((response) => response.status)

describe('API rate limits', () => {
  it('429 past 20 Alerts a second for one token, with Retry-After; the other service is not held back', async () => {
    const { postAlert } = await startServer()

    const burst = await statuses(21, (index) => postAlert(intrusionAlert({ alert_id: `intruder-${index}` })))

    expect(burst.filter((status) => status === 202)).toHaveLength(20)
    expect(burst.filter((status) => status === 429)).toHaveLength(1)
    const refused = await postAlert(intrusionAlert())
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect((await postAlert(predictiveAlert(), TOKEN.predictive)).status).toBe(202)
  })

  it('429 past 2 commands a second', async () => {
    const { postCommand } = await startServer()
    const command = { sentinel: 'sentinel-01', actuator: 'buzzer', action: 'on' }

    // No broker here: the two let through end on 503, the third never gets that far.
    expect(await statuses(3, () => postCommand(command))).toEqual(expect.arrayContaining([503, 503, 429]))
  })

  it('429 past 5 logins a minute from one address, even with the right password', async () => {
    const { request } = await startServer()
    const login = () =>
      request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'a guess' }),
      })

    const attempts = await statuses(6, login)

    expect(attempts.filter((status) => status === 429)).toHaveLength(1)
    expect((await login()).headers.get('retry-after')).toMatch(/^[1-6]?\d$/)
  })
})
