import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import {
  type AmbientLight,
  type DirectionalLight,
  HalfFloatType,
  type MeshBasicMaterial,
  NeutralToneMapping,
  type SpotLight,
} from 'three'
import type { Frame } from '@/shared/contract'
import { useColorFade } from '../hooks/use-fade'
import { usePixelRatio } from '../hooks/use-pixel-ratio'
import { FIELD_OF_VIEW } from '../utils/framing'
import type { SceneProps, StatusGrade } from '../utils/scene'
import { SITE } from '../utils/site'
import { Enclosure } from './enclosure'
import { Halo } from './halo'
import { Haze } from './haze'
import { Intruder } from './intruder'
import { NoiseWaves } from './noise-waves'
import { OrbitCamera } from './orbit-camera'
import { Perimeter } from './perimeter'
import { PowerPlant } from './power-plant'
import { Socle } from './socle'

// The studio the Outpost stands in, and the Status's color grade over it: every light, the ring around the socle.
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
        // Fine enough for the maquette's small volumes: a wider blur shows its grain on the off-white walls.
        shadow-mapSize={[2048, 2048]}
        shadow-radius={3}
        shadow-bias={-0.0004}
      />
      {/* Rim light: low and from behind, it draws the edges out of the black. Cold until a Status colors it. */}
      <directionalLight ref={back} color={initial.rim} position={[-5, 2.2, -4.5]} intensity={2.4} />
      {/* Just enough fill for the faces neither light reaches. */}
      <ambientLight ref={fill} color={initial.light} intensity={0.06} />
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[SITE.socle.radius - 0.06, SITE.socle.radius, 128]} />
        {/* Unlit: it shows the Status whatever the light, and the halo takes it for a light of its own. */}
        <meshBasicMaterial ref={ring} color={initial.perimeter} />
      </mesh>
    </>
  )
}

// Nothing that casts a shadow moves and the lights stay put: the shadows are drawn once, not on every
// frame. A slice that moves what casts one asks for them again with `gl.shadowMap.needsUpdate = true`.
function StillShadows() {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])

  return null
}

export interface OutpostTwinProps {
  // What the scene shows, from toScene(state).
  scene: SceneProps
  // The feed's frames, oldest first, as they come in: a `noise` Alert raised among them sends a wave over the
  // socle. Those already there as the Twin opens are past: none is replayed.
  frames: readonly Frame[]
  // Keeps the whole stage in frame whatever the shape of the window, a vertical one included: the camera
  // stands back as far as that takes, and no longer zooms.
  wholeStage?: boolean
}

// The Outpost in 3D: a maquette of the site on its socle, lit like a product in a studio on a black
// background. The Status grades the light and the ring around the socle; the Enclosure, at the site's
// entrance, turns red as gas rises, shows the Status on its LCD and breathes it on its LED ring. A haze
// thickens around the gas pipe with the gas, and the Enclosure sounds the Alarm while a `gas` or `thermal`
// Alert is active. The generator hall's roof glows red with the heat, and the air ripples above it. An
// intrusion lights the camera's sector on the ground and stands the intruder on its arc, where `x_norm` places
// it; a predictive drift pulses the Probes it names, its score on a label; a presence blinks the Enclosure's
// PIR dome and sends an amber sweep round the fence; a clap sends a wave of light from the Enclosure over the socle. Without its
// signal it all turns grey and says so: what it shows is no longer live. It fills its parent: give that the
// size the Twin should have on screen.
export function OutpostTwin({ scene, frames, wholeStage = false }: OutpostTwinProps) {
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
        <StillShadows />
        <Socle />
        <PowerPlant {...scene.thermal} />
        <Haze density={scene.haze} />
        <NoiseWaves frames={frames} />
        <Perimeter sectorLit={scene.sector.lit} presence={scene.presence.active} />
        <Intruder intruder={scene.intruder} />
        {/* Where the site plan stands it, turned the way its lens looks. */}
        <group position={[SITE.enclosure.x, 0, SITE.enclosure.z]} rotation={[0, SITE.enclosure.heading, 0]}>
          <Enclosure {...scene.enclosure} presence={scene.presence.active} />
        </group>
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
