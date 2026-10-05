import type { Frame } from './contract.js'

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

  return {
    connect(client) {
      clients.add(client)
      return () => clients.delete(client)
    },
    broadcast(frame) {
      const data = JSON.stringify(frame)
      for (const client of clients) client.send(data)
    },
  }
}
