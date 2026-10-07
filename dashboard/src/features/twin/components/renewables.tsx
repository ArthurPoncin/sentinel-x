import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, type BufferGeometry, type Group, type InstancedMesh, Matrix4, SphereGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { type Block, SITE, solarPanels } from '../utils/site'
import { GLASS, GRAPHITE, OFF_WHITE, STEEL } from './palette'
import { Box, boxShape, type Profile, Turned } from './volumes'

// A solar panel: a pane of glass `glass` thick, proud of the steel frame that goes `rim` round it, on a post.
// The frame's bars show through the glass, `bar` wide: they part it in `cells` across and up its slope.
const PANEL = { thick: 0.012, glass: 0.006, rim: 0.012, post: 0.02, bar: 0.006, cells: [3, 2] } as const

function merged(shapes: BufferGeometry[]): BufferGeometry {
  const all = mergeGeometries(shapes)
  for (const shape of shapes) shape.dispose()
  return all
}

// The one shape every panel is, in two parts, standing on its own point of the ground: its frame on its
// post, and its glass. Leaned to face z, its top edge at the height the site plan gives.
function panelShapes(): [frame: BufferGeometry, glass: BufferGeometry] {
  const { height, panel } = SITE.solar
  const { width, length, tilt } = panel
  const middle = height - (length / 2) * Math.sin(tilt)
  const leaned = (pane: BufferGeometry) => pane.rotateX(tilt).translate(0, middle, 0)
  // Just proud of the glass, so they are not lost in it.
  const proud = PANEL.thick + PANEL.glass + 0.002
  const [across, up] = PANEL.cells
  const shares = (cells: number) => Array.from({ length: cells - 1 }, (_, index) => (index + 1) / cells - 0.5)

  return [
    merged([
      leaned(new BoxGeometry(width, PANEL.thick, length)),
      ...shares(across).map((share) => leaned(new BoxGeometry(PANEL.bar, proud, length).translate(share * width, 0, 0))),
      ...shares(up).map((share) => leaned(new BoxGeometry(width, proud, PANEL.bar).translate(0, 0, share * length))),
      new BoxGeometry(PANEL.post, middle, PANEL.post).translate(0, middle / 2, 0),
    ]),
    leaned(new BoxGeometry(width - 2 * PANEL.rim, PANEL.thick + PANEL.glass, length - 2 * PANEL.rim)),
  ]
}

