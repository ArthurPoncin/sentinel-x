import { ENCLOSURE_SHAPE } from './enclosure-parts'

// A point of the Outpost's ground plan, in scene units from the socle's centre: x to the right, z toward
// the entrance. A bearing is an angle around the vertical: 0 toward the entrance, growing toward x.
export interface GroundPoint {
  x: number
  z: number
}

// A part with a rectangular footprint centred on its point, `width` along x and `depth` along z.
export interface Block extends GroundPoint {
  width: number
  depth: number
  height: number
}

// A part with a round footprint.
export interface Column extends GroundPoint {
  radius: number
  height: number
}

// The Outpost's ground plan, defined once: what the Twin draws and what its reactions are anchored on.
export const SITE = {
  // The disc of terrain everything stands on. Its top is the ground, at height 0. The Status's ring runs
  // around its rim, `ring` wide.
  socle: { radius: 3.2, thickness: 0.32, ring: 0.06 },
  // The micro power plant, on the right of the site, where the Enclosure's shadow does not reach: the
  // generator hall, its two chimneys behind it, the transformer station behind the Enclosure. The hall's door
  // is on its front wall, its middle `along` from the wall's, toward x.
  hall: { x: 1, z: -1.2, width: 1.6, depth: 0.95, height: 0.7, door: { along: 0.48, width: 0.36, height: 0.34 } },
  chimneys: [
    { x: 0.55, z: -2.05, radius: 0.12, height: 1.6 },
    { x: 1.1, z: -2.05, radius: 0.12, height: 1.6 },
  ],
  transformer: { x: -0.55, z: -1.5, width: 1.1, depth: 0.9, height: 0.55 },
  // The gas tank, lying along x, and the pipe that feeds the hall from it: `path` is the pipe's axis, from
  // the hall's wall to the tank's end, `height` above the ground.
  tank: { x: 1.2, z: 0.8, width: 0.9, depth: 0.4, height: 0.5 },
  pipe: {
    path: [
      { x: 0.45, z: -0.725 },
      { x: 0.45, z: 0.8 },
      { x: 0.75, z: 0.8 },
    ],
    radius: 0.045,
    height: 0.3,
  },
  // The perimeter: a fence of posts around the site, closed at the gate, front left. A chain-link mesh runs
  // between the posts, `height` high and `mesh.rows` diamonds up; a strand of barbed wire runs `barbed.rise`
  // over it, on top of the posts, with a barb every `barbed.every` along it. The gate's `width` runs along
  // the fence, from the post on one side of it to the post on the other: a pillar stands on each, and a leaf
  // hangs from each pillar.
  fence: {
    radius: 2.8,
    height: 0.26,
    posts: 48,
    mesh: { rows: 6 },
    barbed: { rise: 0.04, every: 0.075 },
    gate: {
      bearing: -0.355,
      width: 0.7,
      pillar: { width: 0.045, height: 0.338 },
      leaf: { width: 0.32, height: 0.26 },
    },
  },
  // Where the Enclosure's mast stands, the ground kept for its foot, and the bearing it faces: beside the
  // way in, so that its lens, which is off the mast, looks straight out through the gate.
  enclosure: { x: -0.5, z: 0.5, radius: 0.6, heading: 0 },
  // The camera's horizontal field of view, in radians: 60°, to set to the lens once the camera is mounted.
  camera: { fov: Math.PI / 3 },
  // The signage of a sensitive site. A no-entry sign hangs on the fence on each side of the gate, `width`
  // along the fence, in the middle of a bay: the second from the gate, since whoever the camera sees through
  // the gate stands in the first. The danger zone is marked on the ground around the gas tank: clear ground
  // `margin` wide around its footprint, then a hatched band `band` wide. A gas pictogram is on the tank's
  // barrel, on the side that faces `bearing`: `width` along the tank, `height` round it. The site's name is on
  // the hall's wall that faces `bearing`: its middle `along` from the wall's, toward the right of whoever
  // reads it, its lower edge `foot` above the ground.
  signs: {
    gate: { bay: 2, width: 0.3, height: 0.22 },
    dangerZone: { margin: 0.1, band: 0.14 },
    tank: { bearing: 0, width: 0.34, height: 0.2 },
    hall: { bearing: 0, along: -0.09, width: 0.6, height: 0.24, foot: 0.1 },
  },
  // The track, `width` wide. It comes in through the gate and goes to the hall's door by the points of `via`,
  // its turns rounded: round the front of the gas tank and its far end, since the pipe bars the short way.
  // Outside the gate it runs straight on to the socle's rim, where it stops: it leads nowhere.
  track: {
    width: 0.24,
    via: [
      { x: -0.78, z: 2.11 },
      { x: 0.25, z: 1.72 },
      { x: 1.7, z: 1.75 },
      { x: 2.25, z: 1.15 },
      { x: 2.25, z: 0.15 },
      { x: 1.48, z: -0.2 },
    ],
  },
  // The rocks around the site, between the fence and the Status's ring: `count` of them at most, drawn from
  // `seed`, so the same on every load. `radius` is the least and the most of a rock's footprint, `squat` of
  // its height for that footprint; each keeps `off` clear of the fence's line. None lies within `clear` of
  // the gate's bearing, in radians: from one no-entry sign round to the other, the way in and the signs stay
  // in sight.
  rocks: { seed: 101, count: 60, radius: [0.04, 0.145], squat: [0.7, 1.3], off: 0.03, clear: 0.4 },
} as const

