import { WebSocketServer } from 'ws'
import { type Hand, type HandFrame, MAX_FRAMES_PER_SECOND, PROTOCOL_VERSION } from './protocol.js'

export interface HandServer {
  // Sends a frame of tracking to every dashboard listening, unless one went out too little ago.
  publish(hands: Hand[]): void
  close(): Promise<void>
}

// Serves the Operator's hands to the dashboards open on this machine, and to them alone: it listens on the
// loopback address only, sends and never reads. Whoever connects gets the frames as they come.
export function serveHands(port: number, now: () => number = Date.now): Promise<HandServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port })
    let last = 0

    server.once('error', reject)
    server.once('listening', () => {
      server.off('error', reject)
      resolve({
        publish(hands) {
          const at = now()
          if (at - last < 1000 / MAX_FRAMES_PER_SECOND) return
          last = at
          if (server.clients.size === 0) return
          const frame: HandFrame = { v: PROTOCOL_VERSION, hands }
          const text = JSON.stringify(frame)
          for (const client of server.clients) {
            if (client.readyState === client.OPEN) client.send(text)
          }
        },
        close: () =>
          new Promise((done) => {
            for (const client of server.clients) client.terminate()
            server.close(() => done())
          }),
      })
    })
  })
}
