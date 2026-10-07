import { existsSync } from 'node:fs'
import { join } from 'node:path'
import koffi from 'koffi'
import type { Hand } from './protocol.js'
import {
  EVENT_TRACKING,
  HAND_SIZE,
  MESSAGE_SIZE,
  readHand,
  readMessage,
  readTrackingEvent,
  TRACKING_EVENT_SIZE,
} from './tracking.js'

// Where Ultraleap's installer puts the LeapSDK folder, and LeapC in it.
const SDK: Partial<Record<NodeJS.Platform, { home: string; library: string }>> = {
  win32: { home: 'C:/Program Files/Ultraleap/LeapSDK', library: 'lib/x64/LeapC.dll' },
  darwin: { home: '/Applications/Ultraleap Hand Tracking.app/Contents/LeapSDK', library: 'lib/libLeapC.dylib' },
  linux: { home: '/usr/lib/ultraleap-hand-tracking-service', library: 'libLeapC.so' },
}

// Milliseconds a poll waits for the tracking service before it gives the loop back.
const POLL_TIMEOUT_MS = 200
const SUCCESS = 0
// eLeapRS_Timeout: nothing came in time, which is no failure.
const TIMEOUT = 0xe2010004

// LeapC on this machine: LEAPC_LIBRARY names the file itself, LEAPSDK_INSTALL_LOCATION the LeapSDK folder (as
// Ultraleap's own bindings read it), the installer's folder otherwise.
export function libraryPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.LEAPC_LIBRARY) return env.LEAPC_LIBRARY
  const sdk = SDK[platform]
  if (!sdk) throw new Error(`No Ultraleap tracking software for ${platform}: set LEAPC_LIBRARY to LeapC's path.`)
  return join(env.LEAPSDK_INSTALL_LOCATION ?? sdk.home, sdk.library)
}

export interface Tracking {
  // Stops polling and lets go of the tracking service.
  close(): Promise<void>
}

// Follows the Ultraleap tracking service through LeapC and hands over the hands of each frame of tracking, an
// empty frame included. The service itself is what waits for the sensor: unplugged, no frame comes.
export function openTracking(path: string, onHands: (hands: Hand[]) => void): Tracking {
  if (!existsSync(path)) {
    throw new Error(`LeapC is not at ${path}. Install the Ultraleap tracking software, or set LEAPC_LIBRARY.`)
  }
  const library = koffi.load(path)
  const create = library.func('uint32 LeapCreateConnection(void *config, void *connection)')
  const open = library.func('uint32 LeapOpenConnection(void *connection)')
  const poll = library.func('uint32 LeapPollConnection(void *connection, uint32 timeout, void *message)')
  const closeConnection = library.func('void LeapCloseConnection(void *connection)')
  const destroy = library.func('void LeapDestroyConnection(void *connection)')

  const handle = Buffer.alloc(8)
  const created = create(null, handle) as number
  if (created !== SUCCESS) throw new Error(`LeapCreateConnection failed (0x${created.toString(16)}).`)
  const connection = handle.readBigUInt64LE()
  const opened = open(connection) as number
  if (opened !== SUCCESS) throw new Error(`LeapOpenConnection failed (0x${opened.toString(16)}).`)

  const message = Buffer.alloc(MESSAGE_SIZE)
  // Off the event loop: a poll blocks until an event comes or its timeout runs out.
  const pollOnce = () =>
    new Promise<number>((resolve, reject) => {
      poll.async(connection, POLL_TIMEOUT_MS, message, (error: Error | null, result: number) =>
        error ? reject(error) : resolve(result),
      )
    })

  // What a tracking event points to is only there until the next poll: read whole, here.
  const handsOf = (event: bigint): Hand[] | null => {
    const tracking = readTrackingEvent(new DataView(koffi.view(event, TRACKING_EVENT_SIZE)))
    if (!tracking) return null
    if (tracking.count === 0) return []
    const hands = new DataView(koffi.view(tracking.hands, tracking.count * HAND_SIZE))
    return Array.from({ length: tracking.count }, (_, index) => readHand(hands, index * HAND_SIZE))
  }

  let running = true
  const loop = (async () => {
    while (running) {
      const result = await pollOnce()
      if (!running) break
      if (result !== SUCCESS) {
        // Anything but a timeout is the service gone or not there yet: LeapC reconnects on its own, and says
        // so again in no time if polled at once.
        if (result !== TIMEOUT) await new Promise((resolve) => setTimeout(resolve, POLL_TIMEOUT_MS))
        continue
      }
      const { type, event } = readMessage(message)
      if (type !== EVENT_TRACKING || event === 0n) continue
      const hands = handsOf(event)
      if (hands) onHands(hands)
    }
  })()

  return {
    async close() {
      running = false
      await loop.catch(() => undefined)
      closeConnection(connection)
      destroy(connection)
    },
  }
}
