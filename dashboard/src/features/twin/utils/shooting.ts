import { figureHeight, sweptTo } from './figure'
import type { GroundPoint } from './site'

// Not a signal, and nothing the Outpost answers to: an Operator who points a finger at the Twin has a sight
// over it, and one who brings their thumb down fires at what it is on. An intruder's figurine that is hit
// comes apart in motes of light and is swept in again a few seconds on: its Alert is as active as it was.

export type Triple = readonly [x: number, y: number, z: number]

// How far from a figurine's axis a shot still hits it, in scene units: wider than it is, a fingertip in the
// air is no rifle.
export const HIT_RADIUS = 0.2
// Seconds a figurine that was hit stays gone before its sweep brings it back.
export const STRUCK_SECONDS = 3
// How far a shot that hits nothing goes, in scene units, and the seconds its trace shows.
export const SHOT = { reach: 30, trace: 0.22 } as const

// What the sight and the figurines tell each other, from one frame to the next: neither knows the other.
export interface Range {
  // The figurines that can be pointed at and hit as this frame is drawn, told by whoever draws them: who each
  // is in their Alert, whether the camera follows them, and for how many seconds they have been shown.
  standing: { id: string; key: string; at: GroundPoint; followed: boolean; age: number }[]
  // Those a shot took apart, and for how many seconds.
  struck: Map<string, number>
}

export const createRange = (): Range => ({ standing: [], struck: new Map() })

// How far along a shot from `origin` toward `direction`, a unit vector, it passes a figurine standing at `at`
// within HIT_RADIUS of its axis, feet to head. Null when it misses.
export function hitAt(origin: Triple, direction: Triple, at: GroundPoint): number | null {
  const [dx, dy, dz] = direction
  const toOrigin: Triple = [origin[0] - at.x, origin[1], origin[2] - at.z]
  const along = dx * toOrigin[0] + dy * toOrigin[1] + dz * toOrigin[2]
  const across = 1 - dy * dy
  // The height on the axis nearest the shot's line, kept on the figurine; a shot straight down its axis is
  // nearest all of it.
  const height = Math.min(figureHeight(), Math.max(0, across > 1e-9 ? (toOrigin[1] - dy * along) / across : 0))
  const reached = Math.max(0, height * dy - along)
  const miss = Math.hypot(toOrigin[0] + reached * dx, toOrigin[1] + reached * dy - height, toOrigin[2] + reached * dz)
  return miss <= HIT_RADIUS ? reached : null
}

// Where a shot that hits no one ends: on the ground, or as far as it reaches over it.
export function landsAt(origin: Triple, direction: Triple): [number, number, number] {
  const toGround = direction[1] < 0 ? -origin[1] / direction[1] : Infinity
  const reached = Math.min(SHOT.reach, toGround)
  return [origin[0] + reached * direction[0], origin[1] + reached * direction[1], origin[2] + reached * direction[2]]
}

// What shows of a figurine hit `since` seconds ago (undefined: it was not): nothing of it for STRUCK_SECONDS,
// then all of it again, `swept` of the way up from its feet.
export function struckFigurine(since: number | undefined): { level: 0 | 1; swept: number } {
  if (since === undefined) return { level: 1, swept: 1 }
  if (since < STRUCK_SECONDS) return { level: 0, swept: 0 }
  return { level: 1, swept: sweptTo(since - STRUCK_SECONDS) }
}

// Whether a figurine hit `since` seconds ago is whole again: nothing more to tell of it.
export function isWhole(since: number): boolean {
  return struckFigurine(since).swept === 1
}

// What a shot leaves where it ends: motes of light that fly off and go out. `motes` when a figurine comes
// apart, `sparks` on anything else. They last `seconds`, leave at up to `speed` scene units a second and slow
// down by `drag`, rise by `lift` and are `size` across as they start.
export const BURST = { motes: 240, sparks: 48, seconds: 1.5, speed: 1.1, drag: 3, lift: 0.35, size: 0.016 } as const

export interface BurstMote {
  x: number
  y: number
  z: number
  size: number
}

// Each mote has its own place in the figurine and its own way out of it: the golden ratio and its powers
// spread them, the same at every shot.
const SPREAD = { round: 0.618, up: 0.755, out: 0.57, pace: 0.819 } as const

// Where the mote `index` is `age` seconds after the shot, from the point it hit: it starts within `tall` of
// height above it and `wide` around it (0 and 0: all from the one point), flies outward and a little up,
// slows down, and shrinks to nothing by BURST.seconds.
export function burstMote(index: number, age: number, tall = 0, wide = 0): BurstMote {
  const { seconds, speed, drag, lift, size } = BURST
  const share = (spread: number) => ((index + 1) * spread) % 1
  const round = 2 * Math.PI * share(SPREAD.round)
  const from = wide * Math.sqrt(share(SPREAD.out))
  const pace = speed * (0.25 + 0.75 * share(SPREAD.pace))
  // How far a mote that slows down has got: all its way in a few tenths of a second.
  const flown = (pace * (1 - Math.exp(-drag * Math.max(0, age)))) / drag
  const climb = 2 * share(SPREAD.up) - 1
  const left = Math.min(1, Math.max(0, 1 - age / seconds))

  return {
    x: Math.cos(round) * (from + flown),
    y: tall * share(SPREAD.up) + flown * 0.6 * climb + lift * age,
    z: Math.sin(round) * (from + flown),
    size: size * left * left,
  }
}
