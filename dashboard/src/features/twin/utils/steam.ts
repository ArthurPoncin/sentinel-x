// Seconds a puff of steam lives: slow, the plant is idling.
export const PUFF_LIFE = 10
// How high a puff climbs above the chimney's mouth over its life, in scene units.
export const PLUME_RISE = 1.2
// How far the wind carries it meanwhile.
export const PLUME_DRIFT = 0.8
// A puff's radius as it leaves the mouth, and when it is gone.
const PUFF_RADIUS = [0.08, 0.4] as const

export interface Puff {
  // How high above the chimney's mouth.
  rise: number
  // How far downwind of it.
  drift: number
  radius: number
  // 0–1.
  opacity: number
}

const smoothstep = (share: number) => share * share * (3 - 2 * share)

// A puff of steam `age` of the way through its life: 0 as it leaves the chimney's mouth, 1 when it is gone.
export function puffAt(age: number): Puff {
  // It shows within the first tenth of its life, then thins out for the rest of it.
  const shown = smoothstep(Math.min(1, age / 0.1))

  return {
    // Faster out of the chimney than once it has cooled.
    rise: PLUME_RISE * (1 - (1 - age) ** 1.3),
    // The wind takes hold as the puff slows down.
    drift: PLUME_DRIFT * age ** 1.8,
    radius: PUFF_RADIUS[0] + (PUFF_RADIUS[1] - PUFF_RADIUS[0]) * age ** 0.8,
    opacity: shown * (1 - age),
  }
}
