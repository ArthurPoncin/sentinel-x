import { type Incident, IncidentSchema } from '@/shared/contract'

// What the way to the Twin carries when a replay is asked for from another screen: the Incident to replay.
export function replayAsked(incident: Incident): { replay: Incident } {
  return { replay: incident }
}

// The Incident a way to the Twin asks to replay, or none: `state` is the location's, anything at all.
export function askedReplay(state: unknown): Incident | null {
  if (typeof state !== 'object' || state === null || !('replay' in state)) return null
  const asked = IncidentSchema.safeParse(state.replay)
  return asked.success ? asked.data : null
}
