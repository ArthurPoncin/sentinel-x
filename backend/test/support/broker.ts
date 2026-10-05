import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:tls'
import { Aedes } from 'aedes'
import { generate } from 'selfsigned'
import { onTestFinished, vi } from 'vitest'
import type { MqttConfig } from '../../src/mqtt-ingress.js'

const API_PASSWORD = 'api-password'

const ec = { keyType: 'ec', algorithm: 'sha256' } as const

function createCa(commonName: string) {
  return generate([{ name: 'commonName', value: commonName }], {
    ...ec,
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, critical: true },
    ],
  })
}

// A team CA and the broker certificate it signed, as on the Command Post. Made once per test file.
let pki: Promise<{ caCert: string; key: string; cert: string }> | undefined

async function createPki() {
  const ca = await createCa('Sentinel-X test CA')
  const broker = await generate([{ name: 'commonName', value: 'mosquitto' }], {
    ...ec,
    ca: { key: ca.private, cert: ca.cert },
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', serverAuth: true },
      // Clients reach the broker by IP, like the Sentinel does.
      { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
    ],
  })
  return { caCert: ca.cert, key: broker.private, cert: broker.cert }
}

// Writes a certificate where the api can read it, until the calling test ends.
async function certificateFile(pem: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sentinel-x-test-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'ca.crt')
  await writeFile(file, pem)
  return file
}

// The certificate of a CA that signed nothing here.
export async function strangerCaFile(): Promise<string> {
  const stranger = await createCa('Some other CA')
  return certificateFile(stranger.cert)
}

// Starts an MQTTS broker on a free port, with the `api` user, and stops it when the calling
// test ends. It can be stopped and started again on the same port in between.
export async function startBroker() {
  pki ??= createPki()
  const { caCert, key, cert } = await pki
  const caFile = await certificateFile(caCert)

  let running: { aedes: Aedes; server: Server; sockets: Set<Socket> } | undefined
  let port = 0
  // Topic filters the clients of the running broker hold.
  const subscriptions: string[] = []

  async function start() {
    const aedes = await Aedes.createBroker({
      authenticate: (_client, username, password, done) =>
        done(null, username === 'api' && password?.toString() === API_PASSWORD),
    })
    aedes.on('subscribe', (granted) => subscriptions.push(...granted.map(({ topic }) => topic)))

    const sockets = new Set<Socket>()
    const server = createServer({ key, cert }, aedes.handle)
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    server.listen(port, '127.0.0.1')
    await once(server, 'listening')
    port = (server.address() as AddressInfo).port
    running = { aedes, server, sockets }
  }

  // Drops every connection, as a broker going down does.
  async function stop() {
    if (!running) return
    const { aedes, server, sockets } = running
    running = undefined
    subscriptions.length = 0
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => aedes.close(resolve))
    await new Promise((resolve) => server.close(resolve))
  }

  await start()
  onTestFinished(stop)

  return {
    // What the api needs to reach this broker as the `api` user.
    config: {
      url: `mqtts://127.0.0.1:${port}`,
      username: 'api',
      password: API_PASSWORD,
      caFile,
    } satisfies MqttConfig,
    subscriptions,
    // Resolves once a client holds a subscription on the running broker.
    subscribed: () =>
      vi.waitFor(
        () => {
          if (subscriptions.length === 0) throw new Error('No client has subscribed to the broker')
        },
        { timeout: 5000 },
      ),
    // Publishes as the broker itself, the way a Sentinel's message reaches the subscribers.
    publish: (topic: string, payload: string) =>
      new Promise<void>((resolve, reject) => {
        if (!running) return reject(new Error('The broker is stopped'))
        running.aedes.publish(
          { cmd: 'publish', topic, payload: Buffer.from(payload), qos: 0, retain: false, dup: false },
          (error) => (error ? reject(error) : resolve()),
        )
      }),
    start,
    stop,
  }
}
