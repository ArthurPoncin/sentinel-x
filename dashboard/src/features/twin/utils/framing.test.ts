import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { FIELD_OF_VIEW, TARGET, wholeStageDistance } from './framing'

const VERTICAL = 9 / 16
const WIDE = 16 / 9

// What stands on the stage, as the components draw it: the perimeter ring on the ground, and the Enclosure
// on its mast, from the corners of its body (lens included) up to the buzzer on top.
const ring = Array.from({ length: 72 }, (_, i) => {
  const angle = (i / 72) * 2 * Math.PI
  return new Vector3(3.2 * Math.cos(angle), 0, 3.2 * Math.sin(angle))
})
const corners = (x: number, y: number, z: number) => [
  new Vector3(x, y, z),
  new Vector3(-x, y, z),
  new Vector3(x, y, -z),
  new Vector3(-x, y, -z),
]
const outpost = [...ring, ...corners(0.88, 1.88, 0.69), ...corners(0.88, 3.14, 0.69), new Vector3(0, 3.3, 0)]

// How far from the centre of the frame the Outpost reaches, across (x) and up (y): 1 is the frame's edge.
// Seen from `distance`, the camera `polar` degrees from the vertical and `azimuth` degrees around the orbit.
function reach(aspect: number, distance: number, polar: number, azimuth: number) {
  const target = new Vector3(...TARGET)
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, aspect)
  camera.position.setFromSphericalCoords(distance, MathUtils.degToRad(polar), MathUtils.degToRad(azimuth)).add(target)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  const seen = outpost.map((point) => point.clone().project(camera))

  return {
    x: Math.max(...seen.map((point) => Math.abs(point.x))),
    y: Math.max(...seen.map((point) => Math.abs(point.y))),
  }
}

const AZIMUTHS = Array.from({ length: 72 }, (_, i) => i * 5)
// Where the camera stands when nobody has touched it, between its two bounds.
const UNTOUCHED = 73.7
const POLARS = [25, UNTOUCHED, 82]

describe('wholeStageDistance', () => {
  it('holds the whole Outpost in a vertical 9:16 frame all the way around the orbit', () => {
    const distance = wholeStageDistance(VERTICAL)

    for (const polar of POLARS) {
      for (const azimuth of AZIMUTHS) {
        const { x, y } = reach(VERTICAL, distance, polar, azimuth)
        expect(x).toBeLessThan(1)
        expect(y).toBeLessThan(1)
      }
    }
  })

  it('stands no further back than that takes: the ring keeps most of the width, its halo the rest', () => {
    const distance = wholeStageDistance(VERTICAL)

    for (const azimuth of AZIMUTHS) {
      const { x } = reach(VERTICAL, distance, UNTOUCHED, azimuth)
      expect(x).toBeGreaterThan(0.8)
      expect(x).toBeLessThan(0.9)
    }
  })

  it('holds the whole Outpost in a wide frame too', () => {
    const distance = wholeStageDistance(WIDE)

    for (const polar of POLARS) {
      for (const azimuth of AZIMUTHS) {
        const { x, y } = reach(WIDE, distance, polar, azimuth)
        expect(x).toBeLessThan(1)
        expect(y).toBeLessThan(1)
      }
    }
  })

  it('stands further back the narrower the frame', () => {
    expect(wholeStageDistance(VERTICAL)).toBeGreaterThan(wholeStageDistance(3 / 4))
    expect(wholeStageDistance(3 / 4)).toBeGreaterThan(wholeStageDistance(1))
  })

  it('is set by the height alone once the frame is wider than tall', () => {
    expect(wholeStageDistance(WIDE)).toBe(wholeStageDistance(1))
  })
})
