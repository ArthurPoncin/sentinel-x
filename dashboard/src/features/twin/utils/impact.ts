// Seconds the wave of an impact takes to spread over the shield and fade out. The shield does not wait for it:
// the wave plays to its end whatever the attack does.
export const IMPACT_LIFE = 1.2
// Impacts drawn at once, and the seconds between two that makes: a brute force refused many times a second
// strikes the dome a few times a second, each wave told from the last, and neither whitens it nor costs more
// to draw than a slow one.
export const MAX_IMPACTS = 6
export const IMPACT_GAP = IMPACT_LIFE / MAX_IMPACTS
// How far a wave spreads from the point struck, as the straight line between two points of a dome of radius 1:
// a good part of the dome, not all of it, so that where it was struck still reads.
export const IMPACT_REACH = 0.9
// How wide the wave's band is as it leaves the point struck, and once it has spread, on the same measure.
export const IMPACT_WIDTH = [0.03, 0.1] as const
// How high on the dome it is struck, as on half a sphere of radius 1: above what stands on the site, which
// would hide the wave, and under the label at its top.
export const IMPACT_HEIGHT = [0.3, 0.85] as const

// A point of the dome, as on half a sphere of radius 1 standing on the ground: x, y up, z.
export type DomePoint = readonly [number, number, number]

// An impact on the shield: when it struck, in seconds on a clock that only goes forward, and where.
export interface Impact {
  startedAt: number
  at: DomePoint
}

// What the shield took so far: the instant of the last strike it was told of, in ms since the epoch, null while
// it is lowered; how many it took, which tells where the next one lands; and the impacts whose wave still spreads.
export interface Struck {
  seen: number | null
  count: number
  impacts: readonly Impact[]
}

// A shield as the Twin opens on it: the strike it already shows is past, and sends no wave.
export function unstruck(struckAt: number | null): Struck {
  return { seen: struckAt, count: 0, impacts: [] }
}

// The golden angle: points a turn of it apart never line up around the dome.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

// Where the `count`-th impact lands: round the dome by the golden angle, up and down it by another step that
// never repeats, so that two in a row are far apart and no place is struck twice.
export function impactPoint(count: number): DomePoint {
  const [low, high] = IMPACT_HEIGHT
  const y = low + (high - low) * ((count * Math.SQRT1_2) % 1)
  const out = Math.sqrt(1 - y * y)
  return [out * Math.cos(count * GOLDEN_ANGLE), y, out * Math.sin(count * GOLDEN_ANGLE)]
}

// What the shield took by `now`, told the instant of its last strike (`struckAt`, null while it is lowered): the
// impacts of `struck` still spreading, and one more if the strike moved on since, the shield raised or its
// Alert raised again. An impact never cuts another: each plays to its end. A strike less than IMPACT_GAP after
// the last impact is taken with it, and past MAX_IMPACTS the oldest go first. A strike that goes back in time
// is a replay wound back, and a shield lowered may be one wound back to before its attack: what was spreading
// then has not happened yet, and is dropped.
export function struckBy(struck: Struck, struckAt: number | null, now: number): Struck {
  if (struckAt === null || (struck.seen !== null && struckAt < struck.seen)) {
    return struckAt === struck.seen && struck.impacts.length === 0 ? struck : { ...struck, seen: struckAt, impacts: [] }
  }
  const going = struck.impacts.filter((impact) => now < impact.startedAt + IMPACT_LIFE)
  if (struckAt === struck.seen) return going.length === struck.impacts.length ? struck : { ...struck, impacts: going }

  const last = going.at(-1)
  if (last && now - last.startedAt < IMPACT_GAP) return { ...struck, seen: struckAt, impacts: going }
  return {
    seen: struckAt,
    count: struck.count + 1,
    impacts: [...going, { startedAt: now, at: impactPoint(struck.count) }].slice(-MAX_IMPACTS),
  }
}

// The wave of an impact as it shows: how far from the point struck its band is, how wide that band is, both
// as the straight line between two points of a dome of radius 1, and how bright, 0–1.
export interface ImpactShape {
  at: DomePoint
  radius: number
  width: number
  glow: number
}

const smoothstep = (share: number) => {
  const held = Math.min(1, Math.max(0, share))
  return held * held * (3 - 2 * held)
}

// The wave of an impact `elapsed` seconds after the strike, or null before it and once it is gone. Fast as it
// leaves, slower as it spreads; it lights up at once, a flash where it struck, and fades out over the rest, all
// the way to nothing as its life ends, so it goes without a cut.
export function impactShape(elapsed: number): Omit<ImpactShape, 'at'> | null {
  if (elapsed < 0 || elapsed >= IMPACT_LIFE) return null
  const age = elapsed / IMPACT_LIFE
  const spread = 1 - (1 - age) ** 3

  return {
    radius: IMPACT_REACH * spread,
    width: IMPACT_WIDTH[0] + (IMPACT_WIDTH[1] - IMPACT_WIDTH[0]) * spread,
    glow: smoothstep(age / 0.04) * (1 - age) ** 1.5,
  }
}
