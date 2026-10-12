import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from 'selfsigned'
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
// The pentest script lives in the security dossier, a dependency-free Node module the team runs as is.
import { bruteForceLogin } from '../../cyber/brute-login.mjs'
import { hashPassword } from '../src/auth.js'
import type { Alert, Frame } from '../src/contract.js'
import { startServer } from './support/server.js'
import type { TestClient } from './support/ws-client.js'

const ec = { keyType: 'ec', algorithm: 'sha256' } as const

// A team CA and the TLS server certificate it signs, as the reverse proxy in front of the API has.
async function createPki() {
  const ca = await generate([{ name: 'commonName', value: 'Sentinel-X team CA' }], {
    ...ec,
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, critical: true },
    ],
  })
  const proxy = await generate([{ name: 'commonName', value: 'command-post' }], {
    ...ec,
    ca: { key: ca.private, cert: ca.cert },
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', serverAuth: true },
      // The script reaches the Command Post by IP, like the demo laptop does.
      { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
    ],
  })
  return { caCert: ca.cert, key: proxy.private, cert: proxy.cert }
}

// Writes the CA to a file the script can read, cleaned up when the test ends.
async function caFileOf(pem: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sentinel-x-pentest-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'team-ca.crt')
  await writeFile(file, pem)
  return file
}

// An HTTPS endpoint, certificate signed by the team CA, that refuses every login 401: enough for
// the script's TLS handling without the whole API behind a real reverse proxy.
async function startTlsLogin() {
  const { caCert, key, cert } = await createPki()
  const server = createServer({ key, cert }, (request, response) => {
    request.resume()
    request.on('end', () => response.writeHead(401).end())
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(() => {
    server.close()
  })
  return { target: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, caFile: await caFileOf(caCert) }
}

vi.spyOn(console, 'log').mockImplementation(() => {})

const PASSWORD = 'correct horse battery staple'
let passwordHash: string
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

function cyberAlerts(client: TestClient): Alert[] {
  return client.frames.flatMap((frame) => {
    const { type, payload } = frame as Frame
    return type === 'alert' && payload.kind === 'cyber' ? [payload] : []
  })
}

// A Command Post the Operator is logged into, watching the feed, on the real clock: the script
// hammers the login over the wire, so the cyber watch must count the refusals in real time.
async function startOutpost() {
  const server = await startServer({ operatorAuth: { passwordHash } })
  const [cookie = ''] = (
    (
      await server.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      })
    ).headers.get('set-cookie') ?? ''
  ).split(';')
  const feed = await server.connect({ cookie })
  return { ...server, feed }
}

describe('a measured brute force on the login', () => {
  it('raises a cyber Alert on the feed in under two seconds against the local stack', async () => {
    const { feed, origin } = await startOutpost()

    const running = bruteForceLogin({ target: origin, ratePerSec: 20, durationMs: 1500 })

    await vi.waitFor(() => expect(cyberAlerts(feed).length).toBeGreaterThan(0), { timeout: 2000, interval: 25 })
    expect(cyberAlerts(feed)[0]).toMatchObject({ kind: 'cyber', detail: { vector: 'login' } })

    // It stops by itself: the promise resolves without anyone telling it to.
    await running
  })

  it('reports how many attempts it sent and how many were refused 401 and 429', async () => {
    const { origin } = await startOutpost()

    const summary = await bruteForceLogin({ target: origin, ratePerSec: 20, durationMs: 1000 })

    // Every attempt the local stack answered falls into one bucket, none left over.
    expect(summary.attempts).toBe(summary.refused401 + summary.refused429 + summary.other)
    expect(summary.other).toBe(0)
    // The first wrong passwords are read and refused 401; past 5/min the rest are turned away 429.
    expect(summary.refused401).toBeGreaterThan(0)
    expect(summary.refused429).toBeGreaterThan(0)
  })

  it('stops after the set duration, having sent about rate times duration attempts', async () => {
    const { origin } = await startOutpost()

    const startedAt = Date.now()
    const summary = await bruteForceLogin({ target: origin, ratePerSec: 10, durationMs: 1000 })
    const elapsed = Date.now() - startedAt

    // It ran for its duration (plus a little to drain in-flight requests), not far more, not forever.
    expect(elapsed).toBeGreaterThanOrEqual(1000)
    expect(elapsed).toBeLessThan(2500)
    // About 10 attempts for 10/s over a second, give or take timer jitter.
    expect(summary.attempts).toBeGreaterThanOrEqual(7)
    expect(summary.attempts).toBeLessThanOrEqual(14)
  })

  it('reaches an HTTPS target when given the team CA', async () => {
    const { target, caFile } = await startTlsLogin()

    const summary = await bruteForceLogin({ target, ratePerSec: 20, durationMs: 500, caFile })

    // The handshake is trusted and the attempts land: all refused 401, none left unanswered.
    expect(summary.attempts).toBeGreaterThan(0)
    expect(summary.refused401).toBe(summary.attempts)
    expect(summary.other).toBe(0)
  })

  it('does not disable TLS verification: without the team CA the handshake fails', async () => {
    const { target } = await startTlsLogin()

    const summary = await bruteForceLogin({ target, ratePerSec: 20, durationMs: 500 })

    // The CA is not among the public roots, so every attempt is a refused handshake, none a 401.
    expect(summary.attempts).toBeGreaterThan(0)
    expect(summary.other).toBe(summary.attempts)
    expect(summary.refused401).toBe(0)
  })
})
