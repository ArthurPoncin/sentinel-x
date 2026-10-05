import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Frame, Telemetry } from '../src/contract.js'
import { startBroker, strangerCaFile } from './support/broker.js'
import { startServer } from './support/server.js'
import type { TestClient } from './support/ws-client.js'

// The ingress reports to the console: keep the test output clean, and let tests read what it said.
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'log').mockImplementation(() => {})
beforeEach(() => warn.mockClear())

const TOPIC = 'sentinel/sentinel-01/telemetry'

function snapshot(air = 180): Telemetry {
  return {
    sentinel: 'sentinel-01',
    ts: '2026-10-05T14:23:00Z',
    readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 1350 },
  }
}

function telemetryFrame(air?: number): Frame {
  return { type: 'telemetry', payload: snapshot(air) }
}

const nominal = { type: 'status', payload: { status: 'nominal' } }

// Everything a client received after the Status it was greeted with.
function feed(client: TestClient) {
  return client.frames.slice(1)
}

// The API subscribed to a running broker, ready for a Sentinel to publish.
async function startOutpost() {
  const broker = await startBroker()
  const server = await startServer({ mqtt: broker.config })
  await broker.subscribed()
  return { broker, ...server }
}

describe('Sentinel telemetry over MQTTS', () => {
  it('broadcasts a published snapshot as a telemetry frame to every client', async () => {
    const { broker, connect } = await startOutpost()
    const dashboard = await connect()
    const twin = await connect()

    await broker.publish(TOPIC, JSON.stringify(snapshot(420)))

    await vi.waitFor(() => {
      for (const client of [dashboard, twin]) expect(feed(client)).toEqual([telemetryFrame(420)])
    })
  })

  it('subscribes to the telemetry and Alerts of every Sentinel, and to nothing else', async () => {
    const { broker } = await startOutpost()

    await vi.waitFor(() => expect(broker.subscriptions).toEqual(['sentinel/+/telemetry', 'sentinel/+/alert']))
  })

  it('names the Sentinel after the topic, whatever the payload claims', async () => {
    const { broker, connect } = await startOutpost()
    const client = await connect()
    const { sentinel: _omitted, ...unsigned } = snapshot()

    await broker.publish('sentinel/sentinel-01/telemetry', JSON.stringify({ ...snapshot(), sentinel: 'sentinel-99' }))
    await broker.publish('sentinel/sentinel-02/telemetry', JSON.stringify(snapshot()))
    await broker.publish('sentinel/sentinel-03/telemetry', JSON.stringify(unsigned))

    await vi.waitFor(() => {
      expect(feed(client)).toMatchObject([
        { type: 'telemetry', payload: { sentinel: 'sentinel-01' } },
        { type: 'telemetry', payload: { sentinel: 'sentinel-02' } },
        { type: 'telemetry', payload: { sentinel: 'sentinel-03' } },
      ])
    })
  })

  describe('drops a malformed payload and keeps listening', () => {
    it.each([
      ['a payload that is not JSON', '{"ts": '],
      ['an empty payload', ''],
      ['a list of snapshots', JSON.stringify([snapshot()])],
      ['a missing Reading', JSON.stringify({ ...snapshot(), readings: { ...snapshot().readings, air: undefined } })],
      ['a Reading of the wrong type', JSON.stringify({ ...snapshot(), readings: { ...snapshot().readings, air: '180' } })],
      ['an unknown field', JSON.stringify({ ...snapshot(), firmware: '1.0.0' })],
      ['a timestamp that is not ISO 8601', JSON.stringify({ ...snapshot(), ts: '05/10/2026 14:23' })],
    ])('%s', async (_label, payload) => {
      const { broker, connect } = await startOutpost()
      const client = await connect()

      await broker.publish(TOPIC, payload)
      await broker.publish(TOPIC, JSON.stringify(snapshot(420)))

      // The next snapshot gets through, and the dropped one never reached anybody.
      await vi.waitFor(() => expect(client.frames).toMatchObject([nominal, telemetryFrame(420)]))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`dropped a message on ${TOPIC}`))
    })

    it('says which field it cannot make sense of', async () => {
      const { broker } = await startOutpost()

      await broker.publish(TOPIC, JSON.stringify({ ...snapshot(), readings: { ...snapshot().readings, air: '180' } }))

      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('readings.air')))
    })
  })

  describe('when the broker is away', () => {
    it('picks the feed up again once the broker is back', { timeout: 15_000 }, async () => {
      const { broker, connect } = await startOutpost()
      const client = await connect()
      await broker.publish(TOPIC, JSON.stringify(snapshot(180)))
      await vi.waitFor(() => expect(feed(client)).toEqual([telemetryFrame(180)]))

      await broker.stop()
      await broker.start()
      await broker.subscribed()
      await broker.publish(TOPIC, JSON.stringify(snapshot(420)))

      await vi.waitFor(() => expect(feed(client)).toEqual([telemetryFrame(180), telemetryFrame(420)]))
    })

    it('starts without the broker and joins it when it comes up', { timeout: 15_000 }, async () => {
      const broker = await startBroker()
      await broker.stop()
      const { connect } = await startServer({ mqtt: broker.config })
      const client = await connect()
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED')))

      await broker.start()
      await broker.subscribed()
      await broker.publish(TOPIC, JSON.stringify(snapshot(420)))

      await vi.waitFor(() => expect(feed(client)).toEqual([telemetryFrame(420)]))
    })
  })

  describe('does not listen to a broker it cannot trust or log in to', () => {
    it('turns away a broker whose certificate the team CA did not sign', async () => {
      const broker = await startBroker()

      await startServer({ mqtt: { ...broker.config, caFile: await strangerCaFile() } })

      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringMatching(/certificate/i)))
      expect(broker.subscriptions).toEqual([])
    })

    it('reports a login the broker refuses, and stays up', async () => {
      const broker = await startBroker()

      const { connect } = await startServer({ mqtt: { ...broker.config, password: 'not-the-password' } })

      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('Connection refused')))
      expect(broker.subscriptions).toEqual([])
      const client = await connect()
      await vi.waitFor(() => expect(client.frames).toMatchObject([nominal]))
    })
  })
})
