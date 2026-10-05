import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Alert, Frame } from '../src/contract.js'
import { gasAlert, intrusionAlert, presenceAlert } from './support/alerts.js'
import { startBroker } from './support/broker.js'
import { startServer } from './support/server.js'
import type { TestClient } from './support/ws-client.js'

// The ingress reports to the console: keep the test output clean, and let tests read what it said.
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'log').mockImplementation(() => {})
beforeEach(() => warn.mockClear())

const TOPIC = 'sentinel/sentinel-01/alert'

// An Alert as the Sentinel publishes it: the channel names the source and the Sentinel.
function asPublished({ source: _source, sentinel: _sentinel, ...payload }: Alert) {
  return payload
}

// A gas Alert, as published.
function published(overrides = {}) {
  return asPublished(gasAlert(overrides))
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

describe('Sentinel Alerts over MQTTS', () => {
  it('broadcasts a published Alert, then the Status it leads to, to every client', async () => {
    const { broker, connect } = await startOutpost()
    const dashboard = await connect()
    const twin = await connect()

    await broker.publish(TOPIC, JSON.stringify(published()))

    await vi.waitFor(() => {
      for (const client of [dashboard, twin]) {
        expect(feed(client)).toEqual([
          { type: 'alert', payload: gasAlert() },
          { type: 'status', payload: { status: 'elevated', ts: expect.any(String) } },
        ])
      }
    })
  })

  it('sets the source to esp32 and names the Sentinel after the topic, whatever the payload claims', async () => {
    const { broker, connect } = await startOutpost()
    const client = await connect()

    await broker.publish(TOPIC, JSON.stringify({ ...published(), sentinel: 'sentinel-99', source: 'vision' }))
    await broker.publish('sentinel/sentinel-02/alert', JSON.stringify(published({ alert_id: 'gas-2' })))

    await vi.waitFor(() => {
      const alerts = client.frames.filter((frame) => (frame as Frame).type === 'alert')
      expect(alerts).toMatchObject([
        { payload: { sentinel: 'sentinel-01', source: 'esp32' } },
        { payload: { sentinel: 'sentinel-02', source: 'esp32' } },
      ])
    })
  })

  it('shares the Status with the Alerts posted over HTTP', async () => {
    const { broker, connect, postAlert } = await startOutpost()
    const client = await connect()

    await broker.publish(TOPIC, JSON.stringify(published()))
    await vi.waitFor(() => expect(feed(client)).toHaveLength(2))
    await postAlert(intrusionAlert())
    await postAlert(intrusionAlert({ state: 'cleared' }))
    await broker.publish(TOPIC, JSON.stringify(published({ state: 'cleared' })))

    await vi.waitFor(() => {
      const statuses = client.frames.flatMap((frame) => {
        const { type, payload } = frame as Frame
        return type === 'status' ? [payload.status] : []
      })
      // Greeted nominal; the gas warning, the intruder on top, the intruder gone, the gas gone.
      expect(statuses).toEqual(['nominal', 'elevated', 'critical', 'elevated', 'nominal'])
    })
  })

  it('records the Alert in the history', async () => {
    const { broker, connect, getHistory } = await startOutpost()
    const client = await connect()

    await broker.publish(TOPIC, JSON.stringify(published()))
    await vi.waitFor(() => expect(feed(client)).toHaveLength(2))

    const response = await getHistory({ from: '2026-10-05T00:00:00Z', to: '2026-10-06T00:00:00Z' })
    expect(await response.json()).toMatchObject({ records: [{ type: 'alert', payload: gasAlert() }] })
  })

  it.each([
    ['a noise Alert', { ...published({ alert_id: 'noise-1' }), kind: 'noise', value: 0.7 }],
    ['a presence Alert', asPublished(presenceAlert())],
  ])('takes %s from the Sentinel', async (_label, payload) => {
    const { broker, connect } = await startOutpost()
    const client = await connect()

    await broker.publish(TOPIC, JSON.stringify(payload))

    await vi.waitFor(() => expect(feed(client)[0]).toMatchObject({ type: 'alert', payload }))
  })

  describe('drops a malformed payload and keeps listening', () => {
    it.each([
      ['a payload that is not JSON', '{"kind": '],
      ['an empty payload', ''],
      ['a list of Alerts', JSON.stringify([published()])],
      ['an unknown kind', JSON.stringify({ ...published(), kind: 'flood' })],
      ['the detail of another kind', JSON.stringify({ ...published(), detail: { anomaly_score: 0.9 } })],
      ['an unknown field', JSON.stringify({ ...published(), firmware: '1.0.0' })],
      ['a kind only the vision service decides', JSON.stringify(asPublished(intrusionAlert()))],
    ])('%s', async (_label, payload) => {
      const { broker, connect } = await startOutpost()
      const client = await connect()

      await broker.publish(TOPIC, payload)
      await broker.publish(TOPIC, JSON.stringify(published()))

      // The next Alert gets through, and the dropped one never reached anybody.
      await vi.waitFor(() => {
        expect(client.frames).toMatchObject([nominal, { type: 'alert', payload: gasAlert() }, { type: 'status' }])
      })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`dropped a message on ${TOPIC}`))
    })
  })
})
