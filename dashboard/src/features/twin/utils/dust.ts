import { SITE } from './site'

// The dust in the air over the site. A few motes, all carried the one way by a wind that never drops: toward
// `wind`, a bearing of the site plan, at `speed` scene units a second, give or take `gusts` of it from a mote
// to the next. They drift between `floor` and `ceiling` above the ground, rising and falling by `bob`, and a
// mote is `size` across at its smallest and at its largest.
export const DUST = {
  motes: 44,
  wind: 1.9,
  speed: 0.11,
  gusts: 0.25,
  floor: 0.35,
  ceiling: 2.3,
  bob: 0.05,
  size: [0.007, 0.015],
} as const

// How much of its way across the site a mote takes to show, and as much to vanish.
const SHOWS = 0.15
// Each mote has its own line across the site, its own height, its own place on its way and its own pace: the
// golden ratio and its powers spread them, the same at every load.
const SPREAD = { across: 0.618, up: 0.755, along: 0.57, pace: 0.819 } as const

export interface Mote {
  x: number
  // How high above the ground.
  y: number
  z: number
  // How far across it is drawn: 0 as it comes over the socle's rim, and when it leaves over the other side.
  size: number
}

const smoothstep = (share: number) => {
  const held = Math.min(1, Math.max(0, share))
  return held * held * (3 - 2 * held)
}

// Where the mote `index` is, `seconds` into the Twin's time: it crosses the site in a straight line, from the
// socle's rim upwind to its rim downwind, then starts over. It is never off the socle.
export function moteAt(index: number, seconds: number): Mote {
  const { wind, speed, gusts, floor, ceiling, bob, size } = DUST
  const share = (spread: number) => ((index + 1) * spread) % 1
  // Its line across the site: how far to the side of the centre, and half how long it is over the socle.
  const aside = (2 * share(SPREAD.across) - 1) * 0.96 * SITE.socle.radius
  const half = Math.sqrt(SITE.socle.radius ** 2 - aside ** 2)
  const pace = speed * (1 + gusts * (2 * share(SPREAD.pace) - 1))
  const crossed = (share(SPREAD.along) + (seconds * pace) / (2 * half)) % 1
  const along = (2 * crossed - 1) * half

  return {
    x: along * Math.sin(wind) + aside * Math.cos(wind),
    y: floor + bob + (ceiling - floor - 2 * bob) * share(SPREAD.up) + bob * Math.sin(seconds * 0.4 + index),
    z: along * Math.cos(wind) - aside * Math.sin(wind),
    size: (size[0] + (size[1] - size[0]) * share(SPREAD.up)) * smoothstep(crossed / SHOWS) * smoothstep((1 - crossed) / SHOWS),
  }
}