// The point `distance` away from the socle's centre along `bearing`.
const toward = (bearing: number, distance = 1): GroundPoint => ({
  x: distance * Math.sin(bearing),
  z: distance * Math.cos(bearing),
})

// The bearing to face, standing at `from`, to look at `to`.
export function bearingTo(from: GroundPoint, to: GroundPoint): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

// Half the angle the gate opens by, seen from the socle's centre.
export function halfGate(): number {
  const { radius, gate } = SITE.fence
  return gate.width / radius / 2
}

// The middle of the gate, on the fence's line: the way in, where whoever comes near the site is headed.
export function gatePoint(): GroundPoint {
  return toward(SITE.fence.gate.bearing, SITE.fence.radius)
}

// How long the fence is, from one side of the gate round the site to the other.
export function fenceLength(): number {
  return SITE.fence.radius * 2 * (Math.PI - halfGate())
}

// `count` points of the fence's line, evenly spaced from one side of the gate round the site to the other.
function alongFence(count: number): GroundPoint[] {
  const { radius, gate } = SITE.fence
  const step = (2 * Math.PI - 2 * halfGate()) / (count - 1)

  return Array.from({ length: count }, (_, index) => toward(gate.bearing + halfGate() + index * step, radius))
}

// Where the fence's posts stand: evenly spaced, from one side of the gate round the site to the other.
export function fencePosts(): GroundPoint[] {
  return alongFence(SITE.fence.posts)
}

// The angle from one post of the fence to the next, seen from the socle's centre: a bay.
function fenceBay(): number {
  return fenceLength() / SITE.fence.radius / (SITE.fence.posts - 1)
}

// How wide a diamond of the fence's mesh is, and how high: the mesh is `mesh.rows` of them up.
export function meshCell(): number {
  return SITE.fence.height / SITE.fence.mesh.rows
}

// How high the strand of barbed wire runs: over the mesh, on top of the posts that carry it.
export function barbedHeight(): number {
  return SITE.fence.height + SITE.fence.barbed.rise
}

// Where the barbs of the barbed wire are, over the ground: evenly spaced along the strand between the gate's
// two pillars, none on a pillar, as near `barbed.every` apart as its length allows.
export function fenceBarbs(): GroundPoint[] {
  return alongFence(Math.round(fenceLength() / SITE.fence.barbed.every) + 1).slice(1, -1)
}

// The gate, closed: the straight line it stands on, from the middle of one pillar to the middle of the other,
// and `opening`, what the pillars leave between them for its two leaves.
export function gateLine(): { from: GroundPoint; to: GroundPoint; opening: number } {
  const { radius, gate } = SITE.fence
  const [from, to] = [toward(gate.bearing + halfGate(), radius), toward(gate.bearing - halfGate(), radius)]

  return { from, to, opening: Math.hypot(to.x - from.x, to.z - from.z) - gate.pillar.width }
}

// A sign of the site: where its middle is over the ground, and the bearing it faces.
export interface SignPoint extends GroundPoint {
  bearing: number
}

