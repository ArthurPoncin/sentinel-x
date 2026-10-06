import { describe, expect, it } from 'vitest'
import { ENCLOSURE_SHAPE } from './enclosure-parts'
import {
  alongPipe,
  type Block,
  bearingTo,
  fencePosts,
  type GroundPoint,
  lensHeight,
  lensPoint,
  SITE,
  watchedPoint,
} from './site'

// Across the camera's image, edge to edge.
const ACROSS = [0, 0.15, 0.35, 0.5, 0.55, 0.75, 1]

const fromCentre = (point: GroundPoint) => Math.hypot(point.x, point.z)
const between = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z)

const corners = ({ x, z, width, depth }: Block): GroundPoint[] =>
  [-1, 1].flatMap((side) => [-1, 1].map((end) => ({ x: x + (side * width) / 2, z: z + (end * depth) / 2 })))

// The outline of what stands inside the fence, part by part: the corners of a block, the rim of a round part.
function outlines(): Record<string, GroundPoint[]> {
  const rim = ({ x, z, radius }: GroundPoint & { radius: number }): GroundPoint[] =>
    Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8).map((bearing) => ({
      x: x + radius * Math.sin(bearing),
      z: z + radius * Math.cos(bearing),
    }))
  const { hall, chimneys, transformer, tank, pipe, enclosure } = SITE

  return {
    hall: corners(hall),
    'first chimney': rim(chimneys[0]),
    'second chimney': rim(chimneys[1]),
    transformer: corners(transformer),
    tank: corners(tank),
    pipe: pipe.path.flatMap((point) => rim({ ...point, radius: pipe.radius })),
    Enclosure: rim(enclosure),
  }
}

const reach = (outline: GroundPoint[]) => Math.max(...outline.map(fromCentre))

const lens = lensPoint()
// The way the Enclosure faces, and its lens looks.
const ahead = { x: Math.sin(SITE.enclosure.heading), z: Math.cos(SITE.enclosure.heading) }
// How far `point` stands to the left of the lens's line of sight; negative on its right.
const toTheLeft = (point: GroundPoint) => ahead.z * (point.x - lens.x) - ahead.x * (point.z - lens.z)
// How far `point` stands in front of the lens; negative behind it.
const inFront = (point: GroundPoint) => ahead.x * (point.x - lens.x) + ahead.z * (point.z - lens.z)

describe('the site', () => {
  it('stands on the socle, fence included', () => {
    expect(SITE.fence.radius).toBeLessThan(SITE.socle.radius)
    for (const [part, outline] of Object.entries(outlines())) {
      expect(reach(outline), part).toBeLessThan(SITE.socle.radius)
    }
  })

  it('gives each part its own ground, the pipe aside which joins two of them', () => {
    const { pipe: _, ...parts } = outlines()
    const span = (outline: GroundPoint[], axis: 'x' | 'z') => {
      const along = outline.map((point) => point[axis])
      return [Math.min(...along), Math.max(...along)] as const
    }
    const apart = (a: GroundPoint[], b: GroundPoint[]) =>
      (['x', 'z'] as const).some((axis) => span(a, axis)[1] < span(b, axis)[0] || span(b, axis)[1] < span(a, axis)[0])
    const names = Object.keys(parts)

    for (const [i, name] of names.entries()) {
      for (const other of names.slice(i + 1)) {
        expect(apart(parts[name] ?? [], parts[other] ?? []), `${name} and ${other}`).toBe(true)
      }
    }
  })

  it('is fenced all around, with room to walk along the fence', () => {
    const WALKWAY = 0.3

    for (const [part, outline] of Object.entries(outlines())) {
      expect(reach(outline), part).toBeLessThan(SITE.fence.radius - WALKWAY)
    }
  })
})

