import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type InstancedMesh,
  type MeshStandardMaterial,
  Object3D,
  TorusGeometry,
} from 'three'
import { useFade } from '../hooks/use-fade'
import { useSweep } from '../hooks/use-sweep'
import { sweepGlow } from '../utils/presence'
import { INTRUSION_COLOR, PRESENCE_COLOR, type SceneProps } from '../utils/scene'
import { fencePosts, type GroundPoint, halfGate, lensPoint, SITE, watchedPoint } from '../utils/site'
import { OFF_WHITE, STEEL } from './palette'
import { Box } from './volumes'

const POST_RADIUS = 0.013
// The fence's two rails: how high each runs, as a share of the fence's height, and how it is drawn.
const RAILS = [0.45, 0.9] as const
const RAIL = { radius: 0.007, sides: 6, steps: 240 } as const

// A rail is a torus, which is drawn upright and from its right: laid flat and turned, it starts at the gate's
// first post and goes round the site the way the posts do, to the gate's last.
const railTurn = (): [x: number, y: number, z: number] => [
  -Math.PI / 2,
  0,
  SITE.fence.gate.bearing + halfGate() - Math.PI / 2,
]
const railArc = () => 2 * (Math.PI - halfGate())

// Stands an instance of `mesh` on each of `posts`.
function standOn(mesh: InstancedMesh, posts: readonly GroundPoint[], height: number) {
  const post = new Object3D()
  posts.forEach(({ x, z }, index) => {
    post.position.set(x, height / 2, z)
    post.updateMatrix()
    mesh.setMatrixAt(index, post.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

// The fence: a post at every point the site plan gives, two rails from one side of the gate round to the
// other, and a taller pillar on each side of the gate.
function Fence() {
  const { radius, height } = SITE.fence
  const posts = useMemo(fencePosts, [])
  const drawn = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    if (drawn.current) standOn(drawn.current, posts, height)
  }, [posts, height])

  return (
    <group>
      <instancedMesh ref={drawn} args={[undefined, undefined, posts.length]} castShadow receiveShadow>
        <cylinderGeometry args={[POST_RADIUS, POST_RADIUS, height, 8]} />
        <meshStandardMaterial color={STEEL} roughness={0.6} />
      </instancedMesh>
      {RAILS.map((share) => (
        <mesh key={share} position={[0, height * share, 0]} rotation={railTurn()} castShadow>
          <torusGeometry args={[radius, RAIL.radius, RAIL.sides, RAIL.steps, railArc()]} />
          <meshStandardMaterial color={STEEL} roughness={0.6} />
        </mesh>
      ))}
      {[posts.at(0), posts.at(-1)].map((post) =>
        post ? (
          <Box key={post.x} size={[0.045, height * 1.3, 0.045]} at={[post.x, 0, post.z]} color={STEEL} bevel={0.006} />
        ) : null,
      )}
    </group>
  )
}

// How bright the sweep's head emits, in the presence's amber.
const SWEEP_GLOW = 4
// How much wider than the posts and the rails the sweep's light is drawn: it wraps them.
const WRAP = 1.5

// The amber sweep that goes round the fence while someone is near the site, from the gate's first post to
// its last, and until the sweep in progress is over once they are gone. It is light added over the posts and
// the rails, brightest at its head: unlit, so the halo takes it for a light, and nothing at all while dark.
function FenceSweep({ presence }: Pick<PerimeterProps, 'presence'>) {
  const { radius, height } = SITE.fence
  const posts = useMemo(fencePosts, [])
  const lapNow = useSweep(presence)
  const litPosts = useRef<InstancedMesh>(null)
  // Whether the last frame left light on the fence.
  const lit = useRef(false)
  const amber = useMemo(() => new Color(PRESENCE_COLOR).multiplyScalar(SWEEP_GLOW), [])
  const shade = useMemo(() => new Color(), [])
  // Both rails are the one shape: what the sweep lights on it is a color at each of its points.
  const litRail = useMemo(() => {
    const rail = new TorusGeometry(radius, RAIL.radius * WRAP, RAIL.sides, RAIL.steps, railArc())
    rail.setAttribute('color', new BufferAttribute(new Float32Array(rail.getAttribute('position').count * 3), 3))
    return rail
  }, [radius])
  useEffect(() => () => litRail.dispose(), [litRail])

  useLayoutEffect(() => {
    const mesh = litPosts.current
    if (!mesh) return
    standOn(mesh, posts, height)
    // Dark from the first frame: the material is drawn with a color for each post.
    posts.forEach((_, index) => {
      mesh.setColorAt(index, shade.setScalar(0))
    })
  }, [posts, height, shade])

  useFrame(() => {
    const lap = lapNow()
    if (lap === null && !lit.current) return
    lit.current = lap !== null
    const glowAt = (place: number) => (lap === null ? 0 : sweepGlow(place, lap))

    const mesh = litPosts.current
    if (mesh?.instanceColor) {
      posts.forEach((_, index) => {
        mesh.setColorAt(index, shade.copy(amber).multiplyScalar(glowAt(index / (posts.length - 1))))
      })
      mesh.instanceColor.needsUpdate = true
    }

    // A torus lists its points side by side of its tube, each side from the first step to the last.
    const colors = litRail.getAttribute('color')
    for (let step = 0; step <= RAIL.steps; step++) {
      shade.copy(amber).multiplyScalar(glowAt(step / RAIL.steps))
      for (let side = 0; side <= RAIL.sides; side++) {
        colors.setXYZ(side * (RAIL.steps + 1) + step, shade.r, shade.g, shade.b)
      }
    }
    colors.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={litPosts} args={[undefined, undefined, posts.length]}>
        <cylinderGeometry args={[POST_RADIUS * WRAP, POST_RADIUS * WRAP, height, 8]} />
        <meshBasicMaterial transparent blending={AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      {RAILS.map((share) => (
        <mesh key={share} geometry={litRail} position={[0, height * share, 0]} rotation={railTurn()}>
          <meshBasicMaterial vertexColors transparent blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

// A corner of a shape drawn on the ground, and how opaque the shape is there (1 unless given).
type Corner = GroundPoint & { shade?: number }

// A flat shape lying on the ground and looking up, from its triangles.
function onGround(triangles: readonly (readonly [Corner, Corner, Corner])[]): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  for (const [a, b, c] of triangles) {
    // Counter-clockwise seen from above: the face looks up.
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0
    for (const corner of up ? [a, b, c] : [a, c, b]) {
      positions.push(corner.x, 0, corner.z)
      colors.push(1, 1, 1, corner.shade ?? 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4))
  geometry.computeVertexNormals()
  return geometry
}

// Steps the watched arc of the fence is drawn in.
const ARC_STEPS = 32
const LINE = 0.014
// How opaque the sector is under the lens, and where it reaches the fence.
const SHADE = { lens: 0.15, fence: 0.03 }
// How bright the lit sector emits, before its opacity: the field is a wash of light, the line its edge.
const LIT = { field: 6, line: 4 }

// The camera's field of view, drawn on the ground: a sector from under the lens to the arc of the fence
// where `x_norm` places the intruder. Neutral until an intrusion lights it: it then emits the intrusion's
// color, so the halo takes it for a light, and goes out when the Alert is cleared. Both in a fade.
function CameraSector({ lit }: SceneProps['sector']) {
  const fieldMaterial = useRef<MeshStandardMaterial>(null)
  const lineMaterial = useRef<MeshStandardMaterial>(null)
  const litNow = useFade([lit ? 1 : 0])

  useFrame(() => {
    const level = litNow()[0] ?? 0
    if (fieldMaterial.current) fieldMaterial.current.emissiveIntensity = level * LIT.field
    if (lineMaterial.current) lineMaterial.current.emissiveIntensity = level * LIT.line
  })

  const [field, outline] = useMemo(() => {
    const lens = lensPoint()
    const arc = Array.from({ length: ARC_STEPS + 1 }, (_, step) => watchedPoint(step / ARC_STEPS))
    const around = [lens, ...arc]

    return [
      onGround(
        arc.slice(1).map((point, step) => [
          { ...lens, shade: SHADE.lens },
          { ...(arc[step] ?? point), shade: SHADE.fence },
          { ...point, shade: SHADE.fence },
        ]),
      ),
      onGround(
        around.flatMap((from, index) => {
          const to = around[(index + 1) % around.length] ?? from
          const length = Math.hypot(to.x - from.x, to.z - from.z)
          // Half the line's width, across it.
          const across = { x: ((to.z - from.z) / length) * (LINE / 2), z: (-(to.x - from.x) / length) * (LINE / 2) }
          const [a, b, c, d] = [
            { x: from.x + across.x, z: from.z + across.z },
            { x: from.x - across.x, z: from.z - across.z },
            { x: to.x - across.x, z: to.z - across.z },
            { x: to.x + across.x, z: to.z + across.z },
          ] as const
          return [[a, b, c] as const, [a, c, d] as const]
        }),
      ),
    ]
  }, [])

  return (
    // Just above the ground, the line just above the field, so neither flickers into the other.
    <group position={[0, 0.004, 0]}>
      <mesh geometry={field} renderOrder={1} receiveShadow>
        <meshStandardMaterial
          ref={fieldMaterial}
          color={OFF_WHITE}
          roughness={1}
          emissive={INTRUSION_COLOR}
          emissiveIntensity={0}
          vertexColors
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={outline} position={[0, 0.002, 0]} renderOrder={2} receiveShadow>
        <meshStandardMaterial
          ref={lineMaterial}
          color={OFF_WHITE}
          roughness={1}
          emissive={INTRUSION_COLOR}
          emissiveIntensity={0}
          vertexColors
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

export interface PerimeterProps {
  // Whether the camera's sector is lit: an intrusion is going on in it.
  sectorLit: boolean
  // Whether someone is near the site: a `presence` Alert is active.
  presence: boolean
}

// The Outpost's perimeter: the fence around the site, which an amber sweep goes round while someone is near,
// and, on the ground, what the camera watches of it, which lights up on an intrusion.
export const Perimeter = memo(function Perimeter({ sectorLit, presence }: PerimeterProps) {
  return (
    <group>
      <Fence />
      <FenceSweep presence={presence} />
      <CameraSector lit={sectorLit} />
    </group>
  )
})