// Where the two no-entry signs hang: on the fence's line, in the middle of the bay the plan gives them on each
// side of the gate, facing out of the site.
export function gateSigns(): SignPoint[] {
  const { radius, gate } = SITE.fence

  return [-1, 1].map((side) => {
    const bearing = gate.bearing + side * (halfGate() + (SITE.signs.gate.bay - 0.5) * fenceBay())
    return { ...toward(bearing, radius), bearing }
  })
}

// The ground marked as dangerous around the gas tank, out to the outer edge of its band: the tank's
// footprint, the clear ground around it, then the band.
export function dangerZone(): GroundPoint & Pick<Block, 'width' | 'depth'> {
  const { tank, signs } = SITE
  const around = 2 * (signs.dangerZone.margin + signs.dangerZone.band)

  return { x: tank.x, z: tank.z, width: tank.width + around, depth: tank.depth + around }
}

// Where the site's name is written: on the hall's wall that faces the bearing the plan gives, as far along
// it as the plan says, facing out of the hall.
export function hallSign(): SignPoint {
  const { hall, signs } = SITE
  const { bearing, along } = signs.hall

  return {
    x: hall.x + (Math.sin(bearing) * hall.width) / 2 + along * Math.cos(bearing),
    z: hall.z + (Math.cos(bearing) * hall.depth) / 2 - along * Math.sin(bearing),
    bearing,
  }
}

// The point `share` of the way along the gas pipe, over the ground: 0 at the hall's wall, 1 at the tank. The
// haze of a gas leak seeps from there.
export function alongPipe(share: number): GroundPoint {
  const [start, ...rest] = SITE.pipe.path
  const stretches = rest.map((to, index) => {
    const from = index === 0 ? start : (rest[index - 1] ?? to)
    return { from, to, length: Math.hypot(to.x - from.x, to.z - from.z) }
  })
  let left = Math.min(1, Math.max(0, share)) * stretches.reduce((sum, { length }) => sum + length, 0)
  for (const { from, to, length } of stretches) {
    if (left <= length) {
      return { x: from.x + ((to.x - from.x) * left) / length, z: from.z + ((to.z - from.z) * left) / length }
    }
    left -= length
  }
  return rest.at(-1) ?? start
}

// Where the camera's lens is, over the ground: on the Enclosure's front, off its mast.
export function lensPoint(): GroundPoint {
  const { x, z, heading } = SITE.enclosure
  const { scale, lens } = ENCLOSURE_SHAPE
  // The Enclosure's own frame, turned to its heading.
  return {
    x: x + scale * (lens.x * Math.cos(heading) + lens.z * Math.sin(heading)),
    z: z + scale * (lens.z * Math.cos(heading) - lens.x * Math.sin(heading)),
  }
}

// How high the camera's lens is above the ground: the end of the line it draws to what it sees.
export function lensHeight(): number {
  const { scale, lens } = ENCLOSURE_SHAPE
  return scale * lens.y
}

// Where the camera's sight meets the fence, for what stands at `xNorm` across its image: 0 = left edge,
// 1 = right edge. The intruder of an `intrusion` Alert stands there.
export function watchedPoint(xNorm: number): GroundPoint {
  const { enclosure, camera, fence } = SITE
  const lens = lensPoint()
  // A lens spreads its image evenly over a plane, not over an angle. Its right is toward smaller bearings.
  const sight = toward(enclosure.heading - Math.atan((2 * xNorm - 1) * Math.tan(camera.fov / 2)))
  // From the lens out to the fence's circle, along the sight line.
  const along = lens.x * sight.x + lens.z * sight.z
  const reach = Math.sqrt(along ** 2 + fence.radius ** 2 - lens.x ** 2 - lens.z ** 2) - along

  return { x: lens.x + reach * sight.x, z: lens.z + reach * sight.z }
}

// How far round the fence a point of it is, in scene units: 0 toward the entrance, growing toward x. The
// difference between two points is how far the intruder walks from one to the other.
export function roundFence(point: GroundPoint): number {
  return SITE.fence.radius * Math.atan2(point.x, point.z)
}

