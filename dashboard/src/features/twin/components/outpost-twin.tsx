import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import {
  type AmbientLight,
  type DirectionalLight,
  HalfFloatType,
  type MeshBasicMaterial,
  NeutralToneMapping,
  type SpotLight,
} from 'three'
import { useColorFade } from '../hooks/use-fade'
import { usePixelRatio } from '../hooks/use-pixel-ratio'
import { FIELD_OF_VIEW } from '../utils/framing'
import type { SceneProps, StatusGrade } from '../utils/scene'
import { Enclosure } from './enclosure'
import { Halo } from './halo'
import { OrbitCamera } from './orbit-camera'

// The studio the Outpost stands in, and the Status's color grade over it: every light, the perimeter ring.
// A new Status fades in, from whatever is on screen when it comes. The lights stay put while the camera
// orbits, so the shadows do not sweep across the ground.
function Grade({ light, rim, perimeter }: StatusGrade) {
  // Set once, then faded toward the Status's: a color prop would jump past the fade.
  const [initial] = useState({ light, rim, perimeter })
  const key = useRef<SpotLight>(null)
  const back = useRef<DirectionalLight>(null)
  const fill = useRef<AmbientLight>(null)
  const ring = useRef<MeshBasicMaterial>(null)
  const lightNow = useColorFade(light)
  const rimNow = useColorFade(rim)
  const perimeterNow = useColorFade(perimeter)

  useFrame(() => {
    const lit = lightNow()
    key.current?.color.fromArray(lit)
    fill.current?.color.fromArray(lit)
    back.current?.color.fromArray(rimNow())
    ring.current?.color.fromArray(perimeterNow())
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
      {/* Rim light: low and from behind, it draws the edges out of the black. Cold until a Status colors it. */}
      <directionalLight ref={back} color={initial.rim} position={[-5, 2.2, -4.5]} intensity={2.4} />
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
  // Keeps the whole stage in frame whatever the shape of the window, a vertical one included: the camera
  // stands back as far as that takes, and no longer zooms.
  wholeStage?: boolean
}

// The Outpost in 3D, lit like a product in a studio on a black background: the Status grades the light and
// the perimeter ring, the Enclosure turns red as gas rises, shows the Status on its LCD and breathes it on
// its LED ring. Without its signal it all turns grey and says so: what it shows is no longer live. It fills
// its parent: give that the size the Twin should have on screen.
export function OutpostTwin({ scene, wholeStage = false }: OutpostTwinProps) {
  const frame = useRef<HTMLDivElement>(null)
  const dpr = usePixelRatio(frame)

  return (
    <div ref={frame} className="twin-scene">
      <Canvas
        role="img"
        aria-label="3D view of the Outpost"
        shadows="percentage"
        dpr={dpr}
        camera={{ position: [4.2, 3.2, 5.4], fov: FIELD_OF_VIEW }}
        // HDR buffer: the halo is added before tone mapping. Neutral keeps the Status colors as they are.
        gl={{ outputBufferType: HalfFloatType, toneMapping: NeutralToneMapping }}
      >
        <color attach="background" args={['#000000']} />
        <Grade {...scene.status} />
        <Enclosure {...scene.enclosure} />
        <OrbitCamera wholeStage={wholeStage} />
        <Halo saturation={scene.signalLost ? 0 : 1} />
      </Canvas>
      {/* Next to the image, not in it: a screen reader skips what an image holds. */}
      <p className="twin-signal" role="status" data-lost={scene.signalLost}>
        Signal lost
      </p>
    </div>
  )
}
