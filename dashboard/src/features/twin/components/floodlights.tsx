import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  RingGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useFade } from '../hooks/use-fade'
import { FLOODLIGHT_COLOR, type SceneProps } from '../utils/scene'
import { type Floodlight, floodlights, SITE } from '../utils/site'
import { GRAPHITE, STEEL } from './palette'

const MAST = { radius: 0.014, sides: 8 } as const
// A floodlight's head, on top of its mast: a housing `width` across, `depth` from its back to its front, and
// the lamp set in its underside. It leans `tilt` from looking straight down, toward the site, and is carried
// `reach` in from the mast's axis.
const HEAD = { width: 0.13, height: 0.04, depth: 0.08, tilt: 0.55, reach: 0.03, lamp: 0.006, rim: 0.012 } as const
// How bright a lit lamp emits, and how much light its pool adds to the ground at its heart and its beam to
// the air under the lamp. Both are light added over the frame: unlit, so the halo takes them for lights.
const LIT = { lamp: 7, pool: 0.3, beam: 0.06 } as const
// The pool is drawn in rings, from its heart to its edge where it has faded to nothing, and the beam is as
// many sides round.
const POOL = { rings: 8, sides: 40 } as const
// How far above the ground a pool is drawn: over the ground's markings, so none flickers into another.
const OVER_GROUND = 0.007

// Turns a shape drawn in a floodlight's own frame, z into the site, to where the site plan stands it.
const stood = (shape: BufferGeometry, { x, z, bearing }: Floodlight) => shape.rotateY(bearing).translate(x, 0, z)

function merged(shapes: BufferGeometry[]): BufferGeometry {
  const all = mergeGeometries(shapes)
  for (const shape of shapes) shape.dispose()
  return all
}

// A head's part, leaned and carried to the top of its mast.
function onHead(part: BufferGeometry): BufferGeometry {
  return part.rotateX(-HEAD.tilt).translate(0, SITE.floodlights.height, HEAD.reach)
}

// Every mast and the housing of its head, as one shape.
function mastShapes(lights: readonly Floodlight[]): BufferGeometry {
  const { height } = SITE.floodlights

  return merged(
    lights.flatMap((light) => [
      stood(new CylinderGeometry(MAST.radius, MAST.radius * 1.4, height, MAST.sides).translate(0, height / 2, 0), light),
      stood(onHead(new BoxGeometry(HEAD.width, HEAD.height, HEAD.depth)), light),
    ]),
  )
}

// Every lamp as one shape: a pane set in the underside of its housing.
function lampShapes(lights: readonly Floodlight[]): BufferGeometry {
  const pane = () =>
    new BoxGeometry(HEAD.width - 2 * HEAD.rim, HEAD.lamp, HEAD.depth - 2 * HEAD.rim).translate(0, -HEAD.height / 2, 0)

  return merged(lights.map((light) => stood(onHead(pane()), light)))
}

// Where a lamp is, in its floodlight's own frame: the middle of its pane.
function lampPoint(): readonly [x: number, y: number, z: number] {
  const under = HEAD.height / 2
  return [0, SITE.floodlights.height - under * Math.cos(HEAD.tilt), HEAD.reach + under * Math.sin(HEAD.tilt)]
}

// What the floodlights light, as one shape: for each a pool on the ground, brightest at its heart and gone at
// its edge, and the beam that comes down to it from the lamp, faint, which thins out toward the ground. Each
// point carries how bright it is as its color.
function lightShapes(lights: readonly Floodlight[]): BufferGeometry {
  const { radius } = SITE.floodlights.pool
  const [lampX, lampY, lampZ] = lampPoint()

  return merged(
    lights.flatMap((light) => {
      // A ring is drawn upright: laid flat, it looks up.
      const pool = new RingGeometry(0, radius, POOL.sides, POOL.rings).rotateX(-Math.PI / 2).toNonIndexed()
      const points = pool.getAttribute('position')
      const glow = Array.from({ length: points.count }, (_, point) => {
        const share = 1 - Math.hypot(points.getX(point), points.getZ(point)) / radius
        // Slow at both ends: neither a bright dot at its heart nor an edge to see.
        const level = LIT.pool * share * share * (3 - 2 * share)
        return [level, level, level]
      })
      pool.setAttribute('color', new Float32BufferAttribute(glow.flat(), 3))
      pool.deleteAttribute('normal')
      pool.deleteAttribute('uv')
      pool.translate(light.pool.x, OVER_GROUND, light.pool.z)

      // The beam, in the floodlight's frame: from the lamp down to the pool's edge.
      const throwTo = SITE.floodlights.pool.throw
      const positions: number[] = []
      const colors: number[] = []
      for (let side = 0; side < POOL.sides; side++) {
        const [from, to] = [side, side + 1].map((step) => (step / POOL.sides) * 2 * Math.PI)
        positions.push(lampX, lampY, lampZ)
        colors.push(LIT.beam, LIT.beam, LIT.beam)
        for (const angle of [from ?? 0, to ?? 0]) {
          positions.push(radius * Math.sin(angle), OVER_GROUND, throwTo + radius * Math.cos(angle))
          colors.push(0, 0, 0)
        }
      }
      const beam = new BufferGeometry()
      beam.setAttribute('position', new Float32BufferAttribute(positions, 3))
      beam.setAttribute('color', new Float32BufferAttribute(colors, 3))

      return [pool, stood(beam, light)]
    }),
  )
}

// The floodlights on the perimeter, a mast at each place the site plan gives, its head looking into the site
// and down. Dark at rest. While `lit`, someone near the site or inside it, the lamps are lit in white and each
// lights a pool on the ground at its foot, a faint beam coming down to it; all of it comes on and goes out in
// a fade. Their light is simulated: no light is added to the scene and nothing casts a shadow more. The lamps
// emit and the pools are light added over the ground, so the halo takes both for lights, and nothing of that
// light is drawn at all while they are dark. It is three shapes in all: the masts, the lamps, the light.
export const Floodlights = memo(function Floodlights({ lit }: SceneProps['floodlights']) {
  const [masts, lamps, light] = useMemo(() => {
    const lights = floodlights()
    return [mastShapes(lights), lampShapes(lights), lightShapes(lights)]
  }, [])
  useEffect(
    () => () => {
      for (const shape of [masts, lamps, light]) shape.dispose()
    },
    [masts, lamps, light],
  )
  const lamp = useRef<MeshStandardMaterial>(null)
  const thrown = useRef<Mesh>(null)
  const glow = useRef<MeshBasicMaterial>(null)
  const litNow = useFade([lit ? 1 : 0])

  useFrame(() => {
    const level = litNow()[0] ?? 0
    if (lamp.current) lamp.current.emissiveIntensity = level * LIT.lamp
    if (thrown.current) thrown.current.visible = level > 0
    glow.current?.color.set(FLOODLIGHT_COLOR).multiplyScalar(level)
  })

  return (
    <group>
      <mesh geometry={masts} castShadow receiveShadow>
        <meshStandardMaterial color={STEEL} roughness={0.6} />
      </mesh>
      <mesh geometry={lamps}>
        <meshStandardMaterial
          ref={lamp}
          color={GRAPHITE}
          roughness={0.3}
          emissive={FLOODLIGHT_COLOR}
          emissiveIntensity={0}
        />
      </mesh>
      {/* Over what is drawn on the ground, the camera's sector included. */}
      <mesh ref={thrown} geometry={light} renderOrder={3} visible={false}>
        <meshBasicMaterial
          ref={glow}
          color="#000000"
          vertexColors
          transparent
          blending={AdditiveBlending}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
})