// The solar field: the panels the site plan stands, leaned toward the entrance. One shape drawn in instances,
// its frames in one draw and its glass in another, however many panels there are. They do not move: their
// shadows are drawn once, with all the others.
function SolarField() {
  const panels = useMemo(solarPanels, [])
  const [frame, glass] = useMemo(panelShapes, [])
  const frames = useRef<InstancedMesh>(null)
  const panes = useRef<InstancedMesh>(null)
  useEffect(
    () => () => {
      for (const shape of [frame, glass]) shape.dispose()
    },
    [frame, glass],
  )

  useLayoutEffect(() => {
    const placed = new Matrix4()
    for (const mesh of [frames.current, panes.current]) {
      if (!mesh) continue
      panels.forEach(({ x, z }, index) => mesh.setMatrixAt(index, placed.makeTranslation(x, 0, z)))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [panels])

  return (
    <group>
      <instancedMesh ref={frames} args={[frame, undefined, panels.length]} castShadow receiveShadow>
        <meshStandardMaterial color={STEEL} roughness={0.6} />
      </instancedMesh>
      {/* Smooth enough to catch the key light as the camera orbits. */}
      <instancedMesh ref={panes} args={[glass, undefined, panels.length]} castShadow receiveShadow>
        <meshStandardMaterial color={GLASS} roughness={0.35} />
      </instancedMesh>
    </group>
  )
}

// The turbine's nacelle, on top of its mast: `length` from its back to the rotor, which turns `nose` in front
// of the mast's axis.
const NACELLE = { width: 0.09, height: 0.09, length: 0.24, nose: 0.17 } as const
// A blade: `chord` wide at its root and `tip` of that at its end, and the hub they are set in.
const BLADE = { chord: 0.07, tip: 0.35, thick: 0.012, hub: 0.04 } as const

// The rotor as one shape, turning about z: its hub and its blades, evenly spaced round it, each narrowing
// from its root to its tip.
function rotorShape(): BufferGeometry {
  const { radius, blades } = SITE.turbine.rotor
  const blade = () => {
    const shape = new BoxGeometry(BLADE.chord, radius, BLADE.thick).translate(0, radius / 2, 0)
    const points = shape.getAttribute('position')
    for (let index = 0; index < points.count; index++) {
      points.setX(index, points.getX(index) * (1 - ((1 - BLADE.tip) * points.getY(index)) / radius))
    }
    shape.computeVertexNormals()
    return shape
  }

  return merged([
    new SphereGeometry(BLADE.hub, 20, 12),
    ...Array.from({ length: blades }, (_, index) => blade().rotateZ((index / blades) * 2 * Math.PI)),
  ])
}

// The wind turbine: a mast that tapers, a nacelle turned into the wind, and a rotor that turns slowly, a turn
// every `rotor.period` seconds, whatever the feed says. The mast and the nacelle cast their shadow, drawn once
// with all the others; the blades cast none, so that turning them asks for no shadow again.
function WindTurbine({ x, z, radius, height, bearing, rotor }: (typeof SITE)['turbine']) {
  const mast = useMemo<Profile>(
    () => [
      [radius, 0],
      [radius, 0.04],
      [radius * 0.7, 0.07],
      [radius * 0.4, height],
      [0, height],
    ],
    [radius, height],
  )
  const shape = useMemo(rotorShape, [])
  useEffect(() => () => shape.dispose(), [shape])
  const turning = useRef<Group>(null)

  useFrame((_, delta) => {
    if (turning.current) turning.current.rotation.z -= (delta * 2 * Math.PI) / rotor.period
  })

  return (
    // In the turbine's own frame: z is the way it faces.
    <group position={[x, 0, z]} rotation={[0, bearing, 0]}>
      <Turned profile={mast} color={OFF_WHITE} />
      <Box
        size={[NACELLE.width, NACELLE.height, NACELLE.length]}
        at={[0, height - NACELLE.height / 2, NACELLE.nose - NACELLE.length / 2]}
        color={OFF_WHITE}
        bevel={0.02}
      />
      <group ref={turning} position={[0, height, NACELLE.nose + BLADE.thick]}>
        <mesh geometry={shape}>
          <meshStandardMaterial color={OFF_WHITE} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

// The battery container's graphite parts as one shape, around the middle of its base: its plinth, its doors
// down the side that faces x, and the cooling unit on its roof.
function batteryTrim({ width, depth, height }: Pick<Block, 'width' | 'depth' | 'height'>): BufferGeometry {
  const DOORS = 4
  const door = depth / DOORS
  const tall = height - PLINTH
  // A box standing on the point given.
  const standing = (size: readonly [number, number, number], bevel: number, x: number, y: number, z: number) =>
    boxShape(size, bevel).translate(x, y + size[1] / 2, z)

  return merged([
    standing([width + 0.04, PLINTH, depth + 0.04], 0.012, 0, 0, 0),
    ...Array.from({ length: DOORS }, (_, index) =>
      standing([0.012, tall * 0.7, door - 0.04], 0.004, width / 2, PLINTH + tall * 0.12, (index + 0.5 - DOORS / 2) * door),
    ),
    standing([width * 0.6, 0.035, depth * 0.3], 0.012, 0, height - 0.005, -depth * 0.22),
  ])
}

// How high the plinth the battery container stands on is.
const PLINTH = 0.025

// The battery container, lying along z: off-white on a graphite plinth, its doors down the side that faces
// the transformer station, a cooling unit on its roof. Two draws: its walls, and all that is graphite.
function Batteries({ x, z, width, depth, height }: Block) {
  const trim = useMemo(() => batteryTrim({ width, depth, height }), [width, depth, height])
  useEffect(() => () => trim.dispose(), [trim])

  return (
    <group position={[x, 0, z]}>
      <Box size={[width, height - PLINTH, depth]} at={[0, PLINTH, 0]} color={OFF_WHITE} />
      <mesh geometry={trim} castShadow receiveShadow>
        <meshStandardMaterial color={GRAPHITE} roughness={0.65} />
      </mesh>
    </group>
  )
}

// What makes the plant an eco-responsible one, where the site plan puts it: a solar field, a wind turbine and
// the batteries that store what they give. No signal drives any of it: its materials are the maquette's
// neutral ones, and the turbine turns at the one pace.
export const Renewables = memo(function Renewables() {
  return (
    <group>
      <SolarField />
      <WindTurbine {...SITE.turbine} />
      <Batteries {...SITE.batteries} />
    </group>
  )
})
