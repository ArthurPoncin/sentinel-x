// Seconds one beat of a drifting Probe takes: quicker than the LED ring's breath, a warning, not yet an alarm.
export const PULSE_PERIOD = 1.2
// A pulsing Probe never goes dark between two beats: at any instant it is the one to look at.
export const PULSE_FLOOR = 0.2

// How bright a pulsing Probe is `seconds` into its beats, PULSE_FLOOR–1: brightest at the start of each
// period, a short beat then a longer rest.
export function pulse(seconds: number): number {
  const swing = (1 + Math.cos((2 * Math.PI * seconds) / PULSE_PERIOD)) / 2
  return PULSE_FLOOR + (1 - PULSE_FLOOR) * swing ** 2
}