describe('the fence', () => {
  const { fence } = SITE
  const TURN = 2 * Math.PI
  // How far round the site a post stands from the middle of the gate, 0 to a full turn.
  const round = (post: GroundPoint) => (Math.atan2(post.x, post.z) - fence.gate.bearing + 2 * TURN) % TURN

  it('stands its posts on the perimeter, evenly spaced from one side of the gate round to the other', () => {
    const posts = fencePosts()
    const turns = posts.map(round).sort((a, b) => a - b)
    const halfGate = fence.gate.width / fence.radius / 2
    const bay = (TURN - 2 * halfGate) / (fence.posts - 1)

    expect(posts).toHaveLength(fence.posts)
    for (const post of posts) expect(fromCentre(post)).toBeCloseTo(fence.radius)
    expect(turns.at(0)).toBeCloseTo(halfGate)
    expect(turns.at(-1)).toBeCloseTo(TURN - halfGate)
    turns.slice(1).forEach((turn, i) => {
      expect(turn - (turns[i] ?? 0)).toBeCloseTo(bay)
    })
  })

  it('leaves a gate wider than its bays', () => {
    const [first, second] = fencePosts()

    expect(first && second && Math.hypot(first.x - second.x, first.z - second.z)).toBeLessThan(fence.gate.width / 1.5)
  })
})

describe('the gas pipe', () => {
  const { pipe, hall, tank } = SITE
  // How far outside `block`'s walls `point` is: 0 on a wall, negative inside.
  const outside = (point: GroundPoint, { x, z, width, depth }: Block) =>
    Math.max(Math.abs(point.x - x) - width / 2, Math.abs(point.z - z) - depth / 2)

  it("runs from the hall's wall to the tank, clear of both on the way", () => {
    const [start, ...bends] = pipe.path
    const end = bends.pop()

    expect(outside(start, hall)).toBeCloseTo(0)
    expect(end && outside(end, tank)).toBeCloseTo(0)
    for (const bend of bends) {
      expect(outside(bend, hall)).toBeGreaterThan(pipe.radius)
      expect(outside(bend, tank)).toBeGreaterThan(pipe.radius)
    }
  })

  it('meets them off the ground and under their top', () => {
    expect(pipe.height - pipe.radius).toBeGreaterThan(0)
    expect(pipe.height + pipe.radius).toBeLessThan(Math.min(hall.height, tank.height))
  })

  it('is followed from the hall to the tank, through its bend', () => {
    const [start, bend, end] = pipe.path
    const lengths = [between(start, bend), between(bend, end)] as const

    expect(alongPipe(0)).toEqual(start)
    expect(between(alongPipe(lengths[0] / (lengths[0] + lengths[1])), bend)).toBeCloseTo(0)
    expect(between(alongPipe(1), end)).toBeCloseTo(0)
    // No further than its ends.
    expect(alongPipe(-0.5)).toEqual(alongPipe(0))
    expect(alongPipe(1.5)).toEqual(alongPipe(1))
  })

  it('is followed at an even pace, without leaving it', () => {
    const STEPS = 40
    const [start, bend, end] = pipe.path
    const points = Array.from({ length: STEPS + 1 }, (_, step) => alongPipe(step / STEPS))
    // How far `point` is from the stretch that runs from `from` to `to`.
    const off = (point: GroundPoint, from: GroundPoint, to: GroundPoint) => {
      const [x, z] = [to.x - from.x, to.z - from.z]
      const share = Math.min(1, Math.max(0, ((point.x - from.x) * x + (point.z - from.z) * z) / (x * x + z * z)))
      return between(point, { x: from.x + x * share, z: from.z + z * share })
    }

    for (const point of points) expect(Math.min(off(point, start, bend), off(point, bend, end))).toBeCloseTo(0)
    // Every step is as long along the pipe; the one that takes the bend cuts its corner.
    const pace = (between(start, bend) + between(bend, end)) / STEPS
    const steps = points.slice(1).map((point, step) => between(point, points[step] ?? point))
    expect(steps.filter((step) => Math.abs(step - pace) > 1e-9).length).toBeLessThanOrEqual(1)
  })
})

