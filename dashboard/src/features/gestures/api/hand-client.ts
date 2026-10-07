import { type Hand, HandFrameSchema } from './hand-frame'

export type BridgeState = 'connecting' | 'open' | 'closed'

// What the bridge's socket gives: the hands of each frame of tracking, and its own life.
export type HandEvent = { type: 'hands'; hands: Hand[] } | { type: 'bridge'; state: BridgeState }

// Milliseconds between two attempts while the bridge is not there: it is on this machine, started by hand,
// and an attempt costs nothing.
const RETRY_MS = 2000

function parseHands(data: unknown): Hand[] | null {
  if (typeof data !== 'string') return null
  try {
    const parsed = HandFrameSchema.safeParse(JSON.parse(data))
    return parsed.success ? parsed.data.hands : null
  } catch {
    return null
  }
}

// Connects to the hand bridge and keeps trying for as long as it is asked to, until the returned function is
// called. What is not a frame of hands is dropped: the next one is a sixtieth of a second away.
export function connectHands(url: string, emit: (event: HandEvent) => void): () => void {
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const open = () => {
    emit({ type: 'bridge', state: 'connecting' })
    const current = new WebSocket(url)
    socket = current
    let down = false
    // Once per socket: a failed attempt fires `error` then `close` in a browser, `error` alone in Node.
    const onDown = () => {
      if (stopped || down) return
      down = true
      emit({ type: 'bridge', state: 'closed' })
      retry = setTimeout(open, RETRY_MS)
    }
    current.onerror = onDown
    current.onclose = onDown
    current.onopen = () => emit({ type: 'bridge', state: 'open' })
    current.onmessage = ({ data }) => {
      const hands = parseHands(data)
      if (hands) emit({ type: 'hands', hands })
    }
  }

  open()
  return () => {
    stopped = true
    clearTimeout(retry)
    socket?.close()
  }
}
