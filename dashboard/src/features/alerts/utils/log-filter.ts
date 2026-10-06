import type { Alert, AlertKind, AlertSource, AlertState, Severity } from '@/shared/contract'

// What the Operator narrows the Alert log to. An empty list, 'all' or '' lets everything through.
export interface LogFilter {
  // From and to, "HH:MM" on the wall clock, both ends included.
  from: string
  to: string
  severities: readonly Severity[]
  kind: AlertKind | 'all'
  source: AlertSource | 'all'
  state: AlertState | 'all'
}

export const NO_FILTER: LogFilter = { from: '', to: '', severities: [], kind: 'all', source: 'all', state: 'all' }

export function isFiltering(filter: LogFilter): boolean {
  return (
    filter.from !== '' ||
    filter.to !== '' ||
    filter.severities.length > 0 ||
    filter.kind !== 'all' ||
    filter.source !== 'all' ||
    filter.state !== 'all'
  )
}

// "14:05" → 845, or null when it is not a time.
function minutesOf(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

// Whether an Alert's wall-clock minute falls between from and to. A range whose start comes after its end
// (22:00 → 02:00) runs over midnight.
export function inHours(ts: string, from: string, to: string): boolean {
  const date = new Date(ts)
  const minute = date.getHours() * 60 + date.getMinutes()
  const start = minutesOf(from)
  const end = minutesOf(to)
  if (start !== null && end !== null && start > end) return minute >= start || minute <= end
  return (start === null || minute >= start) && (end === null || minute <= end)
}

export function filterLog(entries: readonly Alert[], filter: LogFilter): Alert[] {
  return entries.filter(
    (alert) =>
      inHours(alert.ts, filter.from, filter.to) &&
      (filter.severities.length === 0 || filter.severities.includes(alert.severity)) &&
      (filter.kind === 'all' || alert.kind === filter.kind) &&
      (filter.source === 'all' || alert.source === filter.source) &&
      (filter.state === 'all' || alert.state === filter.state),
  )
}

// Severity is a set of toggles: pressing one adds it, pressing it again takes it away.
export function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}
