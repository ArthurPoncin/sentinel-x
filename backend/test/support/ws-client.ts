import { once } from 'node:events'
import WebSocket from 'ws'

export interface TestClient {
  // Every frame received so far, oldest first.
  readonly frames: unknown[]
  close(): void
}

// Rejects when the server turns the upgrade down, with its status in the message.
export async function connectClient(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
  const frames: unknown[] = []
  const socket = new WebSocket(url, { headers })
  // Listen before the handshake completes so the frames sent on connect are not missed.
  socket.on('message', (data) => frames.push(JSON.parse(data.toString())))
  await once(socket, 'open')
  return { frames, close: () => socket.close() }
}
