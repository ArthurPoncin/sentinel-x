import { type Frame, FrameSchema } from '@/shared/contract'

export type ConnectionState = 'connecting' | 'open' | 'closed'

// What the feed emits: every valid frame, plus the life of the socket underneath.
export type FeedEvent = Frame | { type: 'connection'; state: ConnectionState }

export interface FeedOptions {
  // Delay before the first retry after a close; it doubles on every failure, up to `maxDelayMs`.
  initialDelayMs?: number
  maxDelayMs?: number
  // Told about every message that is not a contract frame. The feed itself moves on.
  onMalformed?: (data: unknown, reason: string) => void
}

function parseFrame(data: unknown) {
  if (typeof data !== 'string') return { success: false, reason: 'not a text message' } as const
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return { success: false, reason: 'not JSON' } as const
  }
  const parsed = FrameSchema.safeParse(json)
  return parsed.success
    ? ({ success: true, frame: parsed.data } as const)
    : ({ success: false, reason: parsed.error.message } as const)
}

// Connects to the Command Post feed and keeps it connected: after any close, it retries with an
// exponential backoff until the returned function is called. No UI logic here.
export function connectFeed(url: string, emit: (event: FeedEvent) => void, options: FeedOptions = {}): () => void {
  const { initialDelayMs = 500, maxDelayMs = 10_000, onMalformed } = options
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let delay = initialDelayMs
  let stopped = false

  const open = () => {
    emit({ type: 'connection', state: 'connecting' })
    socket = new WebSocket(url)
    socket.onopen = () => {
      delay = initialDelayMs
      emit({ type: 'connection', state: 'open' })
    }
    socket.onmessage = ({ data }) => {
      const parsed = parseFrame(data)
      if (parsed.success) emit(parsed.frame)
      else onMalformed?.(data, parsed.reason)
    }
    // A failed attempt closes too, so this is the one place that schedules the next one.
    socket.onclose = () => {
      if (stopped) return
      emit({ type: 'connection', state: 'closed' })
      retry = setTimeout(open, delay)
      delay = Math.min(delay * 2, maxDelayMs)
    }
  }

  open()
  return () => {
    stopped = true
    clearTimeout(retry)
    socket?.close()
  }
}
