// Seconds the amber sweep takes to go round the fence, from one side of the gate to the other: someone is
// near, not inside yet, so it goes at a patrol's pace.
export const SWEEP_PERIOD = 2.4
// Flashes of the PIR dome during one sweep. A whole number: the dome is dark as each sweep starts and ends.
export const FLASHES_PER_SWEEP = 4
// How much of the fence glows behind the sweep's head, as a share of its length.
export const SWEEP_TAIL = 0.3
// How far ahead of its head the sweep starts to show: a post lights up over a few frames, it does not pop.
export const SWEEP_LEAD = 0.03

// The sweeps a presence sets off, one after the other: when the first one started and when the last one
// ends, never (Infinity) while the presence lasts. In seconds, on a clock that only goes forward.
export interface Sweeps {
  startedAt: number
  endsAt: number
}

// The sweeps at `now`, from what they were (null: the fence is not swept) and whether a `presence` Alert is
// active. They start when it is raised and follow one another while it lasts; once it is cleared the sweep
// in progress goes to its end, and no other starts.
export function sweepsAt(sweeps: Sweeps | null, present: boolean, now: number): Sweeps | null {
  const going = sweeps !== null && now < sweeps.endsAt
  if (present) {
    if (!going) return { startedAt: now, endsAt: Number.POSITIVE_INFINITY }
    // A presence that comes back while the last sweep finishes keeps it going: it does not start over.
    return Number.isFinite(sweeps.endsAt) ? { startedAt: sweeps.startedAt, endsAt: Number.POSITIVE_INFINITY } : sweeps
  }
  if (!going) return null
  if (Number.isFinite(sweeps.endsAt)) return sweeps
  const sweepsStarted = Math.max(1, Math.ceil((now - sweeps.startedAt) / SWEEP_PERIOD))
  return { startedAt: sweeps.startedAt, endsAt: sweeps.startedAt + sweepsStarted * SWEEP_PERIOD }
}

// How far through its sweep the fence is at `now`, 0–1, or null when nothing sweeps it.
export function lapAt(sweeps: Sweeps | null, now: number): number | null {
  if (sweeps === null || now < sweeps.startedAt || now >= sweeps.endsAt) return null
  return ((now - sweeps.startedAt) / SWEEP_PERIOD) % 1
}

const smoothstep = (share: number) => share * share * (3 - 2 * share)

// How bright the fence glows at `place` along it, 0 at the gate's first post and 1 at its last, when the
// sweep is `lap` of the way through, 0–1: brightest at the sweep's head, fading along the tail behind it.
// The head leaves the first post as the sweep starts and its tail has left the last one when it ends: the
// fence is dark at both ends of a sweep, so that one follows another, and the last one stops, without a cut.
export function sweepGlow(place: number, lap: number): number {
  const head = lap * (1 + SWEEP_LEAD + SWEEP_TAIL) - SWEEP_LEAD
  const behind = head - place
  if (behind <= -SWEEP_LEAD || behind >= SWEEP_TAIL) return 0
  return behind < 0 ? smoothstep(1 + behind / SWEEP_LEAD) : (1 - behind / SWEEP_TAIL) ** 2
}

// How bright the PIR dome is `lap` of the way through a sweep, 0–1: FLASHES_PER_SWEEP flashes, lit for as
// long as it is dark between them, and dark as the sweep starts and ends. A blink, not a breath: its edges
// are steep, but each takes a few frames.
export function domeFlash(lap: number): number {
  const swing = (1 - Math.cos(2 * Math.PI * FLASHES_PER_SWEEP * lap)) / 2
  return smoothstep(Math.min(1, Math.max(0, 2 * swing - 0.5)))
}
