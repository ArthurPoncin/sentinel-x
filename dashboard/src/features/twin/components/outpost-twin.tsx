import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { type AmbientLight, Color, HalfFloatType, type MeshBasicMaterial, NeutralToneMapping, type SpotLight } from 'three'
import { usePixelRatio } from '../hooks/use-pixel-ratio'
import { ease } from '../utils/easing'
import type { SceneProps, StatusGrade } from '../utils/scene'
import { Enclosure } from './enclosure'
import { Halo } from './halo'
import { OrbitCamera } from './orbit-camera'

// The studio the Outpost stands in, and the Status's color grade over it: the light, the perimeter ring.
// The lights stay put while the camera orbits, so the shadows do not sweep across the ground.
function Grade({ light, perimeter }: StatusGrade) {
  // Set once, then eased toward the Status's: a color prop would jump past the easing.
  const [initial] = useState({ light, perimeter })
  const key = useRef<SpotLight>(null)
  const fill = useRef<AmbientLight>(null)
  const ring = useRef<MeshBasicMaterial>(null)
  const targets = useMemo(
    () => ({ light: new Color(light), perimeter: new Color(perimeter) }),
    [light, perimeter],
  )

  useFrame((_, delta) => {
    if (key.current) ease(key.current.color, targets.light, delta)
    if (fill.current) ease(fill.current.color, targets.light, delta)
    if (ring.current) ease(ring.current.color, targets.perimeter, delta)
  })

  return (
    <>
      {/* Key light: from the front and above, the only one that casts shadows. */}
      <spotLight
        ref={key}
        color={initial.light}
        position={[4.5, 7.5, 3.5]}
        angle={0.62}
        penumbra={1}
        decay={0}
        intensity={3}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-radius={5}
        shadow-bias={-0.0004}
      />
      {/* Rim light: cold, low and from behind, it draws the edges out of the black. */}
      <directionalLight position={[-5, 2.2, -4.5]} intensity={2.4} color="#9dbcff" />
      {/* Just enough fill for the faces neither light reaches. */}
      <ambientLight ref={fill} color={initial.light} intensity={0.06} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh receiveShadow>
          <circleGeometry args={[3.2, 96]} />
          <meshStandardMaterial color="#1a2430" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, 0.005]}>
          <ringGeometry args={[3.14, 3.2, 96]} />
          {/* Unlit: it shows the Status whatever the light, and the halo takes it for a light of its own. */}
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

// The Outpost in 3D, lit like a product in a studio on a black background: the Status grades the light and
// the perimeter ring, the Enclosure turns red as gas rises, shows the Status on its LCD and breathes it on
// its LED ring. It fills its parent: give that the size the Twin should have on screen.
export function OutpostTwin({ scene }: OutpostTwinProps) {
  const frame = useRef<HTMLDivElement>(null)
  const dpr = usePixelRatio(frame)

  return (
    <div ref={frame} className="twin-scene" role="img" aria-label="3D view of the Outpost">
      <Canvas
        shadows="percentage"
        dpr={dpr}
        camera={{ position: [4.2, 3.2, 5.4], fov: 40 }}
        // HDR buffer: the halo is added before tone mapping. Neutral keeps the Status colors as they are.
        gl={{ outputBufferType: HalfFloatType, toneMapping: NeutralToneMapping }}
      >
        <color attach="background" args={['#000000']} />
        <Grade {...scene.status} />
        <Enclosure {...scene.enclosure} />
        <OrbitCamera />
        <Halo />
      </Canvas>
    </div>
  )
}
