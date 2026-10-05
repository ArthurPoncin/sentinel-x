import { describe, expect, it, vi } from 'vitest'
import type { Frame } from '../src/contract.js'
import { gasAlert, intrusionAlert, predictiveAlert } from './support/alerts.js'
import { startServer } from './support/server.js'

const marker: Frame = {
  type: 'telemetry',
  payload: {
    sentinel: 'sentinel-01',
    ts: '2026-10-05T14:23:00Z',
    readings: { temp: 31.2, humidity: 44, air: 180, pir: false, accel: { x: 0.01, y: -0.02, z: 0.98 } },
  },
}

const nominal = { type: 'status', payload: { status: 'nominal' } }

describe('POST /api/v1/alerts', () => {
  it('answers 202 and broadcasts the Alert, then the Status, to every client', async () => {
    const { connect, postAlert } = await startServer()
    const dashboard = await connect()
    const twin = await connect()

    const response = await postAlert(intrusionAlert())

    expect(response.status).toBe(202)
    await vi.waitFor(() => {
      for (const client of [dashboard, twin]) {
        expect(client.frames.slice(1)).toMatchObject([
          { type: 'alert', payload: intrusionAlert() },
          { type: 'status', payload: { status: 'critical' } },
        ])
      }
    })
  })

  it('accepts each AI service on its own kind', async () => {
    const { connect, postAlert } = await startServer()
    const client = await connect()

    const responses = [await postAlert(intrusionAlert()), await postAlert(predictiveAlert())]

    expect(responses.map((response) => response.status)).toEqual([202, 202])
    await vi.waitFor(() => {
      const sources = client.frames.flatMap((frame) => {
        const { type, payload } = frame as Frame
        return type === 'alert' ? [payload.source] : []
      })
      expect(sources).toEqual(['vision', 'predictive'])
    })
  })

  it('brings the Status back to nominal once the Alert is cleared', async () => {
    const { connect, postAlert } = await startServer()
    const client = await connect()

    await postAlert(intrusionAlert())
    await postAlert(intrusionAlert({ state: 'cleared' }))

    await vi.waitFor(() => {
      expect(client.frames.slice(1)).toMatchObject([
        { type: 'alert', payload: { alert_id: 'intruder-1', state: 'raised' } },
        { type: 'status', payload: { status: 'critical' } },
        { type: 'alert', payload: { alert_id: 'intruder-1', state: 'cleared' } },
        { type: 'status', payload: { status: 'nominal' } },
      ])
    })
  })

  it('greets a client joining during an Alert with the Status it led to', async () => {
    const { connect, postAlert } = await startServer()
    await postAlert(intrusionAlert())

    const late = await connect()

    await vi.waitFor(() => {
      expect(late.frames).toMatchObject([{ type: 'status', payload: { status: 'critical' } }])
    })
  })

  describe('refuses, broadcasts nothing and leaves the Status alone', () => {
    // A refused body must reach no client and must not move the Status: the next frame a
    // client sees is the marker, and a client joining afterwards is still greeted nominal.
    async function expectNothingChanged(send: (server: Awaited<ReturnType<typeof startServer>>) => Promise<Response>) {
      const server = await startServer()
      const client = await server.connect()

      const response = await send(server)
      server.hub.broadcast(marker)

      await vi.waitFor(() => expect(client.frames).toMatchObject([nominal, marker]))
      const late = await server.connect()
      await vi.waitFor(() => expect(late.frames).toMatchObject([nominal, marker]))
      return response
    }

    it.each([
      ['an unknown field', { ...intrusionAlert(), firmware: '1.0.0' }],
      ['a missing field', { ...intrusionAlert(), alert_id: undefined }],
      ['a severity the contract does not define', { ...intrusionAlert(), severity: 'elevated' }],
      ['a detail that is not the one of its kind', { ...intrusionAlert(), detail: {} }],
      ['a timestamp that is not ISO 8601', { ...intrusionAlert(), ts: '05/10/2026 14:23' }],
      ['no declared source', { ...intrusionAlert(), source: undefined }],
      ['a list of Alerts', [intrusionAlert()]],
    ])('400 on %s', async (_label, body) => {
      const response = await expectNothingChanged(({ postAlert }) => postAlert(body))

      expect(response.status).toBe(400)
    })

    it('400 on a body that is not JSON', async () => {
      const response = await expectNothingChanged(({ post }) => post('{"alert_id": '))

      expect(response.status).toBe(400)
    })

    it('400 names the field it cannot make sense of', async () => {
      const response = await expectNothingChanged(({ postAlert }) =>
        postAlert({ ...intrusionAlert(), severity: 'elevated' }),
      )

      expect(await response.json()).toMatchObject({ statusCode: 400, message: expect.stringContaining('severity') })
    })

    it('403 on a kind the service does not own', async () => {
      const response = await expectNothingChanged(({ postAlert }) =>
        postAlert({ ...predictiveAlert(), source: 'vision' }),
      )

      expect(response.status).toBe(403)
    })

    it('403 on a Sentinel Alert, which only comes in over MQTT', async () => {
      const response = await expectNothingChanged(({ postAlert }) => postAlert(gasAlert()))

      expect(response.status).toBe(403)
    })

    it('413 on a body above 16 KB', async () => {
      const response = await expectNothingChanged(({ postAlert }) =>
        postAlert(intrusionAlert({ alert_id: 'x'.repeat(16 * 1024) })),
      )

      expect(response.status).toBe(413)
    })
  })
})
