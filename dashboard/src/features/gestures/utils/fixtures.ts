import type { Hand, Vec3 } from '../api/hand-frame'

// Hands for the tests, as the sensor would see them: a right hand over the sensor, shaped by a few words.
export interface Shape {
  id?: number
  palm?: Vec3
  normal?: Vec3
  velocity?: Vec3
  // Which fingers are out, thumb first. All of them by default.
  out?: [boolean, boolean, boolean, boolean, boolean]
  // Where the thumb points, from its knuckle. Away from the palm, level, by default.
  thumb?: Vec3
  grab?: number
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, by: number): Vec3 => [a[0] * by, a[1] * by, a[2] * by]

export function hand({
  id = 1,
  palm = [0, 200, 0],
  normal = [0, -1, 0],
  velocity = [0, 0, 0],
  out = [true, true, true, true, true],
  thumb = [-1, 0, 0],
  grab = out.slice(1).some(Boolean) ? 0 : 1,
}: Shape = {}): Hand {
  const finger = (index: number) => {
    const knuckle = add(palm, [index === 0 ? -35 : -30 + index * 15, 0, index === 0 ? 10 : -45])
    const toward: Vec3 = index === 0 ? thumb : [0, 0, -1]
    // A finger that is out reaches straight from its knuckle; one that is not stays by it.
    const reach = out[index] ? 1 : 0.15
    const joint = (share: number) => add(knuckle, scale(toward, 80 * share * reach))
    return { extended: out[index] ?? false, joints: [add(palm, [0, 0, 55]), knuckle, joint(0.45), joint(0.75), joint(1)] } as Hand['fingers'][number]
  }
  return { id, side: 'right', palm, normal, velocity, grab, pinch: 0, fingers: [finger(0), finger(1), finger(2), finger(3), finger(4)] }
}

export const FIST: Shape = { out: [false, false, false, false, false] }
export const THUMB_UP: Shape = { out: [true, false, false, false, false], thumb: [0, 1, 0], normal: [0, 0, 1] }
export const THUMB_DOWN: Shape = { out: [true, false, false, false, false], thumb: [0, -1, 0], normal: [0, 0, -1] }
export const ON_EDGE: Shape = { normal: [-1, 0, 0] }
