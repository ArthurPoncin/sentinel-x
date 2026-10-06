// How fast the intruder's figurine glides toward where the camera last saw it: most of the way in a few tenths
// of a second, all of it well before the next `x_norm` comes, a second later on the mock feed.
export const GLIDE = 6

// Where something gliding toward `target` is once `elapsed` seconds have gone by from `current`: it closes
// the same share of the gap in the same time, so it slows as it gets there and never overshoots. Two frames
// of half a step land where one whole step does: the glide is the same whatever the frame rate.
export function glide(current: number, target: number, elapsed: number): number {
  return target + (current - target) * Math.exp(-GLIDE * Math.max(0, elapsed))
}

// The intruder's figurine as the Twin draws it: the `intrusion` Alert it shows, null once that is cleared and
// the figurine fades out where it last stood, where it stands on the camera's image, 0 = left, 1 = right, and
// for how many seconds its Alert has been shown, which its sweep from feet to head goes by. A cleared one no
// longer ages.
export interface Track {
  alertId: string | null
  x_norm: number
  age: number
}

// The figurine `elapsed` seconds after `track` (null: none was ever drawn), for the intruder the scene shows
// now (null: no `intrusion` Alert is active). It glides along the arc as the same Alert's `x_norm` changes;
// an Alert newly raised stands its figurine where it is, without gliding from where a previous one stood, and
// starts its sweep over.
export function trackAt(
  track: Track | null,
  intruder: { alertId: string; x_norm: number } | null,
  elapsed: number,
): Track | null {
  if (intruder === null) return track && (track.alertId === null ? track : { ...track, alertId: null })
  if (track === null || track.alertId !== intruder.alertId) return { ...intruder, age: 0 }
  return {
    alertId: intruder.alertId,
    x_norm: glide(track.x_norm, intruder.x_norm, elapsed),
    age: track.age + Math.max(0, elapsed),
  }
}
