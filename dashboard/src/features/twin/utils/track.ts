import { type Fade, FADE_SECONDS, fadeValue } from './fade'
import { roundFence, watchedPoint } from './site'

// The camera says where the intruder is every so often, not how fast it goes. The figurine takes as long to
// walk to where it was last seen as the camera took to see it move, and a little longer: it walks at the
// intruder's own pace, one sighting behind, and is still walking when the next one comes instead of marking
// time between the two.
export const UNHURRIED = 1.15
// The seconds between two sightings it reckons with: two in a row do not make it dash, and one that comes
// after it stood for long does not make it crawl.
export const SIGHTING = { shortest: 0.25, longest: 1.5 } as const
// How fast it sets off, comes to rest and turns round: most of the way in a few tenths of a second.
export const SET_OFF = 8
// Close enough to full stride, or to rest, to be there for good.
const SETTLED = 1e-4
// The seconds the last known position stays shown once the Alert is cleared: the figurine's outline, where it
// last stood. It then goes out, in a fade.
export const LAST_KNOWN_SECONDS = 5

// The way the figurine walks across the camera's image: 1 toward its right, -1 toward its left, 0 while it
// stands.
export type Heading = -1 | 0 | 1

// The intruder's figurine as the Twin draws it, from one frame to the next. A cleared one no longer moves nor
// ages: it comes to rest where it last stood, the last known position, and counts the seconds since.
export interface Track {
  // The `intrusion` Alert it shows, null once that is cleared: the figurine fades out where it last stood and
  // leaves its outline there.
  alertId: string | null
  // Where it stands on the camera's image, 0 = left, 1 = right.
  x_norm: number
  // For how many seconds its Alert has been shown, which its sweep from feet to head goes by.
  age: number
  // Where the camera last saw it, for how many seconds it has seen it there, and how fast the figurine walks
  // there, in `x_norm` a second.
  seen: number
  since: number
  pace: number
  // The way it walked over the last frame: the sign of its move across the image.
  heading: Heading
  // How far it has walked along the arc since its Alert was raised, in scene units: its walk cycle goes by
  // that, not by the time.
  walked: number
  // How much it is walking, and which way: 0 at rest, 1 in full stride toward the image's right, -1 toward its
  // left. It follows `heading` eased, so the figurine sets off, stops and turns round without a jolt.
  walking: number
  // For how many seconds its Alert has been cleared: 0 while it is active.
  lost: number
}

// Where the intruder was last seen, once its Alert is cleared: the last known position.
export interface LastKnown {
  // Where its figurine last stood on the camera's image, 0 = left, 1 = right.
  x_norm: number
  // How much of the outline it leaves there shows, 0–1.
  level: number
}

// What the Twin draws of the intruder, from one frame to the next.
export interface Tracks {
  // The figurine of the intruder the camera sees, or the last known position of the one it saw last.
  intruder: Track | null
  // The last known position of the one before it, which a newly raised intruder puts out.
  former: Track | null
}

export const NO_TRACKS: Tracks = { intruder: null, former: null }

// How fast to walk to a new sighting, `gap` away across the image, that comes `since` seconds after the last.
function paceFor(gap: number, since: number): number {
  const taken = Math.min(SIGHTING.longest, Math.max(SIGHTING.shortest, since))
  return Math.abs(gap) / (UNHURRIED * taken)
}

// `walking` once `elapsed` seconds have gone by on the way to `heading`: it closes the same share of the gap
// in the same time, whatever the frame rate.
function easedTo(walking: number, heading: Heading, elapsed: number): number {
  const eased = heading + (walking - heading) * Math.exp(-SET_OFF * elapsed)
  return Math.abs(eased - heading) < SETTLED ? heading : eased
}

// The share of a fade that is done `elapsed` seconds into it, 0–1: fade.ts's own pace.
const FADE_IN: Fade = { from: [0], to: [1], startedAt: 0 }
const faded = (elapsed: number) => fadeValue(FADE_IN, elapsed)[0] ?? 0

