import { type GroundPoint, lensHeight, lensPoint, watchedPoint } from './site'

// A point of the site, `y` above its ground.
export interface SpacePoint extends GroundPoint {
  y: number
}

// A flat face of a volume, by its three corners.
export type Face = readonly [SpacePoint, SpacePoint, SpacePoint]

// What the camera sees of the site, as a volume: it leaves from the Enclosure's lens and opens down to the
// arc of the fence the camera watches, followed from the left edge of its image to the right. `under` is the
// point of the ground under the lens: the sector on the ground starts there.
export interface CameraField {
  lens: SpacePoint
  under: SpacePoint
  arc: SpacePoint[]
}

// The camera's field, its arc followed in `steps` steps.
export function cameraField(steps: number): CameraField {
  const lens = lensPoint()

  return {
    lens: { ...lens, y: lensHeight() },
    under: { ...lens, y: 0 },
    arc: Array.from({ length: steps + 1 }, (_, step) => ({ ...watchedPoint(step / steps), y: 0 })),
  }
}

// The field's base: the sector on the ground, fanned out from under the lens to the arc, a face a step.
export function fieldBase({ under, arc }: CameraField): Face[] {
  return arc.slice(1).map((to, step) => [under, arc[step] ?? to, to])
}

// The field's walls, which all leave from the lens: its front, sloping down to the arc, a face a step, and
// its two sides, upright on the sector's straight edges. With the base they close the volume. Each looks out
// of it: seen from outside, its corners go round counter-clockwise.
export function fieldWalls({ lens, under, arc }: CameraField): Face[] {
  const [left, right] = [arc.at(0), arc.at(-1)]
  // The arc goes from the lens's left to its right: clockwise, seen from above.
  const front = arc.slice(1).map((to, step): Face => [lens, to, arc[step] ?? to])
  const sides: Face[] = left && right ? [[lens, left, under], [lens, under, right]] : []

  return [...front, ...sides]
}
