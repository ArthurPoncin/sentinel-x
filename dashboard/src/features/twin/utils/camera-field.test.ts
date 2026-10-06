import { describe, expect, it } from 'vitest'
import { cameraField, fieldBase, fieldWalls, type SpacePoint } from './camera-field'
import { type GroundPoint, lensHeight, lensPoint, SITE, watchedPoint } from './site'

// Steps the watched arc is followed in.
const STEPS = 8

const fromCentre = (point: GroundPoint) => Math.hypot(point.x, point.z)
const between = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z)

describe("the camera's field", () => {
  it("leaves from the Enclosure's lens, where the site plan carries it", () => {
    const { lens } = cameraField(STEPS)

    expect(lens).toMatchObject({ ...lensPoint(), y: lensHeight() })
  })

  it('opens down to the arc of the fence the camera watches, from the left edge of its image to the right', () => {
    const { arc } = cameraField(STEPS)

    expect(arc).toHaveLength(STEPS + 1)
    arc.forEach((point, step) => {
      expect(point.y).toBe(0)
      expect(fromCentre(point)).toBeCloseTo(SITE.fence.radius)
      expect(between(point, watchedPoint(step / STEPS))).toBeCloseTo(0)
    })
  })

  it('has the sector on the ground for its base, fanned out from under the lens to the watched arc', () => {
    const field = cameraField(STEPS)
    const base = fieldBase(field)

    expect(field.under).toEqual({ ...lensPoint(), y: 0 })
    expect(base).toHaveLength(STEPS)
    base.forEach((face, step) => {
      expect(face).toEqual([field.under, field.arc[step], field.arc[step + 1]])
    })
  })

  it('stands on that sector: its walls all leave from the lens and close a volume with it, without a gap', () => {
    const field = cameraField(STEPS)
    const walls = fieldWalls(field)
    const named = ({ x, y, z }: SpacePoint) => [x, y, z].map((along) => along.toFixed(6)).join(' ')
    // How many faces meet at each edge, whichever way round a face goes.
    const meeting = new Map<string, number>()
    for (const [a, b, c] of [...fieldBase(field), ...walls]) {
      for (const edge of [[a, b], [b, c], [c, a]] as const) {
        const key = edge.map(named).sort().join(' | ')
        meeting.set(key, (meeting.get(key) ?? 0) + 1)
      }
    }

    for (const wall of walls) expect(wall).toContainEqual(field.lens)
    expect(meeting.size).toBeGreaterThan(0)
    for (const [edge, faces] of meeting) expect(faces, edge).toBe(2)
  })

  it('turns its walls outward: from outside the volume, the corners of each go round counter-clockwise', () => {
    const field = cameraField(STEPS)
    // A point inside the volume: it has no hollow, so the middle of some of its corners is in it.
    const corners = [field.lens, field.under, ...field.arc]
    const inside = (['x', 'y', 'z'] as const).map(
      (axis) => corners.reduce((sum, corner) => sum + corner[axis], 0) / corners.length,
    )
    const from = (a: SpacePoint, b: SpacePoint) => [b.x - a.x, b.y - a.y, b.z - a.z] as const

    fieldWalls(field).forEach(([a, b, c], wall) => {
      const [ux, uy, uz] = from(a, b)
      const [vx, vy, vz] = from(a, c)
      // The way the wall looks: the side its corners are seen from going round counter-clockwise.
      const looks = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const
      const outward = [a.x - (inside[0] ?? 0), a.y - (inside[1] ?? 0), a.z - (inside[2] ?? 0)] as const

      expect(looks[0] * outward[0] + looks[1] * outward[1] + looks[2] * outward[2], `wall ${wall}`).toBeGreaterThan(0)
    })
  })
})
