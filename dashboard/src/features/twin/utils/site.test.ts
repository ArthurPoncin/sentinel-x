import { describe, expect, it } from 'vitest'
import { DUST } from './dust'
import { ENCLOSURE_SHAPE } from './enclosure-parts'
import {
  alongPipe,
  type Block,
  barbedHeight,
  bearingTo,
  dangerZone,
  fenceBarbs,
  fenceLength,
  fencePosts,
  floodlights,
  type GroundPoint,
  gateLine,
  gatePoint,
  fromPath,
  gateSigns,
  hallDoor,
  hallSign,
  lensHeight,
  lensPoint,
  meshCell,
  panelGround,
  rocks,
  SITE,
  STANDING,
  sightBearing,
  solarPanels,
  standingPoint,
  standingSpan,
  track,
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
  const { hall, chimneys, transformer, tank, pipe, enclosure, solar, turbine, batteries } = SITE

  return {
    hall: corners(hall),
    'first chimney': rim(chimneys[0]),
    'second chimney': rim(chimneys[1]),
    transformer: corners(transformer),
    tank: corners(tank),
    pipe: pipe.path.flatMap((point) => rim({ ...point, radius: pipe.radius })),
    'solar field': corners(solar),
    'wind turbine': rim(turbine),
    batteries: corners(batteries),
    Enclosure: rim(enclosure),
  }
}

const reach = (outline: GroundPoint[]) => Math.max(...outline.map(fromCentre))

// How far outside `block`'s walls `point` is: 0 on a wall, negative inside.
const outside = (point: GroundPoint, { x, z, width, depth }: Pick<Block, 'x' | 'z' | 'width' | 'depth'>) =>
  Math.max(Math.abs(point.x - x) - width / 2, Math.abs(point.z - z) - depth / 2)

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

  it('has the middle of its gate on its line, halfway between the two posts that stand on each side', () => {
    const posts = fencePosts()
    const [first, last] = [posts.at(0), posts.at(-1)]
    const gate = gatePoint()

    expect(fromCentre(gate)).toBeCloseTo(fence.radius)
    expect(first && between(gate, first)).toBeCloseTo((last && between(gate, last)) ?? 0)
    expect(first && between(gate, first)).toBeLessThan(fence.gate.width)
  })

  it('is as long as its bays put end to end, round the site', () => {
    const halfGate = fence.gate.width / fence.radius / 2

    expect(fenceLength()).toBeCloseTo(fence.radius * (TURN - 2 * halfGate))
    expect(fenceLength() + fence.gate.width).toBeCloseTo(fence.radius * TURN)
  })

  it('draws its mesh in whole diamonds from the ground to its top, several to a bay', () => {
    const [first, second] = fencePosts()

    expect(Number.isInteger(fence.mesh.rows)).toBe(true)
    expect(meshCell() * fence.mesh.rows).toBeCloseTo(fence.height)
    expect(first && second && between(first, second) / meshCell()).toBeGreaterThan(4)
  })

  it("carries its barbed wire over its mesh, on posts that stay under the top of the gate's pillars", () => {
    expect(barbedHeight()).toBeCloseTo(fence.height + fence.barbed.rise)
    expect(barbedHeight()).toBeGreaterThan(fence.height)
    expect(barbedHeight()).toBeLessThan(fence.gate.pillar.height)
  })

  it('spaces its barbs evenly along the strand, between the pillars and none on them', () => {
    const turns = fenceBarbs()
      .map(round)
      .sort((a, b) => a - b)
    const halfGate = fence.gate.width / fence.radius / 2
    const apart = (turns[1] ?? 0) - (turns[0] ?? 0)

    for (const barb of fenceBarbs()) expect(fromCentre(barb)).toBeCloseTo(fence.radius)
    expect(turns.at(0)).toBeCloseTo(halfGate + apart)
    expect(turns.at(-1)).toBeCloseTo(TURN - halfGate - apart)
    turns.slice(1).forEach((turn, i) => {
      expect(turn - (turns[i] ?? 0)).toBeCloseTo(apart)
    })
    // As near the plan's spacing as the strand's length allows.
    expect(Math.abs(apart * fence.radius - fence.barbed.every)).toBeLessThan(fence.barbed.every / 100)
  })
})

describe('the gate', () => {
  const { fence } = SITE
  const { pillar, leaf } = fence.gate

  it('stands on the straight line from the post on one side of it to the post on the other', () => {
    const posts = fencePosts()
    const { from, to } = gateLine()

    expect(between(from, posts.at(0) ?? to)).toBeCloseTo(0)
    expect(between(to, posts.at(-1) ?? from)).toBeCloseTo(0)
  })

  it("fits in the fence's opening: its two leaves between its two pillars, a slit between them at most", () => {
    const { from, to, opening } = gateLine()
    const slit = opening - 2 * leaf.width

    expect(opening).toBeCloseTo(between(from, to) - pillar.width)
    expect(opening).toBeLessThan(fence.gate.width)
    expect(slit).toBeGreaterThanOrEqual(0)
    expect(slit).toBeLessThan(pillar.width / 2)
  })

  it('closes the fence to its height, under the top of its pillars', () => {
    expect(leaf.height).toBeGreaterThanOrEqual(fence.height)
    expect(leaf.height).toBeLessThan(pillar.height)
  })
})

