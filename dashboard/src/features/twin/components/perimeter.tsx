import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useFade } from '../hooks/use-fade'
import { usePan } from '../hooks/use-pan'
import { useSweep } from '../hooks/use-sweep'
import { cameraField, type Face, fieldBase, fieldWalls, type SpacePoint } from '../utils/camera-field'
import { sweepGlow } from '../utils/presence'
import { INTRUSION_COLOR, PRESENCE_COLOR, type SceneProps } from '../utils/scene'
import {
  barbedHeight,
  fenceBarbs,
  fenceLength,
  fencePosts,
  type GroundPoint,
  gateLine,
  halfGate,
  meshCell,
  SITE,
} from '../utils/site'
import { ChainLinkMaterial, inDiamonds } from './chain-link'
import { OFF_WHITE, STEEL } from './palette'
import { Box } from './volumes'

const POST_RADIUS = 0.013
// The fence's two rails: how high each runs, as a share of the fence's height, and how it is drawn.
const RAILS = [0.45, 0.9] as const
const RAIL = { radius: 0.007, sides: 6, steps: 240 } as const
// The strand of barbed wire, and the two points of a barb: how long each is, how far it leans along the
// strand, and how far a barb is twisted round it, one way then the other from a barb to the next.
const STRAND = { radius: 0.0045, sides: 4 } as const
const BARB = { radius: 0.003, length: 0.03, lean: 0.9, twist: 0.6 } as const
// The mesh is drawn before whatever else is seen through, which it never veils: the sweep, the camera's
// field, the intruder.
const MESH_DRAWN = -1

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

// The mesh all along the fence: one surface from the gate's first post round to its last, the way the rails
// go, whose diamonds the material draws.
function meshShape(): BufferGeometry {
  const { radius, height, mesh, gate } = SITE.fence
  const around = new CylinderGeometry(radius, radius, height, RAIL.steps, 1, true, gate.bearing + halfGate(), railArc())
  return inDiamonds(around.translate(0, height / 2, 0), Math.round(fenceLength() / meshCell()), mesh.rows)
}

// A barb: two points that cross on the strand, which runs along x. There are hundreds of them, each a few
// pixels long: three sides and no ends are all that shows.
function barbShape(): BufferGeometry {
  const points = [-1, 1].map((way) =>
    new CylinderGeometry(BARB.radius, BARB.radius, BARB.length, 3, 1, true).rotateZ(way * BARB.lean),
  )
  const barb = mergeGeometries(points)
  for (const point of points) point.dispose()
  return barb
}

