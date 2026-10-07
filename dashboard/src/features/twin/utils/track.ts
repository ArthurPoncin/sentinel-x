import { type Fade, FADE_SECONDS, fadeValue } from './fade'
import { bearingTo, type GroundPoint } from './site'
import { turnedTo } from './walk'

// The camera says where someone is every so often, not how fast they go. Their figurine takes as long to walk
// to where they were last seen as the camera took to see them move, and a little longer: it walks at their
// own pace, one sighting behind, and is still walking when the next one comes instead of marking time between
// the two.
export const UNHURRIED = 1.15
// The seconds between two sightings it reckons with: two in a row do not make it dash, and one that comes
// after it stood for long does not make it crawl.
export const SIGHTING = { shortest: 0.25, longest: 1.5 } as const
// How fast it sets off, comes to rest and turns to another way: most of it in a few tenths of a second.
export const SET_OFF = 8
// Close enough to full stride, or to rest, to be there for good.
const SETTLED = 1e-4
// The seconds a last known position stays shown once someone is no longer seen: the outline of their figurine,
// where it last stood. It then goes out, in a fade.
export const LAST_KNOWN_SECONDS = 5
// The most figurines the Twin draws at once: the people an Alert tells of, and those still going out.
export const MOST_FIGURINES = 12

// Someone the camera sees, as the scene tells it.
export interface Sighting {
  // Tells the same person moving from another one, within their Alert.
  key: string
  // Where on the ground the camera sees them.
  at: GroundPoint
  // Whether they are the one the camera follows.
  followed: boolean
}

// The people the active `intrusion` Alert sees.
export interface Intrusion {
  alertId: string
  people: readonly Sighting[]
}

// A figurine as the Twin draws it, from one frame to the next. One that is no longer seen no longer moves nor
// ages: it comes to rest where it last stood and counts the seconds since.
export interface Track {
  // The `intrusion` Alert that saw it, and who it is in it.
  alertId: string
  key: string
  // Whether the camera still sees them. Once it does not, they are gone or their Alert is cleared: the
  // figurine fades out where it last stood, and leaves its outline there.
  seen: boolean
  followed: boolean
  // Where it stands on the ground.
  at: GroundPoint
  // For how many seconds it has been shown, which its sweep from feet to head goes by.
  age: number
  // Where the camera last saw them, for how many seconds it has seen them there, and how fast the figurine
  // walks there, in scene units a second.
  sighted: GroundPoint
  since: number
  pace: number
  // The bearing it walks along. It takes the way it goes as it sets off, and turns to another as it walks.
  course: number
  // How far it has walked since it appeared, in scene units: its walk cycle goes by that, not by the time.
  walked: number
  // How much it is walking: 0 at rest, 1 in full stride. Eased, so the figurine sets off and stops without a
  // jolt.
  walking: number
  // For how many seconds it has no longer been seen: 0 while it is.
  lost: number
}

// Where someone was last seen, once the camera no longer sees them: the last known position.
export interface LastKnown {
  // Where their figurine last stood.
  at: GroundPoint
  // How much of the outline it leaves there shows, 0–1.
  level: number
}

export const NO_TRACKS: readonly Track[] = []

// How fast to walk to a new sighting, `gap` away, that comes `since` seconds after the last.
function paceFor(gap: number, since: number): number {
  const taken = Math.min(SIGHTING.longest, Math.max(SIGHTING.shortest, since))
  return gap / (UNHURRIED * taken)
}

// The share of the way to somewhere that is closed in `elapsed` seconds: the same share of what is left in the
// same time, whatever the frame rate.
const closed = (elapsed: number) => 1 - Math.exp(-SET_OFF * elapsed)

// `walking` once `elapsed` seconds have gone by on the way to `stride`, 1 in full stride or 0 at rest.
function easedTo(walking: number, stride: 0 | 1, elapsed: number): number {
  const eased = walking + (stride - walking) * closed(elapsed)
  return Math.abs(eased - stride) < SETTLED ? stride : eased
}

// The share of a fade that is done `elapsed` seconds into it, 0–1: fade.ts's own pace.
const FADE_IN: Fade = { from: [0], to: [1], startedAt: 0 }
const faded = (elapsed: number) => fadeValue(FADE_IN, elapsed)[0] ?? 0

// For how many seconds a figurine that is no longer seen still shows something: the time its last known
// position stays, and the time that fades out in.
const SHOWN_FOR = FADE_SECONDS + LAST_KNOWN_SECONDS

// The figurine that is no longer seen `elapsed` seconds on: it stays where it last stood and comes out of its
// stride, and is nothing once all it shows has gone out.
function lostFor(track: Track, elapsed: number): Track | null {
  // The frame it is first missed on starts the count.
  const lost = track.seen ? 0 : track.lost + elapsed
  if (lost >= SHOWN_FOR) return null
  return { ...track, seen: false, walking: easedTo(track.walking, 0, elapsed), lost }
}

