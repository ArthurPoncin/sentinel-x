// How fast the camera the Twin draws turns to where an `intrusion` Alert says the real one is: most of the way
// in a few tenths of a second. The Alerts tell it twice a second at most; the servo turns in between.
export const PAN_PULL = 5
// Close enough to where it is going to be there for good, in radians.
const SETTLED = 1e-4

// How far the camera is drawn turned `elapsed` seconds on, from `shown`, on its way to `pan`: it closes the
// same share of what is left in the same time, whatever the frame rate, and ends right on it.
export function panToward(shown: number, pan: number, elapsed: number): number {
  const turned = pan + (shown - pan) * Math.exp(-PAN_PULL * Math.max(0, elapsed))
  return Math.abs(turned - pan) < SETTLED ? pan : turned
}
