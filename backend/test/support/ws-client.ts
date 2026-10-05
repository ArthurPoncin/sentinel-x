import { once } from 'node:events'
import WebSocket from 'ws'

export interface TestClient {
  // Every frame received so far, oldest first.
  readonly frames: unknown[]
  close(): void
}

export async function connectClient(url: string): Promise<TestClient> {
  const frames: unknown[] = []
  const socket = new WebSocket(url)
  // Listen before the handshake completes so the frames sent on connect are not missed.
  socket.on('message', (data) => frames.push(JSON.parse(data.toString())))
  await once(socket, 'open')
  return { frames, close: () => socket.close() }
}