describe('the Enclosure', () => {
  const { fence } = SITE
  // The middle of the gate: the site's entrance.
  const entrance = { x: fence.radius * Math.sin(fence.gate.bearing), z: fence.radius * Math.cos(fence.gate.bearing) }
  const { Enclosure: foot = [], ...plant } = outlines()

  it('stands at the entrance, nearer the gate than anything of the plant', () => {
    const fromGate = (outline: GroundPoint[]) => Math.min(...outline.map((point) => between(point, entrance)))

    for (const [part, outline] of Object.entries(plant)) {
      expect(fromGate(outline), part).toBeGreaterThan(fromGate(foot))
    }
  })

  it('has ground enough for its foot, and carries its lens in front of its mast', () => {
    expect(SITE.enclosure.radius).toBeGreaterThanOrEqual(ENCLOSURE_SHAPE.foot * ENCLOSURE_SHAPE.scale)
    expect(inFront(SITE.enclosure)).toBeLessThan(0)
    expect(between(lens, SITE.enclosure)).toBeCloseTo(
      Math.hypot(ENCLOSURE_SHAPE.lens.x, ENCLOSURE_SHAPE.lens.z) * ENCLOSURE_SHAPE.scale,
    )
  })

  it('carries its lens high over the fence, at the height it is drawn at on the mast', () => {
    expect(lensHeight()).toBeCloseTo(ENCLOSURE_SHAPE.lens.y * ENCLOSURE_SHAPE.scale)
    expect(lensHeight()).toBeGreaterThan(SITE.fence.height)
  })

  it('faces the camera sector: its lens looks out through the gate and covers it all', () => {
    expect(between(watchedPoint(0.5), entrance)).toBeCloseTo(0)
    expect(fence.gate.width).toBeLessThan(between(watchedPoint(0), watchedPoint(1)))
  })

  it('has nothing of the plant in its field of view', () => {
    for (const [part, outline] of Object.entries(plant)) {
      expect(Math.max(...outline.map(inFront)), part).toBeLessThan(0)
    }
  })
})

describe('the camera sector', () => {
  it('lands on the fence, from one edge of the image to the other', () => {
    for (const xNorm of ACROSS) {
      expect(fromCentre(watchedPoint(xNorm))).toBeCloseTo(SITE.fence.radius)
    }
  })

  it('places x_norm 0 on the left of the lens, 1 on its right, the middle straight ahead', () => {
    const sides = ACROSS.map((xNorm) => toTheLeft(watchedPoint(xNorm)))

    expect(sides).toEqual([...sides].sort((a, b) => b - a))
    expect(sides.at(0)).toBeGreaterThan(0)
    expect(sides.at(-1)).toBeLessThan(0)
    expect(toTheLeft(watchedPoint(0.5))).toBeCloseTo(0)
    expect(inFront(watchedPoint(0.5))).toBeGreaterThan(0)
  })

  it("opens by the camera's field of view", () => {
    const [left, right] = [watchedPoint(0), watchedPoint(1)].map((point) => Math.atan2(toTheLeft(point), inFront(point)))

    expect((left ?? 0) - (right ?? 0)).toBeCloseTo(SITE.camera.fov)
    expect(left).toBeCloseTo(-(right ?? 0))
  })
})

describe('the bearing to face', () => {
  it('is 0 toward the entrance and grows toward x, like every bearing of the plan', () => {
    const here = { x: 0.4, z: -0.3 }

    expect(bearingTo(here, { x: 0.4, z: 2 })).toBeCloseTo(0)
    expect(bearingTo(here, { x: 2, z: -0.3 })).toBeCloseTo(Math.PI / 2)
    expect(bearingTo(here, { x: -2, z: -0.3 })).toBeCloseTo(-Math.PI / 2)
  })

  it('turns what stands on the watched arc to the lens, wherever it stands on it', () => {
    for (const xNorm of ACROSS) {
      const at = watchedPoint(xNorm)
      const bearing = bearingTo(at, lens)
      const away = between(at, lens)

      expect(at.x + away * Math.sin(bearing)).toBeCloseTo(lens.x)
      expect(at.z + away * Math.cos(bearing)).toBeCloseTo(lens.z)
    }
  })
})
