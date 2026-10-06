// How fast the intruder's column glides toward where the camera last saw it: most of the way in a few tenths
// of a second, all of it well before the next `x_norm` comes, a second later on the mock feed.
export const GLIDE = 6

// Where something gliding toward `target` is once `elapsed` seconds have gone by from `current`: it closes
// the same share of the gap in the same time, so it slows as it gets there and never overshoots. Two frames
// of half a step land where one whole step does: the glide is the same whatever the frame rate.
export function glide(current: number, target: number, elapsed: number): number {
  return target + (current - target) * Math.exp(-GLIDE * Math.max(0, elapsed))
}

// The intruder's column as the Twin draws it: the `intrusion` Alert it shows, null once that is cleared and
// the column fades out where it last stood, and where it stands on the camera's image, 0 = left, 1 = right.
export interface Track {
  alertId: string | null
  x_norm: number
}

// The column `elapsed` seconds after `track` (null: none was ever drawn), for the intruder the scene shows
// now (null: no `intrusion` Alert is active). It glides along the arc as the same Alert's `x_norm` changes;
// an Alert newly raised stands its column where it is, without gliding from where a previous one stood.
export function trackAt(
  track: Track | null,
  intruder: { alertId: string; x_norm: number } | null,
  elapsed: number,
): Track | null {
  if (intruder === null) return track && (track.alertId === null ? track : { alertId: null, x_norm: track.x_norm })
  if (track === null || track.alertId !== intruder.alertId) return { ...intruder }
  return { alertId: intruder.alertId, x_norm: glide(track.x_norm, intruder.x_norm, elapsed) }
}
