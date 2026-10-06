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

// The way the figurine walks across the camera's image: 1 toward its right, -1 toward its left, 0 while it
// stands.
export type Heading = -1 | 0 | 1

// The intruder's figurine as the Twin draws it, from one frame to the next. A cleared one no longer moves nor
// ages.
export interface Track {
  // The `intrusion` Alert it shows, null once that is cleared and the figurine fades out where it last stood.
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
}

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

// The figurine `elapsed` seconds after `track` (null: none was ever drawn), for the intruder the scene shows
// now (null: no `intrusion` Alert is active). It walks along the arc as the same Alert's `x_norm` changes, at
// a steady pace and never past where it was seen: two frames of half a step land where one whole step does.
// An Alert newly raised stands its figurine where it is, at rest: it takes no step from where a previous one
// stood, and starts its sweep over.
export function trackAt(
  track: Track | null,
  intruder: { alertId: string; x_norm: number } | null,
  elapsed: number,
): Track | null {
  if (intruder === null) return track && (track.alertId === null ? track : { ...track, alertId: null, heading: 0 })
  if (track === null || track.alertId !== intruder.alertId) {
    return { ...intruder, age: 0, seen: intruder.x_norm, since: 0, pace: 0, heading: 0, walked: 0, walking: 0 }
  }

  const passed = Math.max(0, elapsed)
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
  }
}
