import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { libraryPath } from '../src/leapc.js'
import type { HandFrame } from '../src/protocol.js'
import { type HandServer, serveHands } from '../src/server.js'
import { PAUSE, ROUND, SCRIPT, simulatedHands } from '../src/simulate.js'

describe('libraryPath', () => {
  it("is where Ultraleap's installer puts LeapC", () => {
    expect(libraryPath({}, 'win32').replaceAll('\\', '/')).toBe('C:/Program Files/Ultraleap/LeapSDK/lib/x64/LeapC.dll')
    expect(libraryPath({}, 'darwin')).toBe('/Applications/Ultraleap Hand Tracking.app/Contents/LeapSDK/lib/libLeapC.dylib')
  })

  it('follows a LeapSDK folder moved elsewhere, and a library named outright', () => {
    expect(libraryPath({ LEAPSDK_INSTALL_LOCATION: '/opt/LeapSDK' }, 'darwin')).toBe('/opt/LeapSDK/lib/libLeapC.dylib')
    expect(libraryPath({ LEAPC_LIBRARY: '/tmp/LeapC.so', LEAPSDK_INSTALL_LOCATION: '/opt/LeapSDK' }, 'linux')).toBe('/tmp/LeapC.so')
  })

  it('says so where Ultraleap ships nothing', () => {
    expect(() => libraryPath({}, 'freebsd')).toThrow(/LEAPC_LIBRARY/)
  })
})

describe('simulatedHands', () => {
  const startOf = (pose: string) => {
    let at = 0
    for (const step of SCRIPT) {
      if (step.pose === pose) return at
      at += step.seconds
    }
    throw new Error(`no ${pose} in the script`)
  }

  it('shows a flat hand over the sensor, palm down and every finger out', () => {
    const [hand] = simulatedHands(0.5)

    expect(hand).toMatchObject({ side: 'right', palm: [0, 200, 0], normal: [0, -1, 0], grab: 0 })
    expect(hand?.fingers.map((finger) => finger.extended)).toEqual([true, true, true, true, true])
  })

  it('points the thumb up, then down, the other fingers closed', () => {
    const [up] = simulatedHands(startOf('thumb-up') + 1)
    const [down] = simulatedHands(startOf('thumb-down') + 1)
    const rise = (hand: typeof up) => (hand?.fingers[0].joints[4][1] ?? 0) - (hand?.fingers[0].joints[1][1] ?? 0)

    expect(up?.fingers.map((finger) => finger.extended)).toEqual([true, false, false, false, false])
    expect(rise(up)).toBeGreaterThan(60)
    expect(rise(down)).toBeLessThan(-60)
  })

  it('moves fast across the sensor as it turns the page, on its edge', () => {
    const at = startOf('page')
    const [hand] = simulatedHands(at + 0.2)

    expect(Math.abs(hand?.normal[0] ?? 0)).toBe(1)
    expect(hand?.velocity[0]).toBeLessThan(-900)
  })

  it('shows no hand at the end of a round, then starts over', () => {
    expect(simulatedHands(ROUND - PAUSE / 2)).toEqual([])
    expect(simulatedHands(ROUND + 0.5)).toEqual(simulatedHands(0.5))
  })
})

describe('serveHands', () => {
  let server: HandServer | undefined
  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  const PORT = 46438
  const listen = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const frames: HandFrame[] = []
    socket.on('message', (data) => frames.push(JSON.parse(String(data))))
    await new Promise((resolve) => socket.once('open', resolve))
    return { frames, settle: () => new Promise((resolve) => setTimeout(resolve, 50)) }
  }

  it('sends each frame to the dashboards listening, the empty ones too', async () => {
    let now = 0
    server = await serveHands(PORT, () => now)
    const { frames, settle } = await listen()

    now = 100
    server.publish(simulatedHands(0.5))
    now = 200
    server.publish([])
    await settle()

    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ v: 1, hands: [{ side: 'right' }] })
    expect(frames[1]).toEqual({ v: 1, hands: [] })
  })

  it('lets go of the frames that come faster than a screen shows', async () => {
    let now = 1000
    server = await serveHands(PORT, () => now)
    const { frames, settle } = await listen()

    server.publish([])
    now += 5
    server.publish([])
    now += 20
    server.publish([])
    await settle()

    expect(frames).toHaveLength(2)
  })
})
