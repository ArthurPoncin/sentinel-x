// Seconds a wisp of haze lives: slower than steam, gas that leaks is heavier than air and creeps.
export const WISP_LIFE = 9
// How far a wisp creeps from the gas pipe over its life, in scene units.
export const HAZE_CREEP = 0.55
// A wisp's radius as it seeps from the pipe, and when it is gone.
const WISP_RADIUS = [0.12, 0.52] as const

export interface Wisp {
  // How far from the pipe, over the ground.
  creep: number
  // How far down it has sunk, 0–1: 0 at the pipe's height, 1 lying on the ground.
  sink: number
  radius: number
  // 0–1, for the thickest haze: the scene thins it out by the gas level.
  opacity: number
}

const smoothstep = (share: number) => {
  const held = Math.min(1, Math.max(0, share))
  return held * held * (3 - 2 * held)
}

// A wisp of haze `age` of the way through its life: 0 as it seeps from the pipe, 1 when it is gone.
export function wispAt(age: number): Wisp {
  return {
    // Quick out of the pipe, slower as it spreads over the ground.
    creep: HAZE_CREEP * (1 - (1 - age) ** 1.6),
    // It is down within the first half of its life, and lies there for the other.
    sink: 1 - (1 - Math.min(1, age / 0.5)) ** 2,
    radius: WISP_RADIUS[0] + (WISP_RADIUS[1] - WISP_RADIUS[0]) * age ** 0.7,
    // It shows within the first fifth of its life and thins out over the second half: in between the haze
    // holds, a bank around the pipe rather than a plume leaving it.
    opacity: smoothstep(age / 0.2) * (1 - smoothstep((age - 0.5) / 0.5)),
  }
}
