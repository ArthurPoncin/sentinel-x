import { useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
import { MathUtils, type MeshStandardMaterial } from 'three'
import { EASE } from '../utils/easing'
import { HEAT_COLOR, type SceneProps } from '../utils/scene'
import { type Block, type Column, type GroundPoint, SITE } from '../utils/site'
import { HeatShimmer } from './heat-shimmer'
import { GRAPHITE, OFF_WHITE, STEEL } from './palette'
import { Steam } from './steam'
import { Box, type Profile, Turned } from './volumes'

// How bright the hall's roof glows at the peak of the heat: a deep red all over, and its skylight, right over
// the generator, far brighter.
const GLOW = { roof: 0.55, skylight: 1.4 }

// The generator hall: off-white walls on a plinth, a graphite roof with its skylight, the door and a band
// of windows on its front, where the gas pipe comes in under the windows. Its roof glows red with `heat`,
// 0–1: it eases toward it, as everything that follows the Readings does.
function Hall({ x, z, width, depth, height, door, heat }: (typeof SITE)['hall'] & { heat: number }) {
  const PLINTH = 0.03
  const ROOF = 0.05
  const eaves = height - 2 * ROOF
  const front = depth / 2
  const roof = useRef<MeshStandardMaterial>(null)
  const skylight = useRef<MeshStandardMaterial>(null)
  const shown = useRef(heat)

  useFrame((_, delta) => {
    shown.current = MathUtils.damp(shown.current, heat, EASE, delta)
    if (roof.current) roof.current.emissiveIntensity = shown.current * GLOW.roof
    if (skylight.current) skylight.current.emissiveIntensity = shown.current * GLOW.skylight
  })

  return (
    <group position={[x, 0, z]}>
      <Box size={[width + 0.06, PLINTH, depth + 0.06]} color={GRAPHITE} />
      <Box size={[width, eaves - PLINTH, depth]} at={[0, PLINTH, 0]} color={OFF_WHITE} />
      <Box
        size={[width + 0.08, ROOF, depth + 0.08]}
        at={[0, eaves, 0]}
        color={GRAPHITE}
        glow={{ color: HEAT_COLOR, material: roof }}
      />
      <Box
        size={[width * 0.62, ROOF, depth * 0.3]}
        at={[0, eaves + ROOF, 0]}
        color={GRAPHITE}
        glow={{ color: HEAT_COLOR, material: skylight }}
      />
      <Box size={[door.width, door.height, 0.02]} at={[door.along, PLINTH, front]} color={GRAPHITE} bevel={0.006} />
      <Box size={[width * 0.46, 0.07, 0.02]} at={[-width * 0.16, eaves - 0.17, front]} color={GRAPHITE} bevel={0.006} />
    </group>
  )
}

// A chimney `radius` wide at its foot and `height` tall: an off-white shaft that tapers, under a graphite
// collar around the flue.
function Chimney({ x, z, radius, height }: Column) {
  const [shaft, collar] = useMemo<[Profile, Profile]>(
    () => [
      [
        [radius * 1.3, 0],
        [radius * 1.3, 0.05],
        [radius, 0.08],
        [radius * 0.72, height - 0.1],
        [0, height - 0.1],
      ],
      // Up the outside, over the lip, down the flue to its dark floor.
      [
        [radius * 0.7, height - 0.16],
        [radius * 0.84, height - 0.16],
        [radius * 0.84, height - 0.012],
        [radius * 0.8, height],
        [radius * 0.6, height],
        [radius * 0.6, height - 0.08],
        [0, height - 0.08],
      ],
    ],
    [radius, height],
  )

  return (
    <group position={[x, 0, z]}>
      <Turned profile={shaft} color={OFF_WHITE} />
      <Turned profile={collar} color={GRAPHITE} />
    </group>
  )
}

const INSULATOR: Profile = [
  [0.022, 0],
  [0.022, 0.02],
  [0.012, 0.03],
  [0.012, 0.09],
  [0, 0.09],
]

// One transformer: its tank, a radiator on each side, three insulators on top.
function TransformerUnit({ x, z }: GroundPoint) {
  const BASE = 0.03
  const TOP = BASE + 0.24

  return (
    <group position={[x, 0, z]}>
      <Box size={[0.3, TOP - BASE, 0.3]} at={[0, BASE, 0]} color={OFF_WHITE} />
      <Box size={[0.04, 0.18, 0.24]} at={[-0.19, BASE + 0.03, 0]} color={GRAPHITE} />
      <Box size={[0.04, 0.18, 0.24]} at={[0.19, BASE + 0.03, 0]} color={GRAPHITE} />
      {[-0.09, 0, 0.09].map((along) => (
        <Turned key={along} profile={INSULATOR} at={[0, TOP, along]} color={OFF_WHITE} />
      ))}
    </group>
  )
}

// The transformer station: two transformers on a pad, under the gantry the line leaves from.
function TransformerStation({ x, z, width, depth, height }: Block) {
  const BEAM = 0.03
  const back = -depth * 0.33

  return (
    <group position={[x, 0, z]}>
      <Box size={[width, 0.03, depth]} color={GRAPHITE} />
      <TransformerUnit x={-width * 0.22} z={depth * 0.12} />
      <TransformerUnit x={width * 0.22} z={depth * 0.12} />
      <Box size={[BEAM, height, BEAM]} at={[-width * 0.42, 0, back]} color={STEEL} bevel={0.004} />
      <Box size={[BEAM, height, BEAM]} at={[width * 0.42, 0, back]} color={STEEL} bevel={0.004} />
      <Box size={[width * 0.84 + BEAM, BEAM, BEAM]} at={[0, height - BEAM, back]} color={STEEL} bevel={0.004} />
    </group>
  )
}

// The gas tank: a bullet lying along x on two saddles, its valve on top.
function Tank({ x, z, width, depth, height }: Block) {
  const radius = depth / 2
  const axis = height - radius

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, axis, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <capsuleGeometry args={[radius, width - depth, 10, 32]} />
        <meshStandardMaterial color={OFF_WHITE} roughness={0.55} />
      </mesh>
      <Box size={[0.07, axis, depth * 0.8]} at={[-width * 0.24, 0, 0]} color={GRAPHITE} />
      <Box size={[0.07, axis, depth * 0.8]} at={[width * 0.24, 0, 0]} color={GRAPHITE} />
      <Box size={[0.1, 0.035, 0.1]} at={[0, height - 0.005, 0]} color={GRAPHITE} />
    </group>
  )
}

