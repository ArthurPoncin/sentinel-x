import { describe, expect, it, vi } from 'vitest'
import { HealthSchema } from '../src/contract.js'
import { startBroker } from './support/broker.js'
import { startServer } from './support/server.js'

vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('GET /health', () => {
  it('answers ok when the API runs without a broker', async () => {
    const { getHealth } = await startServer()

    const response = await getHealth()

    expect(response.status).toBe(200)
    expect(HealthSchema.parse(await response.json())).toEqual({ status: 'ok', broker: 'off' })
  })

  it('answers ok once the API is connected to its broker', async () => {
    const broker = await startBroker()
    const { getHealth } = await startServer({ mqtt: broker.config })
    await broker.subscribed()

    const response = await getHealth()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', broker: 'connected' })
  })

  it('answers degraded with a 503 while the broker is out of reach, and ok once it is back', async () => {
    const broker = await startBroker()
    const { getHealth } = await startServer({ mqtt: broker.config })
    await broker.subscribed()

    await broker.stop()
    await vi.waitFor(async () => {
      const response = await getHealth()
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ status: 'degraded', broker: 'disconnected' })
    })

    await broker.start()
    await vi.waitFor(
      async () => {
        const response = await getHealth()
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ status: 'ok', broker: 'connected' })
      },
      { timeout: 5000 },
    )
  })

  it('answers degraded while the broker refuses the login', async () => {
    const broker = await startBroker()
    const { getHealth } = await startServer({ mqtt: { ...broker.config, password: 'wrong' } })

    const response = await getHealth()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'degraded', broker: 'disconnected' })
  })
})