// The bearing to face, standing on the fence at `point`, to walk along it: toward the right of the camera's
// image (`way` 1) or toward its left (-1).
export function bearingAlongFence(point: GroundPoint, way: number): number {
  // The fence is a circle around the socle's centre, and the camera's right is toward smaller bearings.
  return Math.atan2(point.x, point.z) - (way < 0 ? -1 : 1) * (Math.PI / 2)
}

// Where the hall's door is, over the ground: on its front wall, where the track ends.
export function hallDoor(): GroundPoint {
  const { x, z, depth, door } = SITE.hall
  return { x: x + door.along, z: z + depth / 2 }
}

// A path with its turns rounded: each corner is cut, `times` over, and both its ends stay where they are.
function rounded(path: readonly GroundPoint[], times: number): GroundPoint[] {
  let points = [...path]
  for (let time = 0; time < times; time++) {
    const cut = points.slice(1).flatMap((to, index) => {
      const from = points[index] ?? to
      return [0.25, 0.75].map((share) => ({ x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share }))
    })
    points = [...points.slice(0, 1), ...cut, ...points.slice(-1)]
  }
  return points
}

// The track's two stretches, each the line its middle follows, from the gate: `toHall` in to the hall's
// door, `toEdge` out to the socle's rim.
export function track(): { toHall: GroundPoint[]; toEdge: GroundPoint[] } {
  const gate = gatePoint()

  return {
    toHall: rounded([gate, ...SITE.track.via, hallDoor()], 3),
    toEdge: [gate, toward(SITE.fence.gate.bearing, SITE.socle.radius)],
  }
}

// How far `point` is from a path, the nearest point of it.
export function fromPath(point: GroundPoint, path: readonly GroundPoint[]): number {
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 1; index < path.length; index++) {
    const [from, to] = [path[index - 1], path[index]]
    if (!from || !to) continue
    const [alongX, alongZ] = [to.x - from.x, to.z - from.z]
    const length = alongX ** 2 + alongZ ** 2
    const share =
      length === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - from.x) * alongX + (point.z - from.z) * alongZ) / length))
    nearest = Math.min(nearest, Math.hypot(point.x - from.x - share * alongX, point.z - from.z - share * alongZ))
  }
  return nearest
}

// A rock: its footprint is `radius` around its point, it stands `height` high, turned to `turn`.
export interface Rock extends GroundPoint {
  radius: number
  height: number
  turn: number
}

// Numbers from 0 to 1 drawn from `seed`: the same ones, in the same order, every time (mulberry32).
function drawnFrom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

// How much of each other two rocks may take, as a share of their radii put end to end: they lie in heaps.
const HEAPED = 0.75
// Draws for a rock before giving up on the count the plan asks for.
const DRAWS = 40

// The rocks around the site: outside the fence and inside the Status's ring, none in front of the gate nor
// on the track, many small ones and a few large. Drawn from the plan's seed: the same on every call.
export function rocks(): Rock[] {
  const { socle, fence } = SITE
  const { seed, count, radius, squat, off, clear } = SITE.rocks
  const next = drawnFrom(seed)
  const between = (least: number, most: number, share: number) => least + (most - least) * share
  const paths = Object.values(track())
  const placed: Rock[] = []

  for (let draw = 0; placed.length < count && draw < count * DRAWS; draw++) {
    // Every draw takes the same numbers, kept or not.
    const [size, bearing, out, tall, turn] = [next(), next(), next(), next(), next()]
    const wide = between(radius[0], radius[1], size ** 1.7)
    const [inner, outer] = [fence.radius + off + wide, socle.radius - socle.ring - wide]
    const fromGate = bearing * 2 * Math.PI - Math.PI
    const rock: Rock = {
      ...toward(fence.gate.bearing + fromGate, between(inner, outer, out)),
      radius: wide,
      height: wide * between(squat[0], squat[1], tall),
      turn: turn * 2 * Math.PI,
    }
    if (outer < inner || Math.abs(fromGate) < clear) continue
    if (paths.some((path) => fromPath(rock, path) < wide + SITE.track.width / 2)) continue
    if (placed.some((other) => Math.hypot(other.x - rock.x, other.z - rock.z) < (other.radius + wide) * HEAPED)) continue
    placed.push(rock)
  }
  return placed
}