// The figurine `elapsed` seconds after `track` (null: none was drawn), for someone the scene shows now
// (null: the camera no longer sees them). It walks over the ground as the same person is seen elsewhere, at
// a steady pace, straight there and never past: two frames of half a step land where one whole step does.
// Someone newly seen stands their figurine where they are, at rest: it takes no step from where another
// stood, and starts its sweep over. Once they are no longer seen the figurine stays where it last stood, at
// rest, for as long as it shows: LAST_KNOWN_SECONDS and a fade. Then there is none.
export function trackAt(
  track: Track | null,
  seen: (Sighting & { alertId: string }) | null,
  elapsed: number,
): Track | null {
  const passed = Math.max(0, elapsed)
  if (seen === null) return track && lostFor(track, passed)
  const { alertId, key, at, followed } = seen
  if (track === null || !track.seen || track.alertId !== alertId || track.key !== key) {
    return { alertId, key, seen: true, followed, at, age: 0, sighted: at, since: 0, pace: 0, course: 0, walked: 0, walking: 0, lost: 0 }
  }

  const gap = Math.hypot(at.x - track.at.x, at.z - track.at.z)
  const sighted = at.x !== track.sighted.x || at.z !== track.sighted.z
  const pace = sighted ? paceFor(gap, track.since) : track.pace
  const step = Math.min(gap, pace * passed)
  const share = step === gap ? 1 : step / gap
  const moving = step > 0

  return {
    alertId,
    key,
    seen: true,
    followed,
    at: share === 1 ? at : { x: track.at.x + (at.x - track.at.x) * share, z: track.at.z + (at.z - track.at.z) * share },
    age: track.age + passed,
    sighted: at,
    since: (sighted ? 0 : track.since) + passed,
    pace,
    course: !moving
      ? track.course
      : track.walking === 0
        ? bearingTo(track.at, at)
        : turnedTo(track.course, bearingTo(track.at, at), closed(passed)),
    walked: track.walked + step,
    walking: easedTo(track.walking, moving ? 1 : 0, passed),
    lost: 0,
  }
}

// How much of the figurine itself shows, 0–1: all of it while it is seen, less and less of it once it no
// longer is, in a fade.
export function figurineLevel(track: Track): number {
  return track.seen ? 1 : 1 - faded(track.lost)
}

// How much of what tells someone the camera sees shows, 0–1: the ring at their feet, the frame of their
// detection, the line to the lens, and for the one it follows the pin and the label. It comes as the figurine
// is swept in and goes as it fades out.
export function marksLevel(track: Track): number {
  return track.seen ? faded(track.age) : 1 - faded(track.lost)
}

// The last known position `track` gives: none while it is seen. Then where the figurine last stood, whether
// the camera followed them or not: its outline comes as the figurine goes, stays until LAST_KNOWN_SECONDS and
// goes out, each in a fade.
export function lastKnown(track: Track | null): LastKnown | null {
  if (track === null || track.seen) return null
  return { at: track.at, level: Math.min(faded(track.lost), 1 - faded(track.lost - LAST_KNOWN_SECONDS)) }
}

// What is left of `track` as the intruder of another Alert appears: a last known position goes out at once, in
// a fade, from what shows of its outline, and nothing is left of an intruder that was still seen — the camera
// still sees one, over there.
function putOut(track: Track): Track | null {
  if (track.lost === 0) return null
  return { ...track, lost: Math.max(track.lost, LAST_KNOWN_SECONDS + Math.max(0, FADE_SECONDS - track.lost)) }
}

// `tracks` `elapsed` seconds on, for the people the scene shows now (null: no `intrusion` Alert is active):
// a figurine each, those that are seen first, in the order the Alert tells them, then those that are going
// out, the last lost first. Someone the Alert no longer tells of fades out where they stood. The intruder of
// another Alert appears at its own place, and what was left of the one before goes out where it is.
export function tracksAt(tracks: readonly Track[], intrusion: Intrusion | null, elapsed: number): Track[] {
  const alertId = intrusion?.alertId
  const told = new Map(intrusion?.people.map((person) => [person.key, person]))
  // Whoever of them already has a figurine, by who they are.
  const before = new Map<string, Track>()
  const going: Track[] = []
  for (const track of tracks) {
    if (track.seen && track.alertId === alertId && told.has(track.key)) {
      before.set(track.key, track)
      continue
    }
    const left = trackAt(track, null, elapsed)
    const kept = left && alertId !== undefined && left.alertId !== alertId ? putOut(left) : left
    if (kept) going.push(kept)
  }
  const seen = [...told.values()].flatMap(
    (person) => (alertId !== undefined && trackAt(before.get(person.key) ?? null, { ...person, alertId }, elapsed)) || [],
  )

  return [...seen, ...going.sort((a, b) => a.lost - b.lost)].slice(0, MOST_FIGURINES)
}