describe('the no-entry signs', () => {
  const { fence, signs } = SITE
  const halfGate = fence.gate.width / fence.radius / 2
  // How far round the site a point stands from the middle of the gate: negative on one side of it, positive
  // on the other.
  const fromGate = (point: GroundPoint) => {
    const turn = Math.atan2(point.x, point.z) - fence.gate.bearing
    return Math.atan2(Math.sin(turn), Math.cos(turn))
  }

  it('hang on the fence, one on each side of the gate, as far from it as each other', () => {
    const [before, after] = gateSigns()

    expect(gateSigns()).toHaveLength(2)
    for (const sign of gateSigns()) expect(fromCentre(sign)).toBeCloseTo(fence.radius)
    expect(before && fromGate(before)).toBeLessThan(-halfGate)
    expect(after && fromGate(after)).toBeGreaterThan(halfGate)
    expect(before && fromGate(before)).toBeCloseTo(-((after && fromGate(after)) ?? 0))
  })

  it('each hold in a bay of the fence, halfway between two posts, out of the way in', () => {
    const posts = fencePosts()
    const [before, after] = gateSigns()
    // The posts of the bay the plan gives each sign, counted from the gate's own post.
    const { bay } = signs.gate
    const bays = [
      [before, posts.at(-bay), posts.at(-bay - 1)],
      [after, posts.at(bay - 1), posts.at(bay)],
    ] as const

    for (const [sign, nearer, farther] of bays) {
      if (!sign || !nearer || !farther) throw new Error('a sign or a post is missing')
      expect(between(sign, nearer)).toBeCloseTo(between(sign, farther))
      expect(signs.gate.width).toBeLessThan(between(nearer, farther))
      expect(between(sign, gatePoint()) - signs.gate.width / 2).toBeGreaterThan(fence.gate.width / 2)
    }
  })

  it('stand in no one the camera sees, whichever way it is turned: they stand clear of the fence a sign hangs on', () => {
    // A sign hangs on the fence's line; whoever is seen stands inside it, by more than half a sign is wide.
    expect(STANDING.clear).toBeGreaterThan(signs.gate.width / 2)
    for (const pan of [-Math.PI / 2, -0.6, 0, 0.6, Math.PI / 2]) {
      for (const xNorm of ACROSS) {
        for (const sign of gateSigns()) {
          expect(between(standingPoint(xNorm, pan), sign), `pan ${pan}, x_norm ${xNorm}`).toBeGreaterThan(signs.gate.width / 2)
        }
      }
    }
  })

  it('face out of the site, and are no taller than the fence', () => {
    for (const sign of gateSigns()) {
      expect(sign.bearing).toBeCloseTo(Math.atan2(sign.x, sign.z))
    }
    expect(signs.gate.height).toBeLessThan(fence.height)
  })
})

describe('the danger zone', () => {
  const { tank, signs, fence } = SITE
  const zone = dangerZone()

  it('goes all round the gas tank, clear ground between the tank and its band', () => {
    const { margin, band } = signs.dangerZone

    expect(margin).toBeGreaterThan(0)
    expect(band).toBeGreaterThan(0)
    expect(zone).toMatchObject({ x: tank.x, z: tank.z })
    // Every wall of the tank is the clear ground and the band away from the zone's edge.
    for (const corner of corners(tank)) expect(outside(corner, zone)).toBeCloseTo(-(margin + band))
  })

  it('is marked inside the fence, with room left to walk along it', () => {
    const WALKWAY = 0.3

    expect(reach(corners({ ...zone, height: 0 }))).toBeLessThan(fence.radius - WALKWAY)
  })

  it('takes no ground from anything but the tank, and the pipe that comes to it', () => {
    const { tank: _, pipe: __, ...others } = outlines()

    for (const [part, outline] of Object.entries(others)) {
      expect(Math.min(...outline.map((point) => outside(point, zone))), part).toBeGreaterThan(0)
    }
    // The pipe leaves the zone: only its end at the tank is inside.
    expect(outside(SITE.pipe.path[0], zone)).toBeGreaterThan(0)
  })

  it('is marked out of the camera sector', () => {
    // Round the lens from straight ahead, toward its left: the sector is half the field of view either way.
    const offAxis = (point: GroundPoint) => Math.atan2(toTheLeft(point), inFront(point))

    for (const corner of corners({ ...zone, height: 0 })) {
      expect(Math.abs(offAxis(corner))).toBeGreaterThan(SITE.camera.fov / 2)
    }
  })
})

