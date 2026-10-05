import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:tls'
import { Aedes } from 'aedes'
import { connectAsync } from 'mqtt'
import { generate } from 'selfsigned'
import { onTestFinished, vi } from 'vitest'
import type { MqttConfig } from '../../src/mqtt.js'

const API_PASSWORD = 'api-password'
const SENTINEL_PASSWORD = 'sentinel-password'

// The broker's password file.
const PASSWORD_OF: Record<string, string> = { api: API_PASSWORD, 'sentinel-01': SENTINEL_PASSWORD }

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

// Starts an MQTTS broker on a free port, with the `api` and `sentinel-01` users, and stops it when
// the calling test ends. It can be stopped and started again on the same port in between.
export async function startBroker() {
  pki ??= createPki()
  const { caCert, key, cert } = await pki
  const caFile = await certificateFile(caCert)

  let running: { aedes: Aedes; server: Server; sockets: Set<Socket> } | undefined
  let port = 0
  // Topic filters the clients of the running broker hold.
  const subscriptions: string[] = []
  // Everything the clients published, in the order the broker took it.
  const published: { topic: string; payload: string }[] = []
  // While set: the topics of the publications the running broker received and left unanswered.
  let unanswered: string[] | undefined

  async function start() {
    const aedes = await Aedes.createBroker({
      authenticate: (_client, username, password, done) =>
        done(null, username !== undefined && password?.toString() === PASSWORD_OF[username]),
      authorizePublish: (_client, packet, done) => {
        if (unanswered) unanswered.push(packet.topic)
        else done(null)
      },
    })
    aedes.on('subscribe', (granted) => subscriptions.push(...granted.map(({ topic }) => topic)))
    aedes.on('publish', ({ topic, payload }, client) => {
      if (client) published.push({ topic, payload: payload.toString() })
    })

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
    unanswered = undefined
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
    published,
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
    // Makes the broker stop answering publications until it is stopped, as when it goes down
    // mid-flight. Returns the topics of those it leaves unanswered, as they come in.
    stopAnswering: () => {
      unanswered = []
      return unanswered
    },
    // Logs in over MQTTS the way a Sentinel does and collects the payloads the broker delivers
    // on `topic`. The list fills in as they arrive; the connection ends with the broker's.
    subscribe: async (topic: string) => {
      const received: string[] = []
      const client = await connectAsync(`mqtts://127.0.0.1:${port}`, {
        username: 'sentinel-01',
        password: SENTINEL_PASSWORD,
        ca: caCert,
        reconnectPeriod: 0,
      })
      onTestFinished(() => client.endAsync(true))
      client.on('message', (_topic, payload) => received.push(payload.toString()))
      await client.subscribeAsync(topic, { qos: 1 })
      return received
    },
    start,
    stop,
  }
}
