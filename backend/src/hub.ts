import type { Frame } from './contract.js'

type FrameOf<T extends Frame['type']> = Extract<Frame, { type: T }>

export interface FeedClient {
  send(data: string): void
}

export interface Hub {
  // Registers a client and returns the function that removes it.
  connect(client: FeedClient): () => void
  broadcast(frame: Frame): void
}

// Fans every frame out to all connected clients (the dashboard and the Digital Twin alike).
export function createHub(): Hub {
  const clients = new Set<FeedClient>()
  // What a client joining now needs to render before the next frame arrives.
  // With no Alert seen yet, the Outpost is nominal.
  const snapshot: { status: FrameOf<'status'>; telemetry?: FrameOf<'telemetry'> } = {
    status: { type: 'status', payload: { status: 'nominal', ts: new Date().toISOString() } },
  }

  return {
    connect(client) {
      for (const frame of [snapshot.status, snapshot.telemetry]) {
        if (frame) client.send(JSON.stringify(frame))
      }
      clients.add(client)
      return () => clients.delete(client)
    },
    broadcast(frame) {
      if (frame.type === 'status') snapshot.status = frame
      if (frame.type === 'telemetry') snapshot.telemetry = frame
      const data = JSON.stringify(frame)
      for (const client of clients) client.send(data)
    },
  }
}