describe('the gas pictogram', () => {
  const { tank, signs } = SITE

  it("holds on the tank's barrel, between its domed ends", () => {
    // The tank is a barrel as wide as it is deep, closed by a dome at each end.
    expect(signs.tank.width).toBeLessThan(tank.width - tank.depth)
    // Less than a quarter of the way round it: read from one side.
    expect(signs.tank.height).toBeLessThan((Math.PI / 2) * (tank.depth / 2))
  })

  it('is on a side of the tank, which lies along x', () => {
    expect(Math.abs(Math.cos(signs.tank.bearing))).toBeCloseTo(1)
  })
})

describe("the site's name", () => {
  const { hall, signs } = SITE
  const sign = hallSign()
  const out = { x: Math.sin(sign.bearing), z: Math.cos(sign.bearing) }

  it('is on a wall of the hall, facing out of it', () => {
    const STEP = 0.1

    expect(outside(sign, hall)).toBeCloseTo(0)
    expect(outside({ x: sign.x + STEP * out.x, z: sign.z + STEP * out.z }, hall)).toBeCloseTo(STEP)
  })

  it('holds on that wall, off the ground and under the roof', () => {
    // How long the wall it is on is: the hall's depth for a side wall, its width for the front or the back.
    const wall = Math.abs(out.x) * hall.depth + Math.abs(out.z) * hall.width

    expect(Math.abs(signs.hall.along) + signs.hall.width / 2).toBeLessThan(wall / 2)
    expect(signs.hall.foot).toBeGreaterThan(0)
    expect(signs.hall.foot + signs.hall.height).toBeLessThan(hall.height)
  })
})

describe("the hall's door", () => {
  const { hall, signs } = SITE
  const door = hallDoor()

  it("is on the hall's front wall, and holds on it under the roof", () => {
    expect(door.z).toBeCloseTo(hall.z + hall.depth / 2)
    expect(outside(door, hall)).toBeCloseTo(0)
    expect(Math.abs(hall.door.along) + hall.door.width / 2).toBeLessThan(hall.width / 2)
    expect(hall.door.height).toBeLessThan(hall.height)
  })

  it("is clear of the site's name and of the pipe, which come to the same wall", () => {
    const pipe = SITE.pipe.path[0]

    expect(Math.abs(door.x - hallSign().x)).toBeGreaterThan((hall.door.width + signs.hall.width) / 2)
    expect(Math.abs(door.x - pipe.x)).toBeGreaterThan(hall.door.width / 2 + SITE.pipe.radius)
  })
})

describe('the track', () => {
  const { socle, fence, hall } = SITE
  const { toHall, toEdge } = track()
  const half = SITE.track.width / 2
  // How far round the site a point stands from the middle of the gate.
  const fromGate = (point: GroundPoint) => {
    const turn = Math.atan2(point.x, point.z) - fence.gate.bearing
    return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
  }

  it("links the gate to the hall's door", () => {
    expect(toHall.at(0)).toEqual(gatePoint())
    expect(toHall.at(-1)).toEqual(hallDoor())
  })

  it('links the gate to the rim of the socle, straight out, and stops there', () => {
    const [from, to] = [toEdge.at(0), toEdge.at(-1)]
    if (!from || !to) throw new Error('the track has no way out')

    expect(from).toEqual(gatePoint())
    expect(fromCentre(to)).toBeCloseTo(socle.radius)
    expect(Math.atan2(to.x, to.z)).toBeCloseTo(fence.gate.bearing)
    for (const point of toEdge) expect(fromCentre(point)).toBeLessThanOrEqual(socle.radius + 1e-9)
  })

  it('is one unbroken line each way, in steps shorter than it is wide', () => {
    for (const path of [toHall, toEdge]) {
      path.slice(1).forEach((point, index) => {
        const step = between(point, path[index] ?? point)

        expect(step).toBeGreaterThan(0)
        expect(step).toBeLessThan(2 * SITE.track.width)
      })
    }
  })

  it('goes through the gate, between its two pillars, and through the fence nowhere else', () => {
    const { from, to, opening } = gateLine()

    expect(SITE.track.width).toBeLessThan(opening)
    expect(between(from, gatePoint())).toBeCloseTo(between(to, gatePoint()))
    for (const point of toHall.slice(1)) {
      expect(fromCentre(point)).toBeLessThan(fence.radius)
      // Once through the gate it is inside whole, both its sides.
      if (between(point, gatePoint()) > SITE.track.width) expect(fromCentre(point) + half).toBeLessThan(fence.radius)
    }
    // It leaves the gate square to the fence, on both sides of it.
    for (const next of [toHall.at(1), toEdge.at(1)]) expect(next && fromGate(next)).toBeCloseTo(0)
  })

  it('goes round the gas tank and the pipe: clear of the danger zone, of the pipe and of everything that stands', () => {
    const zone = dangerZone()
    // Along the track, close enough together to miss nothing between two of them.
    const along = toHall.slice(1).flatMap((to, index) => {
      const from = toHall[index] ?? to
      return Array.from({ length: 8 }, (_, step) => ({
        x: from.x + ((to.x - from.x) * step) / 8,
        z: from.z + ((to.z - from.z) * step) / 8,
      }))
    })
    const { hall: _, pipe, ...parts } = outlines()

    for (const point of along) {
      expect(outside(point, zone)).toBeGreaterThan(half)
      // The hall is where it ends: it comes to the door and no further.
      expect(outside(point, hall)).toBeGreaterThanOrEqual(-1e-9)
    }
    expect(fromPath(SITE.pipe.path[0], toHall)).toBeGreaterThan(half + SITE.pipe.radius)
    for (const point of pipe ?? []) expect(fromPath(point, toHall)).toBeGreaterThan(half)
    for (const [part, outline] of Object.entries(parts)) {
      for (const point of outline) expect(fromPath(point, toHall), part).toBeGreaterThan(half)
    }
  })

  it('passes clear of the floodlights, the foot of each mast off it', () => {
    for (const mast of floodlights()) {
      expect(fromPath(mast, toHall)).toBeGreaterThan(half + SITE.floodlights.foot)
    }
  })

  it('comes to the door square to the wall, on the side of the pipe the door is on', () => {
    const [before, door] = [toHall.at(-2), toHall.at(-1)]
    const pipe = SITE.pipe.path[0]
    if (!before || !door) throw new Error('the track has no way in')

    expect(before.x).toBeCloseTo(door.x)
    expect(before.z).toBeGreaterThan(door.z)
    for (const point of toHall.slice(-8)) expect(Math.sign(point.x - pipe.x)).toBe(Math.sign(door.x - pipe.x))
  })
})

