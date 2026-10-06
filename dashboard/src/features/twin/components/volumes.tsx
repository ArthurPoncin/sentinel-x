import { type Ref, useMemo } from 'react'
import { LatheGeometry, type MeshStandardMaterial, Vector2 } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// The maquette is built from these two: simple volumes with bevelled edges, which catch the studio light.

type Triple = readonly [number, number, number]

interface VolumeProps {
  // The middle of its base.
  at?: Triple
  color: string
  roughness?: number
}

// What a volume that can glow glows in, and its material: whoever holds it sets how bright
// (`emissiveIntensity`), frame by frame. It starts dark.
export interface Glow {
  color: string
  material: Ref<MeshStandardMaterial>
}

export interface BoxProps extends VolumeProps {
  // Width (x), height, depth (z).
  size: Triple
  bevel?: number
  glow?: Glow
}

// A box with bevelled edges, standing on `at`.
export function Box({
  size: [width, height, depth],
  at = [0, 0, 0],
  color,
  roughness = 0.65,
  bevel = 0.012,
  glow,
}: BoxProps) {
  const geometry = useMemo(() => new RoundedBoxGeometry(width, height, depth, 2, bevel), [width, height, depth, bevel])

  return (
    <mesh geometry={geometry} position={[at[0], at[1] + height / 2, at[2]]} castShadow receiveShadow>
      {glow ? (
        <meshStandardMaterial
          ref={glow.material}
          color={color}
          roughness={roughness}
          emissive={glow.color}
          emissiveIntensity={0}
        />
      ) : (
        <meshStandardMaterial color={color} roughness={roughness} />
      )}
    </mesh>
  )
}

// A profile going up the outside of a turned volume: [radius, height] pairs. Give it from a constant: a new
// array turns the volume again.
export type Profile = readonly (readonly [number, number])[]

export interface TurnedProps extends VolumeProps {
  profile: Profile
}

// A volume turned around the vertical, standing on `at`. Every corner of its profile stays a crisp edge.
export function Turned({ profile, at = [0, 0, 0], color, roughness = 0.65 }: TurnedProps) {
  const geometry = useMemo(() => {
    // LatheGeometry smooths its normals across a point: given twice, a point keeps one normal per side.
    const points = profile.flatMap(([radius, height], index) => {
      const point = new Vector2(radius, height)
      return index === 0 || index === profile.length - 1 ? [point] : [point, point.clone()]
    })
    return new LatheGeometry(points, 40)
  }, [profile])

  return (
    <mesh geometry={geometry} position={[at[0], at[1], at[2]]} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  )
}
