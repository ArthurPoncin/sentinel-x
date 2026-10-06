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
  // The disc of terrain everything stands on. Its top is the ground, at height 0.
  socle: { radius: 3.2, thickness: 0.32 },
  // The micro power plant, on the right of the site, where the Enclosure's shadow does not reach: the
  // generator hall, its two chimneys behind it, the transformer station behind the Enclosure.
  hall: { x: 1, z: -1.2, width: 1.6, depth: 0.95, height: 0.7 },
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
  // The perimeter: a fence of posts around the site, open at the gate, front left. The gate's `width` runs
  // along the fence.
  fence: { radius: 2.8, height: 0.26, posts: 48, gate: { bearing: -0.355, width: 0.7 } },
  // Where the Enclosure's mast stands, the ground kept for its foot, and the bearing it faces: beside the
  // way in, so that its lens, which is off the mast, looks straight out through the gate.
  enclosure: { x: -0.5, z: 0.5, radius: 0.6, heading: 0 },
  // The camera's horizontal field of view, in radians: 60°, to set to the lens once the camera is mounted.
  camera: { fov: Math.PI / 3 },
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

// Where the fence's posts stand: evenly spaced, from one side of the gate round the site to the other.
export function fencePosts(): GroundPoint[] {
  const { radius, posts, gate } = SITE.fence
  const bay = (2 * Math.PI - 2 * halfGate()) / (posts - 1)

  return Array.from({ length: posts }, (_, post) => toward(gate.bearing + halfGate() + post * bay, radius))
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