describe('fromPath', () => {
  const path = [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 2, z: 1 },
  ]

  it('is how far a point is from the nearest point of a path, its ends included', () => {
    expect(fromPath({ x: 1, z: 0 }, path)).toBeCloseTo(0)
    expect(fromPath({ x: 1, z: -0.5 }, path)).toBeCloseTo(0.5)
    expect(fromPath({ x: -3, z: 4 }, path)).toBeCloseTo(5)
    expect(fromPath({ x: 2.5, z: 0.5 }, path)).toBeCloseTo(0.5)
    expect(fromPath({ x: 2, z: 3 }, path)).toBeCloseTo(2)
  })
})

describe('the rocks', () => {
  const { socle, fence } = SITE
  const plan = SITE.rocks
  const laid = rocks()
  const paths = Object.values(track())

  it('are as many as the plan asks for, each of a size the plan allows', () => {
    expect(laid).toHaveLength(plan.count)
    for (const rock of laid) {
      expect(rock.radius).toBeGreaterThanOrEqual(plan.radius[0])
      expect(rock.radius).toBeLessThanOrEqual(plan.radius[1])
      expect(rock.height).toBeGreaterThanOrEqual(rock.radius * plan.squat[0] - 1e-9)
      expect(rock.height).toBeLessThanOrEqual(rock.radius * plan.squat[1] + 1e-9)
    }
  })

  it('lie outside the fence, whole, clear of its posts', () => {
    for (const rock of laid) expect(fromCentre(rock) - rock.radius).toBeGreaterThanOrEqual(fence.radius + plan.off - 1e-9)
  })

  it("lie on the socle, whole, inside the Status's ring", () => {
    for (const rock of laid) {
      expect(fromCentre(rock) + rock.radius).toBeLessThanOrEqual(socle.radius - socle.ring + 1e-9)
    }
  })

  it('leave the gate clear, from one no-entry sign to the other: none in front of it, none in front of a sign', () => {
    const { from, to } = gateLine()
    const reach = (point: GroundPoint, rock: GroundPoint) => {
      const turn = Math.atan2(rock.x, rock.z) - Math.atan2(point.x, point.z)
      return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) * fence.radius
    }

    for (const rock of laid) {
      // Round the fence, from the gate's pillars and from the middle of each sign.
      for (const pillar of [from, to]) expect(reach(pillar, rock)).toBeGreaterThan(rock.radius)
      for (const sign of gateSigns()) expect(reach(sign, rock)).toBeGreaterThan(SITE.signs.gate.width / 2 + rock.radius)
      expect(reach(gatePoint(), rock)).toBeGreaterThan(fence.gate.width / 2 + rock.radius)
    }
  })

  it('leave the track clear', () => {
    for (const rock of laid) {
      for (const path of paths) expect(fromPath(rock, path)).toBeGreaterThan(SITE.track.width / 2 + rock.radius)
    }
  })

  it('are the same at every call', () => {
    expect(rocks()).toEqual(laid)
  })

  it('lie all round the site, no two on the same ground', () => {
    // A rock at least in each sixth of the turn the gate leaves them.
    const sixths = new Set(laid.map((rock) => Math.floor(((Math.atan2(rock.x, rock.z) + Math.PI) / (2 * Math.PI)) * 6)))
    expect(sixths.size).toBe(6)

    for (const [index, rock] of laid.entries()) {
      for (const other of laid.slice(index + 1)) {
        // They may lean on each other, in a heap: neither covers the other's middle.
        expect(between(rock, other)).toBeGreaterThan(Math.max(rock.radius, other.radius))
      }
    }
  })
})

