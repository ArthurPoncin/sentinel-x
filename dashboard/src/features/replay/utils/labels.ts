import type { Incident } from '@/shared/contract'

// The time of an instant, to the second, on a 24-hour clock: what the REPLAY label shows as the replay goes.
export function clockTime(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone }).format(at)
}

// A number of seconds as m:ss: where the scrubber stands in a replay, and how long it lasts.
export function minutes(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

// An Incident as the scrubber lists it: « #3 · Tue 14:23:00 · 0:50 · gas, presence · critical ».
export function describeIncident(incident: Incident, timeZone?: string): string {
  const start = Date.parse(incident.start)
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone }).format(start)
  const span = incident.end === null ? 'ongoing' : minutes((Date.parse(incident.end) - start) / 1000)
  return [
    `#${incident.incident_id}`,
    `${day} ${clockTime(start, timeZone)}`,
    span,
    incident.kinds.join(', '),
    incident.peak,
  ].join(' · ')
}
