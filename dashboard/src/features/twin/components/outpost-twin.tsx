import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import {
  type AmbientLight,
  Color,
  type DirectionalLight,
  type Group,
  MathUtils,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
} from 'three'
import { GAS_COLOR, type SceneProps, type StatusGrade } from '../utils/scene'

// How fast what is on screen eases toward the scene: a snapshot a second fades in, it does not jump.
const EASE = 4

// Eases `color` toward `target` over the frame, at the same pace as MathUtils.damp.
function ease(color: Color, target: Color, delta: number) {
  color.lerp(target, 1 - Math.exp(-EASE * delta))
}

function Enclosure({ color, glow }: SceneProps['enclosure']) {
  const enclosure = useRef<Group>(null)
  const material = useRef<MeshStandardMaterial>(null)
  const light = useRef<PointLight>(null)
  const target = useMemo(() => new Color(color), [color])
  // Set once: a color prop would be reapplied on every change and jump past the easing.
  const [initial] = useState(color)
  const shown = useRef(glow)

  useFrame((_, delta) => {
    shown.current = MathUtils.damp(shown.current, glow, EASE, delta)
    if (enclosure.current) enclosure.current.rotation.y += delta * 0.15
    if (material.current) {
      ease(material.current.color, target, delta)
      material.current.emissiveIntensity = shown.current * 0.6
    }
    if (light.current) light.current.intensity = shown.current * 8
  })

  return (
    <group ref={enclosure}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[2, 0.16, 1.5]} />
        <meshStandardMaterial color="#233040" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.66, 0]}>
        <boxGeometry args={[1.6, 1, 1.1]} />
        <meshStandardMaterial ref={material} color={initial} emissive={GAS_COLOR} emissiveIntensity={0} roughness={0.5} />
      </mesh>
      {/* What the gas throws on the ground around the Enclosure. */}
      <pointLight ref={light} position={[0, 0.66, 0]} color={GAS_COLOR} intensity={0} distance={7} />
    </group>
  )
}

// The Status's color grade over the whole scene: the sky, the light, the perimeter ring.
function Grade({ background, light, perimeter }: StatusGrade) {
  // Set once, then eased toward the Status's: a color prop would jump past the easing.
  const [initial] = useState({ light, perimeter })
  const sky = useRef(new Color(background))
  const ambient = useRef<AmbientLight>(null)
  const sun = useRef<DirectionalLight>(null)
  const ring = useRef<MeshBasicMaterial>(null)
  const targets = useMemo(
    () => ({ background: new Color(background), light: new Color(light), perimeter: new Color(perimeter) }),
    [background, light, perimeter],
  )

  useFrame(({ scene }, delta) => {
    ease(sky.current, targets.background, delta)
    scene.background = sky.current
    if (ambient.current) ease(ambient.current.color, targets.light, delta)
    if (sun.current) ease(sun.current.color, targets.light, delta)
    if (ring.current) ease(ring.current.color, targets.perimeter, delta)
  })

  return (
    <>
      <ambientLight ref={ambient} color={initial.light} intensity={0.7} />
      <directionalLight ref={sun} color={initial.light} position={[3, 6, 4]} intensity={2.2} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh>
          <circleGeometry args={[3.2, 96]} />
          <meshStandardMaterial color="#1a2430" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, 0.005]}>
          <ringGeometry args={[3.14, 3.2, 96]} />
          <meshBasicMaterial ref={ring} color={initial.perimeter} />
        </mesh>
      </group>
    </>
  )
}

export interface OutpostTwinProps {
  // What the scene shows, from toScene(state).
  scene: SceneProps
}

// The Outpost in 3D: the Status grades the whole scene, the Enclosure turns red as gas rises.
export function OutpostTwin({ scene }: OutpostTwinProps) {
  return (
    <div className="twin-scene" role="img" aria-label="3D view of the Outpost">
      <Canvas camera={{ position: [4.2, 3.2, 5.4], fov: 40 }}>
        <Grade {...scene.status} />
        <Enclosure {...scene.enclosure} />
      </Canvas>
    </div>
  )
}