describe('the solar field, the wind turbine and the batteries', () => {
  const { solar, turbine, batteries, transformer, fence, socle } = SITE
  const { toHall } = track()
  const masts = floodlights()
  const blocks = { 'solar field': solar, batteries }
  // The rim of the ground the turbine's mast keeps.
  const mastRim = outlines()['wind turbine'] ?? []
  // Round the lens from straight ahead: the sector is half the field of view either way.
  const offAxis = (point: GroundPoint) => Math.abs(Math.atan2(toTheLeft(point), inFront(point)))

  it('stand inside the fence, with room to walk along it', () => {
    const WALKWAY = 0.3

    for (const [name, block] of Object.entries(blocks)) expect(reach(corners(block)), name).toBeLessThan(fence.radius - WALKWAY)
    expect(reach(mastRim)).toBeLessThan(fence.radius - WALKWAY)
  })

  it('stand out of the camera sector', () => {
    for (const [name, block] of Object.entries(blocks)) {
      for (const corner of corners(block)) expect(offAxis(corner), name).toBeGreaterThan(SITE.camera.fov / 2)
    }
    for (const point of mastRim) expect(offAxis(point)).toBeGreaterThan(SITE.camera.fov / 2)
  })

  it("take no ground from a floodlight's mast", () => {
    for (const mast of masts) {
      for (const [name, block] of Object.entries(blocks)) expect(outside(mast, block), name).toBeGreaterThan(SITE.floodlights.foot)
      expect(between(mast, turbine)).toBeGreaterThan(turbine.radius + SITE.floodlights.foot)
    }
  })

  it('leave the track clear, both its sides', () => {
    const half = SITE.track.width / 2
    // Along the track, close enough together to miss nothing between two of them.
    const along = toHall.slice(1).flatMap((to, index) => {
      const from = toHall[index] ?? to
      return Array.from({ length: 8 }, (_, step) => ({
        x: from.x + ((to.x - from.x) * step) / 8,
        z: from.z + ((to.z - from.z) * step) / 8,
      }))
    })

    for (const point of along) {
      for (const [name, block] of Object.entries(blocks)) expect(outside(point, block), name).toBeGreaterThan(half)
    }
    expect(fromPath(turbine, toHall)).toBeGreaterThan(half + turbine.radius)
  })

  it('lays the panels in rows over the field, each on ground of its own', () => {
    const panels = solarPanels()
    const ground = panelGround()

    expect(panels).toHaveLength(solar.rows * solar.columns)
    for (const [index, panel] of panels.entries()) {
      // Whole inside the field.
      for (const corner of corners({ ...panel, ...ground, height: 0 })) expect(outside(corner, solar)).toBeLessThanOrEqual(1e-9)
      for (const other of panels.slice(index + 1)) {
        const apart = Math.abs(panel.x - other.x) >= ground.width || Math.abs(panel.z - other.z) >= ground.depth
        expect(apart, `panels ${index} and ${panels.indexOf(other)}`).toBe(true)
      }
    }
    expect(new Set(panels.map(({ z }) => z.toFixed(6))).size).toBe(solar.rows)
    expect(new Set(panels.map(({ x }) => x.toFixed(6))).size).toBe(solar.columns)
  })

  it('leans the panels, their low edge off the ground, and shades none with the row in front', () => {
    const { length, tilt } = solar.panel
    const rise = length * Math.sin(tilt)

    expect(tilt).toBeGreaterThan(0)
    expect(tilt).toBeLessThan(Math.PI / 2)
    expect(panelGround().depth).toBeCloseTo(length * Math.cos(tilt))
    expect(solar.height - rise).toBeGreaterThan(0)
    // From the top of a row to the foot of the next, further than the row is high.
    expect(solar.depth / solar.rows - panelGround().depth).toBeGreaterThan(0)
    expect(solar.depth / solar.rows).toBeGreaterThan(rise)
  })

  it('turns the turbine into the wind that carries the dust', () => {
    const upwind = DUST.wind + Math.PI

    expect(Math.sin(turbine.bearing)).toBeCloseTo(Math.sin(upwind))
    expect(Math.cos(turbine.bearing)).toBeCloseTo(Math.cos(upwind))
  })

  it("sweeps its blades over the site: above the fence, the floodlights and the hall, off the chimneys, over the socle", () => {
    const { rotor, height } = turbine
    const lowest = height - rotor.radius

    expect(rotor.blades).toBeGreaterThanOrEqual(2)
    expect(rotor.period).toBeGreaterThan(3)
    expect(lowest).toBeGreaterThan(barbedHeight())
    expect(lowest).toBeGreaterThan(SITE.floodlights.height)
    expect(lowest).toBeGreaterThan(SITE.hall.height)
    for (const chimney of SITE.chimneys) expect(between(turbine, chimney)).toBeGreaterThan(rotor.radius + chimney.radius)
    expect(fromCentre(turbine) + rotor.radius).toBeLessThan(socle.radius - socle.ring)
  })

  it('stands the batteries by the transformer station: nearer it than anything else, less than their own length away', () => {
    const away = (outline: GroundPoint[]) => Math.min(...outline.map((point) => fromBlock(point, { ...batteries })))
    const { batteries: _, transformer: station = [], ...others } = outlines()

    expect(away(station)).toBeGreaterThan(0)
    expect(away(station)).toBeLessThan(Math.max(batteries.width, batteries.depth))
    expect(outside({ x: batteries.x, z: batteries.z }, transformer)).toBeGreaterThan(0)
    for (const [part, outline] of Object.entries(others)) expect(away(outline), part).toBeGreaterThan(away(station))
  })
})

