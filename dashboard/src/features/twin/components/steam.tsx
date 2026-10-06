import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { IcosahedronGeometry, type Mesh, type MeshLambertMaterial } from 'three'
import { PUFF_LIFE, puffAt } from '../utils/steam'
import { VapourMaterial } from './vapour'

// Puffs in a plume: enough for each to overlap the next all the way up.
const PUFFS = 18
// The way the wind blows over the ground: to the right, a little away from the entrance.
const WIND = { x: 0.95, z: -0.31 }
// How opaque a puff is at its densest.
const DENSITY = 0.5
// How far off the plume's line a puff strays, in radii, so the plume is not a string of beads.
const STRAY = 0.45

export interface SteamProps {
  // The chimney's mouth: where it stands and how high.
  x: number
  z: number
  height: number
  // How far behind the other plumes this one runs, as a share of the time between two puffs.
  lag?: number
}

// The slow plume of steam above a chimney. The puffs are lit like the rest of the maquette, so they take the
// scene's light and do not glow.
export function Steam({ x, z, height, lag = 0 }: SteamProps) {
  const puffs = useRef<(Mesh | null)[]>([])
  const seconds = useRef(0)
  const geometry = useMemo(() => new IcosahedronGeometry(1, 2), [])

  useFrame((_, delta) => {
    seconds.current += delta
    puffs.current.forEach((mesh, index) => {
      if (!mesh) return
      const { rise, drift, radius, opacity } = puffAt((seconds.current / PUFF_LIFE + (index + lag) / PUFFS) % 1)
      // Each puff strays its own way, the same at every turn: the golden angle spreads them all around.
      const stray = radius * STRAY
      const way = index * 2.4
      mesh.position.set(drift * WIND.x + stray * Math.cos(way), rise, drift * WIND.z + stray * Math.sin(way))
      mesh.scale.setScalar(radius)
      mesh.visible = opacity > 0.004
      ;(mesh.material as MeshLambertMaterial).opacity = opacity * DENSITY
    })
  })

  return (
    <group position={[x, height, z]}>
      {Array.from({ length: PUFFS }, (_, index) => index).map((index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            puffs.current[index] = mesh
          }}
          geometry={geometry}
          visible={false}
        >
          <VapourMaterial />
        </mesh>
      ))}
    </group>
  )
}
