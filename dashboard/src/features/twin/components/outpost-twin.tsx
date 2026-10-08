import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { useStatusLight } from '../hooks/use-status-light'
import { FIELD_OF_VIEW } from '../utils/framing'
import type { OperatorHands } from '../utils/operator-hands'
import type { SceneProps, StatusGrade } from '../utils/scene'
import { createRange } from '../utils/shooting'
import { SITE } from '../utils/site'
import { Dust } from './dust'
import { Enclosure } from './enclosure'
import { Floodlights } from './floodlights'
import { Gunsight } from './gunsight'
import { Halo } from './halo'
import { HandHologram } from './hand-hologram'
import { Haze } from './haze'
import { Intruder } from './intruder'
import { NoiseWaves } from './noise-waves'
import { OrbitCamera } from './orbit-camera'
import { Perimeter } from './perimeter'
import { PowerPlant } from './power-plant'
import { Renewables } from './renewables'
import { Rocks } from './rocks'
import { Signage } from './signage'
import { Socle } from './socle'

// The studio the Outpost stands in, and the Status's color grade over it. The rim light and the ring around the
// socle are in the Status's color for as long as it lasts. The key light and the fill are neutral, so the
// signals stand out of the scene: a Status that rises floods them in its color for a moment, then leaves them
// a slight tint. A new Status fades in, from whatever is on screen when it comes. The lights stay put while
// the camera orbits, so the shadows do not sweep across the ground.
function Grade({ level, light, rim, perimeter }: StatusGrade) {
  // Set once, then faded toward the Status's: a color prop would jump past the fade.
  const [initial] = useState({ light, rim, perimeter })
  const key = useRef<SpotLight>(null)
  const back = useRef<DirectionalLight>(null)
  const fill = useRef<AmbientLight>(null)
  const ring = useRef<MeshBasicMaterial>(null)
  const lightNow = useStatusLight(level, light)
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
      {/* Rim light: low and from behind, it draws the edges out of the black. Cold until a Status colors it,
          and in that color for as long as the Status lasts. */}
      <directionalLight ref={back} color={initial.rim} position={[-5, 2.2, -4.5]} intensity={2.4} />
      {/* Just enough fill for the faces neither light reaches. */}
      <ambientLight ref={fill} color={initial.light} intensity={0.06} />
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[SITE.socle.radius - SITE.socle.ring, SITE.socle.radius, 128]} />
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
  // socle, an Alert raised for the first time turns the camera to its anchor, and telemetry sends an impulse
  // from the Enclosure's antenna. Those already there as the Twin opens are past: none is replayed.
  frames: readonly Frame[]
  // Keeps the whole stage in frame whatever the shape of the window, a vertical one included: the camera
  // stands back as far as that takes, and no longer zooms.
  wholeStage?: boolean
  // The Operator's hands over a hand sensor, when the hand control is on: a flat hand steers the camera, two
  // open ones zoom, and the Twin shows the hands in hologram in a corner of its view.
  operator?: OperatorHands
}

// The Outpost in 3D: a maquette of the site on its socle, lit like a product in a studio on a black
// background. The Status colors the rim light and the ring around the socle, and floods the whole model in its
// color for a moment as it rises; the Enclosure, at the site's entrance, turns red as gas rises, shows the
// Status on its LCD and breathes it on its LED ring. A haze thickens around the gas pipe with the gas, and the
// Enclosure sounds the Alarm while a `gas` or `thermal` Alert is active. The generator hall's roof glows red
// with the heat, and the air ripples above it. The plant is an eco-responsible one, which no signal drives: a
// solar field, a wind turbine whose blades turn slowly, a battery container by the transformer station. Nor
// does a signal drive the signage the site carries: no-entry
// signs on each side of the gate, the danger zone around the gas tank, its name on the hall. Nor does what
// says where it stands, a remote place left to itself: rocks between the fence and the socle's rim, a track
// from the gate to the hall's door which stops at the rim outside, a few motes of dust adrift in the wind. No
// vehicle and no one: the only human the Twin shows is the intruder.
// The camera's field is a faint volume from the Enclosure's lens down to its sector on the ground: an intrusion
// lights it, sector included, and stands the intruder on its arc, a human figurine in
// hologram tied to the lens, which walks to where `x_norm` places it, in the brackets of its detection and
// under the vision model's confidence, and leaves its outline for a few seconds where it was last seen once
// the Alert is cleared; a predictive drift pulses the Probes it names, its score on a label; a presence blinks the Enclosure's
// PIR dome and sends an amber sweep round the fence; either one, someone near the site or inside it, lights the
// floodlights on the perimeter in white, each a pool on the ground at its foot; a clap sends a wave of light from the Enclosure over the socle.
// The antenna on the Enclosure's side sends an impulse of white light for each frame of telemetry received,
// and a padlock reads « WSS » by it while the live feed is encrypted.
// The camera orbits the site, and turns to an Alert as it is raised: it faces where it happens for a few
// seconds, then orbits again. Without its signal it all turns grey, the picture drops out like a screen's
// (snow, tears, a rolling bar) and it says so: what it shows is no longer live. With a hand sensor, the Operator's
// hands float in hologram in a corner of the view, a flat one steers the camera and two open ones, moved apart or
// together, zoom. It fills its parent: give that
// the size the Twin should have on screen.
export function OutpostTwin({ scene, frames, wholeStage = false, operator }: OutpostTwinProps) {
  const frame = useRef<HTMLDivElement>(null)
  const dpr = usePixelRatio(frame)
  // What the sight of a hand that aims and the intruder's figurines tell each other.
  const range = useMemo(createRange, [])

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
        <Renewables />
        <Signage />
        <Rocks />
        <Dust />
        <Haze density={scene.haze} />
        <NoiseWaves frames={frames} />
        <Perimeter sectorLit={scene.sector.lit} pan={scene.camera.pan} presence={scene.presence.active} />
        <Floodlights {...scene.floodlights} />
        <Intruder intruder={scene.intruder} range={range} />
        {/* Where the site plan stands it, turned the way its lens looks. */}
        <group position={[SITE.enclosure.x, 0, SITE.enclosure.z]} rotation={[0, SITE.enclosure.heading, 0]}>
          <Enclosure
            {...scene.enclosure}
            presence={scene.presence.active}
            aim={scene.camera.aim}
            link={{ frames, live: !scene.signalLost, encrypted: scene.link.encrypted }}
          />
        </group>
        <OrbitCamera anchor={scene.anchor} frames={frames} wholeStage={wholeStage} operator={operator} />
        {operator && <HandHologram operator={operator} />}
        {operator && <Gunsight operator={operator} range={range} intel={scene} />}
        <Halo signal={scene.signalLost ? 0 : 1} />
      </Canvas>
      {/* Next to the image, not in it: a screen reader skips what an image holds. */}
      <p className="twin-signal" role="status" data-lost={scene.signalLost}>
        Signal lost
      </p>
    </div>
  )
}