describe('the floodlights', () => {
  const { fence, socle, enclosure, pipe } = SITE
  const { foot, height, pool, bearings } = SITE.floodlights
  const masts = floodlights()
  // The rim of the ground a mast keeps around its axis.
  const footprint = (mast: GroundPoint): GroundPoint[] =>
    Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8).map((bearing) => ({
      x: mast.x + foot * Math.sin(bearing),
      z: mast.z + foot * Math.cos(bearing),
    }))
  // How far `point` is from the stretch that runs from `from` to `to`.
  const off = (point: GroundPoint, from: GroundPoint, to: GroundPoint) => {
    const [x, z] = [to.x - from.x, to.z - from.z]
    const share = Math.min(1, Math.max(0, ((point.x - from.x) * x + (point.z - from.z) * z) / (x * x + z * z)))
    return between(point, { x: from.x + x * share, z: from.z + z * share })
  }

  it('stand on the perimeter, inside the fence, one on each bearing the plan gives', () => {
    expect(masts).toHaveLength(bearings.length)
    masts.forEach((mast, index) => {
      expect(Math.atan2(mast.x, mast.z)).toBeCloseTo(Math.atan2(Math.sin(bearings[index] ?? 0), Math.cos(bearings[index] ?? 0)))
      expect(fromCentre(mast) + foot).toBeLessThan(fence.radius)
      // Nearer the fence than anything of the plant: on the walkway kept along it.
      expect(fromCentre(mast) + foot).toBeGreaterThan(fence.radius - 0.3)
    })
  })

  it('rise over the fence and its gate, and look into the site', () => {
    expect(height).toBeGreaterThan(fence.gate.pillar.height)
    for (const mast of masts) {
      expect(mast.x + fromCentre(mast) * Math.sin(mast.bearing)).toBeCloseTo(0)
      expect(mast.z + fromCentre(mast) * Math.cos(mast.bearing)).toBeCloseTo(0)
    }
  })

  it('each have ground of their own: none on a part of the site, the danger zone or another mast', () => {
    const { hall, chimneys, transformer, tank, solar, turbine, batteries } = SITE
    const blocks = { hall, transformer, tank, 'danger zone': dangerZone(), 'solar field': solar, batteries }

    masts.forEach((mast, index) => {
      for (const [name, block] of Object.entries(blocks)) {
        expect(outside(mast, block), `mast ${index} and the ${name}`).toBeGreaterThan(foot)
      }
      for (const column of [...chimneys, turbine]) expect(between(mast, column)).toBeGreaterThan(column.radius + foot)
      pipe.path.slice(1).forEach((to, stretch) => {
        expect(off(mast, pipe.path[stretch] ?? to, to)).toBeGreaterThan(pipe.radius + foot)
      })
      for (const other of masts.slice(index + 1)) expect(between(mast, other)).toBeGreaterThan(2 * foot)
    })
  })

  it("leave the Enclosure's foot free", () => {
    for (const mast of masts) expect(between(mast, enclosure)).toBeGreaterThan(enclosure.radius + foot)
  })

  it('leave the camera sector free, the arc where the intruder stands included', () => {
    // Round the lens from straight ahead: the sector is half the field of view either way.
    const offAxis = (point: GroundPoint) => Math.atan2(toTheLeft(point), inFront(point))

    for (const mast of masts) {
      for (const point of footprint(mast)) expect(Math.abs(offAxis(point))).toBeGreaterThan(SITE.camera.fov / 2)
      for (const xNorm of ACROSS) expect(between(mast, watchedPoint(xNorm))).toBeGreaterThan(foot)
    }
  })

  it('hide neither no-entry sign', () => {
    for (const mast of masts) {
      for (const sign of gateSigns()) expect(between(mast, sign)).toBeGreaterThan(SITE.signs.gate.width)
    }
  })

  it('light a pool on the ground at their foot, toward the site, which stays on the socle', () => {
    for (const mast of masts) {
      expect(between(mast, mast.pool)).toBeCloseTo(pool.throw)
      expect(fromCentre(mast.pool)).toBeCloseTo(fromCentre(mast) - pool.throw)
      // The foot of the mast is in its own light.
      expect(between(mast, mast.pool)).toBeLessThan(pool.radius)
      expect(fromCentre(mast.pool) + pool.radius).toBeLessThanOrEqual(socle.radius)
    }
  })
})

