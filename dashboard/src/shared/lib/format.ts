// Wall-clock time of an ISO timestamp or epoch ms, to the second: what the Operator compares.
export function clock(time: string | number): string {
  return new Date(time).toLocaleTimeString('en-GB', { hour12: false })
}

// A duration in ms, short: "42 s", "3 min 05 s", "1 h 12 min".
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}