// The fence: a post at every point the site plan gives, two rails from one side of the gate round to the
// other, a chain-link mesh between the posts and, on top of them, a strand of barbed wire. The mesh casts no
// shadow, which would be a veil over the ground all along the fence, and takes none.
function Fence() {
  const { radius, height } = SITE.fence
  const top = barbedHeight()
  const posts = useMemo(fencePosts, [])
  const barbs = useMemo(fenceBarbs, [])
  const drawn = useRef<InstancedMesh>(null)
  const barbed = useRef<InstancedMesh>(null)
  const [link, barb] = useMemo(() => [meshShape(), barbShape()], [])

  useLayoutEffect(() => {
    if (drawn.current) standOn(drawn.current, posts, top)
  }, [posts, top])

  useLayoutEffect(() => {
    const mesh = barbed.current
    if (!mesh) return
    const placed = new Object3D()
    placed.rotation.order = 'YXZ'
    barbs.forEach(({ x, z }, index) => {
      placed.position.set(x, top, z)
      // Turned to run along the strand, then twisted round it.
      placed.rotation.set(index % 2 ? BARB.twist : -BARB.twist, Math.atan2(x, z), 0)
      placed.updateMatrix()
      mesh.setMatrixAt(index, placed.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [barbs, top])

  return (
    <group>
      <instancedMesh ref={drawn} args={[undefined, undefined, posts.length]} castShadow receiveShadow>
        <cylinderGeometry args={[POST_RADIUS, POST_RADIUS, top, 8]} />
        <meshStandardMaterial color={STEEL} roughness={0.6} />
      </instancedMesh>
      {RAILS.map((share) => (
        <mesh key={share} position={[0, height * share, 0]} rotation={railTurn()} castShadow>
          <torusGeometry args={[radius, RAIL.radius, RAIL.sides, RAIL.steps, railArc()]} />
          <meshStandardMaterial color={STEEL} roughness={0.6} />
        </mesh>
      ))}
      <mesh geometry={link} renderOrder={MESH_DRAWN}>
        <ChainLinkMaterial />
      </mesh>
      <mesh position={[0, top, 0]} rotation={railTurn()} castShadow>
        <torusGeometry args={[radius, STRAND.radius, STRAND.sides, RAIL.steps, railArc()]} />
        <meshStandardMaterial color={STEEL} roughness={0.6} />
      </mesh>
      <instancedMesh ref={barbed} args={[barb, undefined, barbs.length]}>
        <meshStandardMaterial color={STEEL} roughness={0.6} />
      </instancedMesh>
    </group>
  )
}

// A leaf of the gate: how thick the bars of its frame are, its brace thinner, and how far off the ground
// it hangs.
const LEAF = { bar: 0.012, brace: 0.008, clear: 0.012 } as const

// How far a leaf of the gate swings into the site once it is open, in radians.
const SWING = 1.4

// The gate's two leaves, each about its own hinge, which stands at `hinge` in the gate's own frame: x along it
// from its middle, z out of the site. Each hangs from its pillar and reaches the middle: a frame of bars,
// braced from the foot of its hinge up to its latch, and the pane of mesh it holds.
function leafShapes(opening: number) {
  const { width, height } = SITE.fence.gate.leaf
  const { bar, brace, clear } = LEAF
  // Between the middles of its bars.
  const [across, up] = [width - bar, height - clear - bar]
  const middle = clear + (height - clear) / 2

  return ([-1, 1] as const).map((side) => {
    const centre = (-side * across) / 2
    const bars = [
      new BoxGeometry(bar, up + bar, bar).translate(0, middle, 0),
      new BoxGeometry(bar, up + bar, bar).translate(-side * across, middle, 0),
      new BoxGeometry(across, bar, bar).translate(centre, middle - up / 2, 0),
      new BoxGeometry(across, bar, bar).translate(centre, middle + up / 2, 0),
      new BoxGeometry(Math.hypot(across, up), brace, brace)
        .rotateZ(-side * Math.atan2(up, across))
        .translate(centre, middle, 0),
    ]
    const frame = mergeGeometries(bars)
    for (const part of bars) part.dispose()
    const pane = inDiamonds(new PlaneGeometry(across, up), across / meshCell(), up / meshCell())
    return { side, hinge: side * (opening / 2 - bar / 2), frame, pane: pane.translate(centre, middle, 0) }
  })
}

// The gate: a pillar on the post each side of it, taller than the fence, and a leaf hung from each, which
// meet in the middle while it is closed. A leaf is openwork like the fence: the camera's sector and whoever
// stands in it are seen through its mesh. It opens while an intrusion is going on, each leaf swung into the
// site about its hinge, and closes once the Alert is cleared: both in a fade. The shadows are drawn once: it
// asks for them again while its leaves move.
function Gate({ open }: { open: boolean }) {
  const { bearing, pillar } = SITE.fence.gate
  const { from, to, opening } = useMemo(gateLine, [])
  const leaves = useMemo(() => leafShapes(opening), [opening])
  useEffect(
    () => () => {
      for (const { frame, pane } of leaves) {
        frame.dispose()
        pane.dispose()
      }
    },
    [leaves],
  )
  const hung = useRef<(Group | null)[]>([])
  const openNow = useFade([open ? 1 : 0])

  const swungTo = useRef(0)

  useFrame(({ gl }) => {
    const swung = (openNow()[0] ?? 0) * SWING
    if (swung === swungTo.current) return
    swungTo.current = swung
    gl.shadowMap.needsUpdate = true
    leaves.forEach(({ side }, index) => {
      const leaf = hung.current[index]
      if (leaf) leaf.rotation.y = -side * swung
    })
  })

  return (
    <group position={[(from.x + to.x) / 2, 0, (from.z + to.z) / 2]} rotation={[0, bearing, 0]}>
      {[-1, 1].map((side) => (
        <Box
          key={side}
          size={[pillar.width, pillar.height, pillar.width]}
          at={[(side * (opening + pillar.width)) / 2, 0, 0]}
          color={STEEL}
          bevel={0.006}
        />
      ))}
      {leaves.map(({ side, hinge, frame, pane }, index) => (
        <group
          key={side}
          ref={(leaf) => {
            hung.current[index] = leaf
          }}
          position={[hinge, 0, 0]}
        >
          <mesh geometry={frame} castShadow receiveShadow>
            <meshStandardMaterial color={STEEL} roughness={0.6} />
          </mesh>
          <mesh geometry={pane} renderOrder={MESH_DRAWN}>
            <ChainLinkMaterial />
          </mesh>
        </group>
      ))}
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
// It is drawn after the mesh, which does not veil it.
function FenceSweep({ presence }: Pick<PerimeterProps, 'presence'>) {
  const { radius, height } = SITE.fence
  const top = barbedHeight()
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
    standOn(mesh, posts, top)
    // Dark from the first frame: the material is drawn with a color for each post.
    posts.forEach((_, index) => {
      mesh.setColorAt(index, shade.setScalar(0))
    })
  }, [posts, top, shade])

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
        <cylinderGeometry args={[POST_RADIUS * WRAP, POST_RADIUS * WRAP, top, 8]} />
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

// A corner of a drawn shape: a point of the site, on the ground unless `y` says how high, and how opaque the
// shape is there (1 unless given).
type Corner = GroundPoint & { y?: number; shade?: number }
type Triangle = readonly [Corner, Corner, Corner]

// A shape from its triangles, each looking the way that sees its corners go round counter-clockwise.
function shapeOf(triangles: readonly Triangle[]): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  for (const corner of triangles.flat()) {
    positions.push(corner.x, corner.y ?? 0, corner.z)
    colors.push(1, 1, 1, corner.shade ?? 1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4))
  geometry.computeVertexNormals()
  return geometry
}

// A flat shape lying on the ground and looking up, from its triangles.
function onGround(triangles: readonly Triangle[]): BufferGeometry {
  return shapeOf(
    triangles.map(([a, b, c]) => {
      // Counter-clockwise seen from above: the face looks up.
      const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0
      return up ? [a, b, c] : [a, c, b]
    }),
  )
}

// Steps the watched arc of the fence is drawn in.
const ARC_STEPS = 32
const LINE = 0.014
// How opaque the sector is under the lens, and where it reaches the fence.
const SHADE = { lens: 0.15, fence: 0.03 }
// The same for the walls of the volume over it, from the lens down: a veil, the Enclosure and the plant are
// seen through them.
const WALL = { lens: 0.12, fence: 0.03 }
// The volume's two edges, from the lens to the ends of the arc: how thin they are drawn.
const EDGE = 0.005
// How bright the lit field emits, before its opacity: the sector is a wash of light, the walls a faint one
// over what stands behind them, the line and the edges what bounds them.
const LIT = { field: 6, line: 4, wall: 1, edge: 4 }

const UP = new Vector3(0, 1, 0)

// A thin rod from `from` to each of `ends`, all of them one shape.
function rodsTo(from: SpacePoint, ends: readonly SpacePoint[], radius: number): BufferGeometry {
  const rods = ends.map((end) => {
    const along = new Vector3(end.x - from.x, end.y - from.y, end.z - from.z)
    const length = along.length()
    // Drawn from its foot up, then turned toward its end.
    return new CylinderGeometry(radius, radius, length, 6, 1, true)
      .translate(0, length / 2, 0)
      .applyQuaternion(new Quaternion().setFromUnitVectors(UP, along.normalize()))
      .translate(from.x, from.y, from.z)
  })
  const all = mergeGeometries(rods)
  for (const rod of rods) rod.dispose()
  return all
}

// What the camera's field is drawn as, turned by `pan`: the sector on the ground, the line around it, the walls
// of the volume over it and its two edges.
function fieldShapes(pan: number) {
  const field = cameraField(ARC_STEPS, pan)
  const { lens, under, arc } = field
  const around = [under, ...arc]
  // Most opaque at the lens and under it, least on the fence.
  const shaded = (faces: readonly Face[], shade: typeof SHADE): Triangle[] => {
    const drawn = (corner: SpacePoint): Corner => ({
      ...corner,
      shade: corner.x === under.x && corner.z === under.z ? shade.lens : shade.fence,
    })
    return faces.map(([a, b, c]) => [drawn(a), drawn(b), drawn(c)])
  }

  return {
    sector: onGround(shaded(fieldBase(field), SHADE)),
    outline: onGround(
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
    walls: shapeOf(shaded(fieldWalls(field), WALL)),
    edges: rodsTo(lens, [arc.at(0), arc.at(-1)].flatMap((end) => end ?? []), EDGE),
  }
}

type FieldShapes = ReturnType<typeof fieldShapes>
const FIELD_PARTS = ['sector', 'outline', 'walls', 'edges'] as const

// The camera's field of view, drawn as the volume the site plan gives it: it leaves from the Enclosure's lens
// and opens down to the arc of the fence the camera watches. Its base is the sector on the ground, from under
// the lens to that arc; its walls are a veil, its two edges a thin line each. Neutral and faint until an
// intrusion lights it: it then emits the intrusion's color, so the halo takes it for a light, and goes out
// when the Alert is cleared. Both in a fade, the volume and its base together. It turns about the lens with
// the camera, as the `intrusion` Alert says how far it is turned, and back to where it rests once that is
// cleared: drawn anew while it turns, as the arc it lands on is another one. It is drawn before the intruder,
// which it does not veil, and casts no shadow.
function CameraField({ lit, pan }: SceneProps['sector'] & SceneProps['camera']) {
  const sectorMaterial = useRef<MeshStandardMaterial>(null)
  const lineMaterial = useRef<MeshStandardMaterial>(null)
  const wallMaterial = useRef<MeshStandardMaterial>(null)
  const edgeMaterial = useRef<MeshStandardMaterial>(null)
  const meshes = useRef<Partial<Record<(typeof FIELD_PARTS)[number], Mesh | null>>>({})
  const litNow = useFade([lit ? 1 : 0])
  const panNow = usePan(pan)
  // The field as it is drawn, and how far turned.
  const rested = useMemo(() => fieldShapes(0), [])
  const drawn = useRef<{ pan: number; shapes: FieldShapes }>({ pan: 0, shapes: rested })
  useEffect(
    () => () => {
      for (const part of FIELD_PARTS) drawn.current.shapes[part].dispose()
    },
    [],
  )

  useFrame((_, delta) => {
    const level = litNow()[0] ?? 0
    if (sectorMaterial.current) sectorMaterial.current.emissiveIntensity = level * LIT.field
    if (lineMaterial.current) lineMaterial.current.emissiveIntensity = level * LIT.line
    if (wallMaterial.current) wallMaterial.current.emissiveIntensity = level * LIT.wall
    if (edgeMaterial.current) edgeMaterial.current.emissiveIntensity = level * LIT.edge

    const turned = panNow(delta)
    if (turned === drawn.current.pan) return
    const shapes = fieldShapes(turned)
    for (const part of FIELD_PARTS) {
      const mesh = meshes.current[part]
      if (mesh) mesh.geometry = shapes[part]
      drawn.current.shapes[part].dispose()
    }
    drawn.current = { pan: turned, shapes }
  })

  const { sector, outline, walls, edges } = rested
  const part = (name: (typeof FIELD_PARTS)[number]) => (mesh: Mesh | null) => {
    meshes.current[name] = mesh
  }

  return (
    <group>
      {/* Just above the ground, the line just above the sector, so neither flickers into the other. */}
      <group position={[0, 0.004, 0]}>
        <mesh ref={part('sector')} geometry={sector} renderOrder={1} receiveShadow>
          <meshStandardMaterial
            ref={sectorMaterial}
            color={OFF_WHITE}
            roughness={1}
            emissive={INTRUSION_COLOR}
            emissiveIntensity={0}
            vertexColors
            transparent
            depthWrite={false}
          />
        </mesh>
        <mesh ref={part('outline')} geometry={outline} position={[0, 0.002, 0]} renderOrder={2} receiveShadow>
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
      {/* Only the walls that face the eye are drawn: one veil over what stands behind them, whole, whatever
          the side the volume is seen from. */}
      <mesh ref={part('walls')} geometry={walls} renderOrder={2}>
        <meshStandardMaterial
          ref={wallMaterial}
          color={OFF_WHITE}
          roughness={1}
          emissive={INTRUSION_COLOR}
          emissiveIntensity={0}
          vertexColors
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh ref={part('edges')} geometry={edges} renderOrder={2}>
        <meshStandardMaterial
          ref={edgeMaterial}
          color={OFF_WHITE}
          roughness={1}
          emissive={INTRUSION_COLOR}
          emissiveIntensity={0}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

export interface PerimeterProps {
  // Whether the camera's field is lit, the sector on the ground with it: an intrusion is going on in it. The
  // gate is open for as long.
  sectorLit: boolean
  // How far the camera is turned from where it rests, in radians: its field turns with it.
  pan: number
  // Whether someone is near the site: a `presence` Alert is active.
  presence: boolean
}

// The Outpost's perimeter: the fence around the site, chain-link under barbed wire and closed by its gate,
// which an amber sweep goes round while someone is near, and what the camera watches of it, a volume from its
// lens down to the fence, which lights up on an intrusion and turns with the camera. The gate opens for as
// long as the intrusion goes on.
export const Perimeter = memo(function Perimeter({ sectorLit, pan, presence }: PerimeterProps) {
  return (
    <group>
      <Fence />
      <Gate open={sectorLit} />
      <FenceSweep presence={presence} />
      <CameraField lit={sectorLit} pan={pan} />
    </group>
  )
})