describe('the gas pipe', () => {
  const { pipe, hall, tank } = SITE
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

  it('faces the camera sector: at rest its lens looks out through the gate and covers it all', () => {
    expect(between(watchedPoint(0.5), entrance)).toBeCloseTo(0)
    expect(fence.gate.width).toBeLessThan(between(watchedPoint(0), watchedPoint(1)))
  })

  it('has nothing of the plant in its field of view while its camera rests', () => {
    // How far round from the way the lens looks `point` is.
    const offAxis = (point: GroundPoint) => Math.abs(Math.atan2(toTheLeft(point), inFront(point)))

    for (const [part, outline] of Object.entries(plant)) {
      expect(Math.min(...outline.map(offAxis)), part).toBeGreaterThan(SITE.camera.fov / 2)
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

// How far the camera turns either way of where it rests: a servo's half turn. And how far across its image.
const QUARTER = Math.PI / 2
const PANS = [-QUARTER, -1, -0.4, 0, 0.4, 1, QUARTER]
// How tall someone is in the image, from as short as at the fence to filling it.
const TALL = [STANDING.tall.far, 0.4, 0.5, 0.7, STANDING.tall.near]

// How far `point` is from a rectangle of the plan; 0 inside it.
const fromBlock = (point: GroundPoint, { x, z, width, depth }: Block) =>
  Math.hypot(Math.max(0, Math.abs(point.x - x) - width / 2), Math.max(0, Math.abs(point.z - z) - depth / 2))

describe('the camera on its servo', () => {
  it('turns about its lens: the lens stays where it is, and its sight leaves from there', () => {
    for (const pan of PANS) {
      for (const xNorm of ACROSS) {
        expect(bearingTo(lens, watchedPoint(xNorm, pan))).toBeCloseTo(sightBearing(xNorm, pan))
        expect(fromCentre(watchedPoint(xNorm, pan))).toBeCloseTo(SITE.fence.radius)
      }
    }
  })

  it("turns toward the right of its image for a positive pan, by that very angle", () => {
    expect(sightBearing(0.5)).toBeCloseTo(SITE.enclosure.heading)
    for (const pan of [0.3, 1, QUARTER]) {
      expect(sightBearing(0.5, pan)).toBeCloseTo(SITE.enclosure.heading - pan)
      expect(toTheLeft(watchedPoint(0.5, pan))).toBeLessThan(0)
      expect(toTheLeft(watchedPoint(0.5, -pan))).toBeGreaterThan(0)
    }
  })

  it('keeps its field of view as it turns: what was at an edge of its image is in the middle once turned by half of it', () => {
    const half = SITE.camera.fov / 2

    expect(sightBearing(1) - sightBearing(0)).toBeCloseTo(-SITE.camera.fov)
    expect(sightBearing(0.5, half)).toBeCloseTo(sightBearing(1))
    expect(sightBearing(0.5, -half)).toBeCloseTo(sightBearing(0))
    expect(sightBearing(1, 0.7) - sightBearing(0, 0.7)).toBeCloseTo(-SITE.camera.fov)
  })
})

describe('where someone the camera sees stands', () => {
  const places = PANS.flatMap((pan) => ACROSS.flatMap((xNorm) => [undefined, ...TALL].map((hNorm) => ({ pan, xNorm, hNorm }))))

  it('is on the sight line the camera sees them along', () => {
    for (const { pan, xNorm, hNorm } of places) {
      expect(bearingTo(lens, standingPoint(xNorm, pan, hNorm))).toBeCloseTo(sightBearing(xNorm, pan))
    }
  })

  it('is inside the fence and clear of its line all round the site, never on it', () => {
    for (const { pan, xNorm, hNorm } of places) {
      expect(fromCentre(standingPoint(xNorm, pan, hNorm))).toBeLessThanOrEqual(SITE.fence.radius - STANDING.clear + 1e-9)
    }
  })

  it("is clear of the Enclosure's own ground, which the lens hangs out of", () => {
    expect(between(lens, SITE.enclosure)).toBeGreaterThan(SITE.enclosure.radius)
    for (const { pan, xNorm, hNorm } of places) {
      expect(between(standingPoint(xNorm, pan, hNorm), SITE.enclosure)).toBeGreaterThan(SITE.enclosure.radius + STANDING.clear / 2)
    }
  })

  it('is never in what stands on the site, however far the camera turns', () => {
    const { hall, transformer, tank, chimneys, pipe, solar, turbine, batteries } = SITE
    for (const { pan, xNorm, hNorm } of places) {
      const at = standingPoint(xNorm, pan, hNorm)
      const where = `pan ${pan}, x_norm ${xNorm}, h_norm ${hNorm}`

      for (const block of [hall, transformer, tank, solar, batteries]) {
        expect(fromBlock(at, block), where).toBeGreaterThan(STANDING.clear / 2)
      }
      for (const column of [...chimneys, turbine]) {
        expect(between(at, column), where).toBeGreaterThan(column.radius + STANDING.clear / 2)
      }
      for (const mast of floodlights()) {
        expect(between(at, mast), where).toBeGreaterThan(SITE.floodlights.foot + STANDING.clear / 2)
      }
      for (const share of [0, 0.25, 0.5, 0.75, 1]) expect(between(at, alongPipe(share)), where).toBeGreaterThan(pipe.radius)
    }
  })

  it('is just inside the fence when the Alert does not say how tall they are', () => {
    for (const xNorm of ACROSS) {
      const at = standingPoint(xNorm)

      expect(fromCentre(at)).toBeCloseTo(SITE.fence.radius - STANDING.clear)
      // A step from where the camera's sight meets the fence: a little more where it meets it at a slant.
      expect(between(at, watchedPoint(xNorm))).toBeGreaterThanOrEqual(STANDING.clear - 1e-9)
      expect(between(at, watchedPoint(xNorm))).toBeLessThan(1.5 * STANDING.clear)
      expect(at).toEqual(standingPoint(xNorm, 0, STANDING.tall.far))
    }
  })

  it('is nearer the Enclosure the taller they are in the image: they walk in as they come to the camera', () => {
    for (const pan of [-0.4, 0, 0.4]) {
      for (const xNorm of ACROSS) {
        const away = TALL.map((hNorm) => between(lens, standingPoint(xNorm, pan, hNorm)))

        expect(away).toEqual([...away].sort((a, b) => b - a))
        expect(away.at(0)).toBeGreaterThan((away.at(-1) ?? 0) + 0.9)
      }
    }
  })

  it('goes from one end of where one can stand to the other, and no further for someone taller or shorter still', () => {
    const { near, far } = standingSpan(sightBearing(0.5))

    expect(far).toBeGreaterThan(near)
    expect(between(lens, standingPoint(0.5, 0, STANDING.tall.far))).toBeCloseTo(far)
    expect(between(lens, standingPoint(0.5, 0, STANDING.tall.near))).toBeCloseTo(near)
    expect(standingPoint(0.5, 0, 0.05)).toEqual(standingPoint(0.5, 0, STANDING.tall.far))
    expect(standingPoint(0.5, 0, 1)).toEqual(standingPoint(0.5, 0, STANDING.tall.near))
  })

  it('is as far as a lens makes them short: halfway in height is not halfway in distance', () => {
    const { near, far } = standingSpan(sightBearing(0.5))
    const { tall } = STANDING
    // Twice as tall as at the far end.
    const away = between(lens, standingPoint(0.5, 0, 2 * tall.far))

    expect((away - near) / (far - near)).toBeCloseTo((1 / (2 * tall.far) - 1 / tall.near) / (1 / tall.far - 1 / tall.near))
    expect(away).toBeLessThan((near + far) / 2)
  })

  it('stops short of what stands on the site when the camera looks at it: the gas tank', () => {
    // Turned a quarter turn to its left, the camera looks along the site, past the gas pipe's end, at the tank.
    const bearing = sightBearing(0.5, -QUARTER)
    const { near, far } = standingSpan(bearing)
    const fence = between(lens, watchedPoint(0.5, -QUARTER))

    expect(far).toBeLessThan(fence - 1)
    expect(far).toBeGreaterThanOrEqual(near)
    expect(standingPoint(0.5, -QUARTER).x).toBeLessThan(SITE.tank.x - SITE.tank.width / 2)
  })
})
