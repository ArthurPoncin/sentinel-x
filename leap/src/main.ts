import { libraryPath, openTracking } from './leapc.js'
import { DEFAULT_PORT, MAX_FRAMES_PER_SECOND } from './protocol.js'
import { serveHands } from './server.js'
import { simulatedHands } from './simulate.js'

const simulate = process.argv.includes('--simulate')
const port = Number(process.env.LEAP_BRIDGE_PORT ?? DEFAULT_PORT)

const server = await serveHands(port)
console.log(`Hand bridge listening on ws://127.0.0.1:${port}`)

let stop: () => Promise<void>
if (simulate) {
  const started = Date.now()
  const timer = setInterval(() => server.publish(simulatedHands((Date.now() - started) / 1000)), 1000 / MAX_FRAMES_PER_SECOND)
  stop = async () => clearInterval(timer)
  console.log('Simulating a hand: no sensor is read.')
} else {
  const path = libraryPath()
  let seen = false
  try {
    const tracking = openTracking(path, (hands) => {
      if (!seen) console.log('The sensor is tracking.')
      seen = true
      server.publish(hands)
    })
    stop = () => tracking.close()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    await server.close()
    process.exit(1)
  }
  console.log(`Reading the tracking service through ${path}`)
  console.log('Waiting for the sensor: plug it in, and check that the Ultraleap tracking service runs.')
}

const shutdown = async () => {
  await stop()
  await server.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
