import { describe, expect, it, vi } from 'vitest'
import { type Frame, FrameSchema, type StatusLevel } from '../src/contract.js'
import { startServer } from './support/server.js'

function telemetryFrame(air: number): Frame {
  return {
    type: 'telemetry',
    payload: {
      sentinel: 'sentinel-01',
      ts: '2026-10-05T14:23:00Z',
      readings: { temp: 31.2, humidity: 44, air, pir: false, accel: { x: 0.01, y: -0.02, z: 0.98 } },
    },
  }
}

function statusFrame(status: StatusLevel): Frame {
  return { type: 'status', payload: { status, ts: '2026-10-05T14:23:05Z' } }
}

describe('live feed on /ws', () => {
  it('delivers every broadcast frame to every connected client', async () => {
    const { hub, connect } = await startServer()
    const dashboard = await connect()
    const twin = await connect()

    hub.broadcast(telemetryFrame(420))
    hub.broadcast(statusFrame('elevated'))

    await vi.waitFor(() => {
      for (const client of [dashboard, twin]) {
        expect(client.frames.slice(-2)).toEqual([telemetryFrame(420), statusFrame('elevated')])
      }
    })
  })

  it('keeps feeding the remaining clients after one disconnects', async () => {
    const { hub, connect } = await startServer()
    const dashboard = await connect()
    const twin = await connect()

    hub.broadcast(telemetryFrame(180))
    await vi.waitFor(() => expect(twin.frames.at(-1)).toEqual(telemetryFrame(180)))
    twin.close()
    hub.broadcast(telemetryFrame(420))
    hub.broadcast(telemetryFrame(700))

    await vi.waitFor(() => {
      expect(dashboard.frames.slice(-3)).toEqual([telemetryFrame(180), telemetryFrame(420), telemetryFrame(700)])
    })
  })

  it('greets a client joining mid-stream with the current Status and the latest telemetry', async () => {
    const { hub, connect } = await startServer()
    hub.broadcast(telemetryFrame(180))
    hub.broadcast(statusFrame('critical'))
    hub.broadcast(telemetryFrame(700))

    const late = await connect()

    await vi.waitFor(() => expect(late.frames).toEqual([statusFrame('critical'), telemetryFrame(700)]))
  })

  it('greets a client with a nominal Status while nothing has happened yet', async () => {
    const { connect } = await startServer()

    const client = await connect()

    await vi.waitFor(() => expect(client.frames).toHaveLength(1))
    const greeting = FrameSchema.parse(client.frames[0])
    expect(greeting).toMatchObject({ type: 'status', payload: { status: 'nominal' } })
  })
})

describe('mock feed toggle', () => {
  it('streams the scripted scenario to clients when enabled', async () => {
    const { connect } = await startServer({ mockFeed: { intervalMs: 1 } })

    const client = await connect()

    await vi.waitFor(() => {
      // Parsing doubles as the check that everything on the wire honours the contract.
      const frames = client.frames.map((frame) => FrameSchema.parse(frame))
      const statuses = frames.flatMap((frame) => (frame.type === 'status' ? [frame.payload.status] : []))
      expect(statuses.join(' → ')).toContain('elevated → critical → nominal')
      expect(frames.filter((frame) => frame.type === 'telemetry').length).toBeGreaterThan(10)
    })
  })

  it('sends nothing beyond the greeting when disabled', async () => {
    const { connect } = await startServer({ mockFeed: false })

    const client = await connect()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(client.frames).toHaveLength(1)
  })
})
