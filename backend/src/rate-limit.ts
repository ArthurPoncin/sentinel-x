export interface RateLimit {
  // Counts one request for `key`: how long to wait before the next one is let through, in
  // milliseconds, or 0 when this one is.
  take(key: string): number
}

// At most `limit` requests per `windowMs` for each key, in fixed windows starting at the key's
// first request. Keys whose window is over are forgotten as new ones come in.
export function createRateLimit(limit: number, windowMs: number, now: () => number = Date.now): RateLimit {
  const windows = new Map<string, { start: number; count: number }>()

  return {
    take(key) {
      const at = now()
      for (const [other, window] of windows) if (at - window.start >= windowMs) windows.delete(other)

      const window = windows.get(key) ?? { start: at, count: 0 }
      windows.set(key, window)
      if (window.count >= limit) return window.start + windowMs - at
      window.count++
      return 0
    },
  }
}