// The gas pipe: a run of pipe along each stretch of its path, on supports a pace apart, an elbow at each
// bend and a flange at each end.
function Pipe({ path, radius, height }: (typeof SITE)['pipe']) {
  const PACE = 0.45
  const stretches = path.slice(1).map((to, index) => {
    const from = path[index] ?? to
    const [x, z] = [to.x - from.x, to.z - from.z]
    return {
      middle: [(from.x + to.x) / 2, 0, (from.z + to.z) / 2] as const,
      length: Math.hypot(x, z),
      bearing: Math.atan2(x, z),
    }
  })
  // A cylinder stands along y: laid down by a quarter turn, it runs along its stretch.
  const flange = (along: number) => (
    <mesh position={[0, 0, along]} rotation-x={Math.PI / 2} castShadow>
      <cylinderGeometry args={[radius * 1.6, radius * 1.6, 0.04, 20]} />
      <meshStandardMaterial color={GRAPHITE} roughness={0.6} />
    </mesh>
  )

  return (
    <group position={[0, height, 0]}>
      {stretches.map(({ middle, length, bearing }, index) => {
        const supports = Math.ceil(length / PACE)

        return (
          // Each stretch in its own frame: from its middle, z runs along it.
          <group key={index} position={[...middle]} rotation={[0, bearing, 0]}>
            <mesh rotation-x={Math.PI / 2} castShadow receiveShadow>
              <cylinderGeometry args={[radius, radius, length, 20]} />
              <meshStandardMaterial color={OFF_WHITE} roughness={0.5} />
            </mesh>
            {index === 0 && flange(-length / 2)}
            {index === stretches.length - 1 && flange(length / 2)}
            {Array.from({ length: supports }, (_, support) => support).map((support) => (
              <Box
                key={support}
                size={[0.025, height - radius / 2, 0.025]}
                at={[0, -height, ((support + 0.5) / supports - 0.5) * length]}
                color={GRAPHITE}
                bevel={0.004}
              />
            ))}
          </group>
        )
      })}
      {path.slice(1, -1).map((bend) => (
        <mesh key={`${bend.x}:${bend.z}`} position={[bend.x, 0, bend.z]} castShadow>
          <sphereGeometry args={[radius * 1.25, 20, 12]} />
          <meshStandardMaterial color={GRAPHITE} roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

// The micro power plant the Outpost protects, where the site plan puts it. It is idling: steam rises from
// its chimneys. The heat shows on its generator hall: the roof glows with `intensity`, and the air above it
// ripples while `shimmer` is on.
export const PowerPlant = memo(function PowerPlant({ intensity, shimmer }: SceneProps['thermal']) {
  return (
    <group>
      <Hall {...SITE.hall} heat={intensity} />
      <HeatShimmer {...SITE.hall} active={shimmer} />
      {SITE.chimneys.map((chimney, index) => (
        <group key={chimney.x}>
          <Chimney {...chimney} />
          <Steam x={chimney.x} z={chimney.z} height={chimney.height} lag={index / SITE.chimneys.length} />
        </group>
      ))}
      <TransformerStation {...SITE.transformer} />
      <Tank {...SITE.tank} />
      <Pipe {...SITE.pipe} />
    </group>
  )
})
