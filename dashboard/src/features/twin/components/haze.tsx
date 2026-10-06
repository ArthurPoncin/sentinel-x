import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { type Group, IcosahedronGeometry, MathUtils, type Mesh, type MeshLambertMaterial } from 'three'
import { WISP_LIFE, wispAt } from '../utils/haze'
import { alongPipe, SITE } from '../utils/site'
import { VapourMaterial } from './vapour'

// Wisps in the haze: enough to overlap all along the pipe, whatever their age, and no more. They are what the
// haze costs: each one is drawn over whatever is behind it.
const WISPS = 22
// How opaque a wisp is at its densest, when the gas is at its peak.
const DENSITY = 0.7
// How soon a wisp thins out toward its edge: sooner than a puff of steam, a haze has no outline at all.
const EDGE = 2.6
// How high a wisp lying on the ground is, for its width.
const FLAT = 0.36
// How far the thinnest haze reaches, as a share of the thickest: it spreads as it thickens.
const REACH = 0.6
// How fast the haze follows the gas level. Slower than EASE: with a Reading a second it is still on its way to
// one when the next comes, so it never rests on a step.
const HAZE_EASE = 1.2
// Each wisp seeps from its own point of the pipe and creeps its own way, the same at every turn: the golden
// ratio spreads them all along, the golden angle all around.
const ALONG = 0.618
const AROUND = 2.4

export interface HazeProps {
  // How thick, 0–1: none at 0, when the air is calm.
  density: number
}

// The haze of a gas leak: it seeps from the gas pipe, sinks and lies on the ground around it, thicker as the
// gas rises. Made of what the steam is made of, so it takes the scene's light and does not glow.
export function Haze({ density }: HazeProps) {
  const haze = useRef<Group>(null)
  const wisps = useRef<(Mesh | null)[]>([])
  const seconds = useRef(0)
  const shown = useRef(density)
  const geometry = useMemo(() => new IcosahedronGeometry(1, 2), [])
  const sources = useMemo(() => Array.from({ length: WISPS }, (_, index) => alongPipe((index * ALONG) % 1)), [])

  useFrame((_, delta) => {
    seconds.current += delta
    shown.current = MathUtils.damp(shown.current, density, HAZE_EASE, delta)
    if (!haze.current) return
    // Nothing to draw while the air is calm.
    haze.current.visible = shown.current > 0.004
    if (!haze.current.visible) return

    const reach = REACH + (1 - REACH) * shown.current
    wisps.current.forEach((mesh, index) => {
      const source = sources[index]
      if (!mesh || !source) return
      const { creep, sink, radius, opacity } = wispAt((seconds.current / WISP_LIFE + index / WISPS) % 1)
      const wide = radius * reach
      // Round as it leaves the pipe, flat once it lies on the ground, which it rests on without sinking in.
      const high = wide * MathUtils.lerp(1, FLAT, sink)
      const way = index * AROUND
      mesh.position.set(
        source.x + creep * reach * Math.cos(way),
        MathUtils.lerp(SITE.pipe.height, high, sink),
        source.z + creep * reach * Math.sin(way),
      )
      mesh.scale.set(wide, high, wide)
      ;(mesh.material as MeshLambertMaterial).opacity = opacity * shown.current * DENSITY
    })
  })

  return (
    <group ref={haze} visible={false}>
      {Array.from({ length: WISPS }, (_, index) => index).map((index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            wisps.current[index] = mesh
          }}
          geometry={geometry}
          // After what is drawn on the ground, which it lies over from wherever it is seen.
          renderOrder={3}
        >
          <VapourMaterial edge={EDGE} />
        </mesh>
      ))}
    </group>
  )
}
