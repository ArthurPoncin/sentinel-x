import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws'
import type { Frame } from '@/shared/contract'
import { connectFeed, type ConnectionState, type FeedEvent } from './feed-client'

const ts = '2026-10-05T14:23:00.000Z'
const nominal: Frame = { type: 'status', payload: { status: 'nominal', ts } }
const elevated: Frame = { type: 'status', payload: { status: 'elevated', ts } }

// Fast retries so a dropped connection comes back within the test.
const backoff = { initialDelayMs: 10, maxDelayMs: 40 }

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// A stand-in for the Command Post feed: `onConnection` plays the server side of each connection.
async function startCommandPost(onConnection: (socket: ServerSocket, count: number) => void, port = 0) {
  const server = new WebSocketServer({ host: '127.0.0.1', port })
  let count = 0
  server.on('connection', (socket) => onConnection(socket, ++count))
  await once(server, 'listening')
  let stopped: Promise<unknown> | undefined
  const stop = () => {
    for (const client of server.clients) client.terminate()
    stopped ??= new Promise((resolve) => server.close(resolve))
    return stopped
  }
  cleanups.push(stop)
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, stop }
}

function listen(url: string, options = {}) {
  const events: FeedEvent[] = []
  const stop = connectFeed(url, (event) => events.push(event), { ...backoff, ...options })
  cleanups.push(stop)
  return {
    stop,
    frames: () => events.filter((event): event is Frame => event.type !== 'connection'),
    connection: (): ConnectionState[] =>
      events.flatMap((event) => (event.type === 'connection' ? [event.state] : [])),
  }
}

describe('connectFeed', () => {
  it('streams every frame the Command Post sends once the connection opens', async () => {
    const { url } = await startCommandPost((socket) => {
      socket.send(JSON.stringify(nominal))
      socket.send(JSON.stringify(elevated))
    })

    const feed = listen(url)

    await vi.waitFor(() => expect(feed.frames()).toEqual([nominal, elevated]))
    expect(feed.connection()).toEqual(['connecting', 'open'])
  })

  it('drops malformed frames without breaking the stream', async () => {
    const { url } = await startCommandPost((socket) => {
      socket.send('not json')
      socket.send(JSON.stringify({ type: 'telemetry', payload: {} }))
      socket.send(JSON.stringify({ type: 'unknown', payload: {} }))
      socket.send(JSON.stringify(elevated))
    })
    const onMalformed = vi.fn()

    const feed = listen(url, { onMalformed })

    await vi.waitFor(() => expect(feed.frames()).toEqual([elevated]))
    expect(onMalformed).toHaveBeenCalledTimes(3)
  })

  it('reconnects after the connection drops and resumes the stream', async () => {
    const { url } = await startCommandPost((socket, count) => {
      socket.send(JSON.stringify(count === 1 ? nominal : elevated))
      if (count === 1) socket.terminate()
    })

    const feed = listen(url)

    await vi.waitFor(() => expect(feed.frames()).toEqual([nominal, elevated]))
    expect(feed.connection()).toEqual(['connecting', 'open', 'closed', 'connecting', 'open'])
  })

  it('keeps retrying while the Command Post is down, then reconnects', async () => {
    const first = await startCommandPost(() => {})
    const feed = listen(first.url)
    await vi.waitFor(() => expect(feed.connection()).toContain('open'))

    await first.stop()
    // Several attempts fail while nothing listens.
    await vi.waitFor(() =>
      expect(feed.connection().filter((state) => state === 'closed').length).toBeGreaterThan(2),
    )
    await startCommandPost((socket) => socket.send(JSON.stringify(elevated)), Number(new URL(first.url).port))

    await vi.waitFor(() => expect(feed.frames()).toEqual([elevated]))
    expect(feed.connection().at(-1)).toBe('open')
  })

  it('stops for good once disconnected', async () => {
    const connections = vi.fn()
    const { url } = await startCommandPost(connections)
    const feed = listen(url)
    await vi.waitFor(() => expect(feed.connection()).toContain('open'))

    feed.stop()
    await new Promise((resolve) => setTimeout(resolve, 5 * backoff.maxDelayMs))

    expect(connections).toHaveBeenCalledOnce()
    expect(feed.connection()).toEqual(['connecting', 'open'])
  })
})