// The cleared figurine `elapsed` seconds on: it stays where it last stood and comes out of its stride, and is
// nothing once its last known position has gone out.
function lostFor(track: Track, elapsed: number): Track | null {
  // The frame its Alert is first cleared on starts the count.
  const lost = track.alertId === null ? track.lost + elapsed : 0
  if (lost >= LAST_KNOWN_SECONDS + FADE_SECONDS) return null
  return { ...track, alertId: null, heading: 0, walking: easedTo(track.walking, 0, elapsed), lost }
}

// The figurine `elapsed` seconds after `track` (null: none was ever drawn), for the intruder the scene shows
// now (null: no `intrusion` Alert is active). It walks along the arc as the same Alert's `x_norm` changes, at
// a steady pace and never past where it was seen: two frames of half a step land where one whole step does.
// An Alert newly raised stands its figurine where it is, at rest: it takes no step from where a previous one
// stood, and starts its sweep over. Once its Alert is cleared the figurine stays where it last stood, at rest,
// for as long as its last known position shows: LAST_KNOWN_SECONDS and a fade. Then there is none.
export function trackAt(
  track: Track | null,
  intruder: { alertId: string; x_norm: number } | null,
  elapsed: number,
): Track | null {
  const passed = Math.max(0, elapsed)
  if (intruder === null) return track && lostFor(track, passed)
  if (track === null || track.alertId !== intruder.alertId) {
    return { ...intruder, age: 0, seen: intruder.x_norm, since: 0, pace: 0, heading: 0, walked: 0, walking: 0, lost: 0 }
  }

  const gap = intruder.x_norm - track.x_norm
  const sighted = intruder.x_norm !== track.seen
  const pace = sighted ? paceFor(gap, track.since) : track.pace
  const step = Math.min(Math.abs(gap), pace * passed)
  const heading: Heading = step === 0 ? 0 : gap > 0 ? 1 : -1
  const x_norm = step === Math.abs(gap) ? intruder.x_norm : track.x_norm + heading * step

  return {
    alertId: intruder.alertId,
    x_norm,
    age: track.age + passed,
    seen: intruder.x_norm,
    since: (sighted ? 0 : track.since) + passed,
    pace,
    heading,
    walked:
      track.walked + (step === 0 ? 0 : Math.abs(roundFence(watchedPoint(x_norm)) - roundFence(watchedPoint(track.x_norm)))),
    walking: easedTo(track.walking, heading, passed),
    lost: 0,
  }
}

// How much of the figurine itself shows, 0–1: all of it while its Alert is active, less and less of it once
// that is cleared, in a fade.
export function figurineLevel(track: Track): number {
  return track.alertId === null ? 1 - faded(track.lost) : 1
}

// The last known position `track` gives: none while its Alert is active, then where the figurine last stood.
// Its outline comes as the figurine goes, stays until LAST_KNOWN_SECONDS and goes out, each in a fade.
export function lastKnown(track: Track | null): LastKnown | null {
  if (track === null || track.alertId !== null) return null
  return { x_norm: track.x_norm, level: Math.min(faded(track.lost), 1 - faded(track.lost - LAST_KNOWN_SECONDS)) }
}

// The cleared `track` as a newly raised intruder puts its last known position out: its outline goes out at
// once, in a fade, from what shows of it.
function putOut(track: Track): Track {
  return { ...track, lost: Math.max(track.lost, LAST_KNOWN_SECONDS + Math.max(0, FADE_SECONDS - track.lost)) }
}

// `tracks` `elapsed` seconds on, for the intruder the scene shows now (null: no `intrusion` Alert is active).
// An intruder raised while a last known position still shows appears at its own place, and that one goes out
// where it is.
export function tracksAt(
  tracks: Tracks,
  intruder: { alertId: string; x_norm: number } | null,
  elapsed: number,
): Tracks {
  const before = tracks.intruder
  return {
    intruder: trackAt(before, intruder, elapsed),
    former:
      before !== null && before.alertId === null && intruder !== null
        ? putOut(before)
        : tracks.former && trackAt(tracks.former, null, elapsed),
  }
}
