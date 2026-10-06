// Seconds one beat of the Alarm takes: the LED ring flashes once and the buzzer beeps once. Fast, an alarm,
// not a resting device (breathing.ts).
export const ALARM_PERIOD = 0.5
// The share of a beat the LED ring takes to light up, and to go dark again: short enough to blink, long
// enough not to cut from one frame to the next.
const EDGE = 0.14
// Arcs of sound in the air at once: one leaves the buzzer on every beat.
export const ARCS = 3
// Seconds an arc of sound lives.
export const ARC_LIFE = ARCS * ALARM_PERIOD
// An arc's radius as it leaves the buzzer, and how far it gets before it has died out, both at the Enclosure's
// scale 1. No further: the camera frames the Enclosure with little room above it.
const ARC_START = 0.07
export const ARC_REACH = 0.27

const smoothstep = (share: number) => {
  const held = Math.min(1, Math.max(0, share))
  return held * held * (3 - 2 * held)
}

// How bright the LED ring is `seconds` into the Alarm, 0–1: lit over the first half of each beat, dark over
// the second, all the way both times.
export function blink(seconds: number): number {
  const beat = (((seconds / ALARM_PERIOD) % 1) + 1) % 1
  return Math.min(smoothstep(beat / EDGE), 1 - smoothstep((beat - 0.5) / EDGE))
}

export interface Arc {
  // From the middle of the buzzer's top.
  radius: number
  // 0–1.
  opacity: number
}

// An arc of sound `age` of the way through its life: 0 as it leaves the buzzer, 1 when it has died out.
export function arcAt(age: number): Arc {
  return {
    // Sound does not slow down.
    radius: ARC_START + (ARC_REACH - ARC_START) * age,
    // It shows within the first tenth of its life, then fades as it spreads.
    opacity: smoothstep(age / 0.1) * (1 - age) ** 1.5,
  }
}

// The arcs in the air `seconds` into the Alarm: one leaves the buzzer at the start of every beat, with the
// LED ring's flash.
export function arcsAt(seconds: number): Arc[] {
  return Array.from({ length: ARCS }, (_, arc) => arcAt((((seconds / ARC_LIFE + arc / ARCS) % 1) + 1) % 1))
}
