// Seconds one breath of the LED ring takes: slow, a resting device, not an alarm.
export const BREATH_PERIOD = 4
// The ring never goes dark between two breaths.
export const BREATH_FLOOR = 0.3

// How bright the LED ring is `seconds` into its breathing, BREATH_FLOOR–1: a smooth rise and fall,
// brightest at the start of each period.
export function breath(seconds: number): number {
  const phase = (1 + Math.cos((2 * Math.PI * seconds) / BREATH_PERIOD)) / 2
  return BREATH_FLOOR + (1 - BREATH_FLOOR) * phase
}
