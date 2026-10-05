import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Color, type Group, MathUtils, type MeshStandardMaterial, type PointLight } from 'three'
import { gasLevel } from '../utils/gas-level'

const CALM_COLOR = new Color('#8a99a8')
const GAS_COLOR = new Color('#ff4d4f')

function Enclosure({ level }: { level: number }) {
  const enclosure = useRef<Group>(null)
  const material = useRef<MeshStandardMaterial>(null)
  const glow = useRef<PointLight>(null)
  // The level on screen eases toward the Reading's: a snapshot a second fades in, it does not jump.
  const shown = useRef(level)

  useFrame((_, delta) => {
    shown.current = MathUtils.damp(shown.current, level, 4, delta)
    if (enclosure.current) enclosure.current.rotation.y += delta * 0.15
    if (material.current) {
      material.current.color.lerpColors(CALM_COLOR, GAS_COLOR, shown.current)
      material.current.emissiveIntensity = shown.current * 0.6
    }
    if (glow.current) glow.current.intensity = shown.current * 8
  })

  return (
    <group ref={enclosure}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[2, 0.16, 1.5]} />
        <meshStandardMaterial color="#233040" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.66, 0]}>
        <boxGeometry args={[1.6, 1, 1.1]} />
        <meshStandardMaterial ref={material} emissive={GAS_COLOR} emissiveIntensity={0} roughness={0.5} />
      </mesh>
      {/* What the gas throws on the ground around the Enclosure. */}
      <pointLight ref={glow} position={[0, 0.66, 0]} color={GAS_COLOR} intensity={0} distance={7} />
    </group>
  )
}

function Perimeter() {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <circleGeometry args={[3.2, 96]} />
        <meshStandardMaterial color="#1a2430" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.005]}>
        <ringGeometry args={[3.14, 3.2, 96]} />
        <meshBasicMaterial color="#3a4c60" />
      </mesh>
    </group>
  )
}

export interface OutpostTwinProps {
  // The latest gas Reading (`readings.air`), null before the first telemetry.
  air: number | null
}

// The Outpost in 3D: its Enclosure turns red as the gas Reading rises.
export function OutpostTwin({ air }: OutpostTwinProps) {
  return (
    <div className="twin-scene" role="img" aria-label="3D view of the Outpost">
      <Canvas camera={{ position: [4.2, 3.2, 5.4], fov: 40 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 6, 4]} intensity={2.2} />
        <Perimeter />
        <Enclosure level={gasLevel(air)} />
      </Canvas>
    </div>
  )
}
