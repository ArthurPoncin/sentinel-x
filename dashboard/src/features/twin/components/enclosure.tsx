import { useFrame } from '@react-three/fiber'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  type BufferGeometry,
  Color,
  CylinderGeometry,
  type Group,
  MathUtils,
  type Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type PointLight,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useColorFade, useFade } from '../hooks/use-fade'
import { usePan } from '../hooks/use-pan'
import { useSweep } from '../hooks/use-sweep'
import { ARC_REACH, ARCS, arcsAt, blink } from '../utils/alarm'
import { breath } from '../utils/breathing'
import { EASE, ease } from '../utils/easing'
import { ENCLOSURE_PARTS, ENCLOSURE_SHAPE, ENGRAVING } from '../utils/enclosure-parts'
import { domeFlash } from '../utils/presence'
import { pulse } from '../utils/pulse'
import { DRIFT_COLOR, type DriftingProbe, GAS_COLOR, PRESENCE_COLOR, type SceneProps } from '../utils/scene'
import { Antenna, type AntennaProps } from './antenna'
import { LabelCard, useCanvasTexture } from './label-card'

// The Enclosure stands on a mast at an exaggerated scale, to stay readable from the back of the room.
const SCALE = ENCLOSURE_SHAPE.scale
const MAST_HEIGHT = 1.15
const BODY = { width: 1.4, height: 1, depth: 0.9 } as const
// The Probe compartment (0.34 high, 0.02 under the body) sits right on the mast.
const BODY_Y = MAST_HEIGHT + 0.36 + BODY.height / 2
const FRONT = BODY.depth / 2
const TOP = BODY.height / 2

const ANODIZED = { color: '#232a33', metalness: 0.55, roughness: 0.38 } as const
const TRIM = { color: '#14181d', metalness: 0.4, roughness: 0.5 } as const

// The mast is a lattice pylon, square in plan: four uprights that lean in from `foot` to `top`, half its
// width at either end, held every bay by a ring of rails and a cross of braces on each face.
const LATTICE = { foot: 0.15, top: 0.1, bays: 5, upright: 0.016, brace: 0.009, sides: 6 } as const
const UP = new Vector3(0, 1, 0)

// A bar of the lattice, from one point to another.
function bar(from: Vector3, to: Vector3, radius: number): BufferGeometry {
  const along = to.clone().sub(from)
  const length = along.length()

  return new CylinderGeometry(radius, radius, length, LATTICE.sides)
    .applyQuaternion(new Quaternion().setFromUnitVectors(UP, along.divideScalar(length)))
    .translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
}

// The whole lattice as one shape, from the ground up to the Probe compartment.
function latticeMast(): BufferGeometry {
  const { foot, top, bays, upright, brace } = LATTICE
  // The four corners of the pylon at each level, the ground first.
  const levels = Array.from({ length: bays + 1 }, (_, level) => {
    const half = MathUtils.lerp(foot, top, level / bays)
    const y = (MAST_HEIGHT * level) / bays
    return [
      new Vector3(half, y, half),
      new Vector3(-half, y, half),
      new Vector3(-half, y, -half),
      new Vector3(half, y, -half),
    ]
  })
  const corner = (level: number, at: number) => levels[level]?.[at % 4] ?? new Vector3()
  const faces = [0, 1, 2, 3]
  const bars = [
    ...faces.map((at) => bar(corner(0, at), corner(bays, at), upright)),
    ...levels.flatMap((_, level) => faces.map((at) => bar(corner(level, at), corner(level, at + 1), brace))),
    ...levels.slice(1).flatMap((_, level) =>
      faces.flatMap((at) => [
        bar(corner(level, at), corner(level + 1, at + 1), brace),
        bar(corner(level, at + 1), corner(level + 1, at), brace),
      ]),
    ),
  ]
  const all = mergeGeometries(bars)
  for (const one of bars) one.dispose()

  return all
}

// The LCD band: the Status in white on black, tinted by an unlit material whose color fades to the
// Status's, with the light of the scene. The text switches like a real LCD's; its color fades.
function Lcd({ text, color }: SceneProps['enclosure']['lcd']) {
  const material = useRef<MeshBasicMaterial>(null)
  const colorNow = useColorFade(color)
  const [initial] = useState(color)
  const screen = useCanvasTexture(512, 128, (context) => {
    context.fillStyle = '#050607'
    context.fillRect(0, 0, 512, 128)
    context.fillStyle = 'rgba(255, 255, 255, 0.5)'
    context.font = '600 22px ui-monospace, Menlo, Consolas, monospace'
    context.fillText('STATUS', 28, 40)
    context.fillStyle = '#ffffff'
    context.font = '700 62px ui-monospace, Menlo, Consolas, monospace'
    context.fillText(text, 26, 104)
  })

  useFrame(() => {
    material.current?.color.fromArray(colorNow())
  })

  return (
    <group position={[0, 0.2, FRONT]}>
      {/* Bezel */}
      <mesh position={[0, 0, 0.005]} castShadow>
        <boxGeometry args={[1.08, 0.33, 0.03]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh name={ENCLOSURE_PARTS.lcd} position={[0, 0, 0.022]}>
        <planeGeometry args={[1, 0.25]} />
        {/* Unlit: the screen emits its own light, and the halo takes it for one. */}
        <meshBasicMaterial ref={material} map={screen} color={initial} toneMapped={false} />
      </mesh>
    </group>
  )
}

// The engraving on the right side: maker, model, serial number, lighter than the anodized metal.
function Engraving() {
  const label = useCanvasTexture(512, 320, (context) => {
    context.fillStyle = '#b4bec8'
    context.font = '500 46px system-ui, sans-serif'
    context.fillText(ENGRAVING.maker, 24, 70)
    context.font = '800 78px system-ui, sans-serif'
    context.fillText(ENGRAVING.model, 20, 175, 472)
    context.font = '500 34px ui-monospace, Menlo, Consolas, monospace'
    context.fillText(ENGRAVING.serial, 24, 262)
    context.fillRect(24, 290, 464, 3)
  })

  return (
    <mesh position={[BODY.width / 2 + 0.002, -0.02, 0]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[0.8, 0.5]} />
      <meshStandardMaterial map={label} transparent metalness={0.3} roughness={0.55} />
    </mesh>
  )
}

// The camera, out of the front beside the PIR dome: a plate on the body, an arm, the servo that turns it, and
// on it a housing with its lens barrel and its glass, the eye the vision service sees through. It turns about
// its own axis, where the site plan carries the lens, to whom it follows: by `pan` radians from where it
// rests, toward the right of its image when positive. Its axis is clear of the front: the field it sees goes
// down in front of the body, not through it. The head casts no shadow: the shadows are drawn once, and it moves.
const CAMERA = { servo: 0.06, housing: 0.085, length: 0.2, joint: 0.04, arm: 0.03 } as const

function Camera({ pan }: Pick<EnclosureProps, 'pan'>) {
  const head = useRef<Group>(null)
  const panNow = usePan(pan)
  const { lens } = ENCLOSURE_SHAPE
  // How far its axis is out of the front, and how far under it the arm runs.
  const reach = lens.z - FRONT
  const under = CAMERA.housing + CAMERA.joint + CAMERA.arm / 2

  useFrame((_, delta) => {
    // Its right is toward smaller bearings: the other way round from a turn about y.
    if (head.current) head.current.rotation.y = -panNow(delta)
  })

  return (
    <group position={[lens.x, lens.y - BODY_Y, lens.z]}>
      <mesh position={[0, -under, -reach + 0.01]} castShadow>
        <boxGeometry args={[0.16, 0.12, 0.02]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh position={[0, -under, (CAMERA.servo - reach) / 2]} castShadow>
        <boxGeometry args={[0.07, CAMERA.arm, reach + CAMERA.servo]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh position={[0, -CAMERA.housing - CAMERA.joint / 2, 0]} castShadow>
        <cylinderGeometry args={[CAMERA.servo * 0.8, CAMERA.servo, CAMERA.joint, 32]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <group ref={head} name={ENCLOSURE_PARTS.camera}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[CAMERA.housing, CAMERA.housing, CAMERA.length, 40]} />
          <meshStandardMaterial color="#4a5562" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, CAMERA.length / 2 + 0.006]}>
          <cylinderGeometry args={[CAMERA.housing * 0.7, CAMERA.housing * 0.7, 0.012, 40]} />
          <meshStandardMaterial color="#13304f" metalness={0.6} roughness={0.12} />
        </mesh>
        <mesh position={[0, 0, CAMERA.length / 2 + 0.001]}>
          <ringGeometry args={[CAMERA.housing * 0.62, CAMERA.housing * 0.84, 40]} />
          <meshStandardMaterial color="#aab5c0" metalness={0.9} roughness={0.2} />
        </mesh>
      </group>
    </group>
  )
}

// How bright the PIR dome emits at the top of a flash.
const PIR_GLOW = 3

// The PIR's faceted white dome. While someone is near the site it blinks in the presence's amber, in time
// with the sweep of the fence: it starts with the first sweep and goes dark as the last one ends.
function PirDome({ presence }: Pick<EnclosureProps, 'presence'>) {
  const dome = useRef<MeshStandardMaterial>(null)
  const lapNow = useSweep(presence)

  useFrame(() => {
    const lap = lapNow()
    if (dome.current) dome.current.emissiveIntensity = lap === null ? 0 : PIR_GLOW * domeFlash(lap)
  })

  return (
    <group position={[0.02, -0.19, FRONT]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.012]}>
        <cylinderGeometry args={[0.125, 0.125, 0.024, 32]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh name={ENCLOSURE_PARTS.pir} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.024]} castShadow>
        <sphereGeometry args={[0.105, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          ref={dome}
          color="#e9e6de"
          roughness={0.55}
          flatShading
          emissive={PRESENCE_COLOR}
          emissiveIntensity={0}
        />
      </mesh>
    </group>
  )
}

// The sound sensor's grille: a round plate drilled in rings.
function MicGrille() {
  const holes = useCanvasTexture(128, 128, (context) => {
    context.fillStyle = '#7d8893'
    context.beginPath()
    context.arc(64, 64, 64, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#05070a'
    for (const [radius, count] of [
      [0, 1],
      [18, 8],
      [34, 14],
      [50, 20],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2
        context.beginPath()
        context.arc(64 + radius * Math.cos(angle), 64 + radius * Math.sin(angle), 5, 0, Math.PI * 2)
        context.fill()
      }
    }
  })

  return (
    <mesh name={ENCLOSURE_PARTS.mic} position={[0.4, -0.19, FRONT + 0.004]}>
      <circleGeometry args={[0.085, 40]} />
      <meshStandardMaterial map={holes} metalness={0.6} roughness={0.45} />
    </mesh>
  )
}

// How bright a pulsing Probe emits at the top of a beat.
const PULSE_GLOW = 3
// What every material of a Probe carries to pulse with: the drift's color, dark until it does.
const DRIFT = { emissive: DRIFT_COLOR, emissiveIntensity: 0 } as const

interface ProbeProps {
  part: DriftingProbe
  pulsing: boolean
  position: [x: number, y: number, z: number]
  children: ReactNode
}

// A Probe in its compartment, under its name in the scene. While the predictive model says it drifts, the
// whole of it emits the drift's color in beats, and the halo takes it for a light. The pulse comes and goes
// in a fade.
function Probe({ part, pulsing, position, children }: ProbeProps) {
  const parts = useRef<Group>(null)
  const pulsingNow = useFade([pulsing ? 1 : 0])

  useFrame(({ clock }) => {
    const glow = PULSE_GLOW * (pulsingNow()[0] ?? 0) * pulse(clock.elapsedTime)
    parts.current?.traverse((object) => {
      const material = (object as Mesh).material
      if (material instanceof MeshStandardMaterial) material.emissiveIntensity = glow
    })
  })

  return (
    <group ref={parts} name={ENCLOSURE_PARTS[part]} position={position}>
      {children}
    </group>
  )
}

// The drift label's size on the Enclosure at scale 1: wider than the compartment it hangs under, to be read
// from the back of the room.
const LABEL_WIDTH = 1.5
// How far under the compartment's floor the label hangs, at scale 1, so it hides neither Probe.
const LABEL_DROP = 0.2

// Under the drifting Probes, what the predictive model says of them: « dérive · score 0.91 », on a card
// edged in the drift's orange, drawn over the mast and the body. It comes and goes in a fade, and keeps its
// last text while it fades out.
function DriftLabel({ drift, below }: Pick<SceneProps['enclosure'], 'drift'> & { below: number }) {
  const shownNow = useFade([drift ? 1 : 0])

  return (
    <LabelCard
      text={drift?.label ?? null}
      color={DRIFT_COLOR}
      width={LABEL_WIDTH}
      position={[0, below - LABEL_DROP, 0.05]}
      shown={() => shownNow()[0] ?? 0}
    />
  )
}

// Under the body, the ventilated compartment that keeps the Probes away from the electronics' heat:
// louvres front and back, the DHT22 and the MQ-2 visible between them. Those of `pulses` pulse, and the
// label of the drift hangs under them.
function ProbeCompartment({ pulses, drift }: Pick<SceneProps['enclosure'], 'pulses' | 'drift'>) {
  const height = 0.34
  const louvres = [-0.11, -0.04, 0.03, 0.1]

  return (
    <group position={[0, -BODY.height / 2 - height / 2 - 0.02, 0]}>
      {/* Floor, roof and the two side cheeks */}
      {[-height / 2, height / 2].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.1, 0.03, 0.7]} />
          <meshStandardMaterial {...ANODIZED} />
        </mesh>
      ))}
      {[-0.535, 0.535].map((x) => (
        <mesh key={x} position={[x, 0, 0]} castShadow>
          <boxGeometry args={[0.03, height, 0.7]} />
          <meshStandardMaterial {...ANODIZED} />
        </mesh>
      ))}
      {/* Louvres: tilted slats, front and back */}
      {[0.35, -0.35].flatMap((z) =>
        louvres.map((y) => (
          <mesh key={`${z}${y}`} position={[0, y, z]} rotation={[z > 0 ? -0.6 : 0.6, 0, 0]} castShadow>
            <boxGeometry args={[1.06, 0.012, 0.06]} />
            <meshStandardMaterial {...TRIM} />
          </mesh>
        )),
      )}
      {/* DHT22: the white perforated case */}
      <Probe part="dht22" pulsing={pulses.includes('dht22')} position={[-0.22, -0.02, 0.05]}>
        <mesh castShadow>
          <boxGeometry args={[0.15, 0.22, 0.07]} />
          <meshStandardMaterial color="#f1efe8" roughness={0.6} {...DRIFT} />
        </mesh>
        {[-0.05, -0.01, 0.03, 0.07].map((y) => (
          <mesh key={y} position={[0, y, 0.036]}>
            <boxGeometry args={[0.1, 0.012, 0.002]} />
            <meshStandardMaterial color="#9c9a93" {...DRIFT} />
          </mesh>
        ))}
      </Probe>
      {/* MQ-2: the steel mesh can on its blue board */}
      <Probe part="mq2" pulsing={pulses.includes('mq2')} position={[0.22, -0.06, 0.05]}>
        <mesh position={[0, -0.05, 0]} castShadow>
          <boxGeometry args={[0.2, 0.012, 0.16]} />
          <meshStandardMaterial color="#1f4fa8" roughness={0.6} {...DRIFT} />
        </mesh>
        <mesh position={[0, 0.02, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.13, 32]} />
          <meshStandardMaterial color="#b9c0c6" metalness={0.85} roughness={0.35} {...DRIFT} />
        </mesh>
      </Probe>
      <DriftLabel drift={drift} below={-height / 2} />
    </group>
  )
}

// How bright the LED ring is at the top of a breath, and at the top of a flash of the Alarm.
const RING_GLOW = { breath: 2.2, flash: 4 } as const
// How wide the line of an arc of sound is, at the Enclosure's scale 1, and how bright: enough for a halo.
const ARC_LINE = 0.016
const ARC_GLOW = 1.8

const SOUND_VERTEX = /* glsl */ `
  varying vec2 vAt;

  void main() {
    vAt = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SOUND_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float level;
  // Each arc's radius and opacity.
  uniform vec2 arcs[${ARCS}];
  varying vec2 vAt;

  void main() {
    float away = length(vAt);
    // An arc over the buzzer, not a ring around it: the line dies out as it comes down on either side.
    float over = smoothstep(0.1, 0.6, vAt.y / max(away, 0.0001));
    float edge = fwidth(away);
    float line = 0.0;
    for (int arc = 0; arc < ${ARCS}; arc++) {
      float off = abs(away - arcs[arc].x);
      line += arcs[arc].y * (1.0 - smoothstep(${ARC_LINE / 2} - edge, ${ARC_LINE / 2} + edge, off));
    }
    gl_FragColor = vec4(color * ${ARC_GLOW.toFixed(1)}, min(line, 1.0) * over * level);
  }
`

// The buzzer's sound, drawn: thin arcs that leave it one a beat and die out as they rise, on a sheet that
// stands on the buzzer. Unlit: they show whatever the light, and the halo takes them for a light.
function createSound() {
  const uniforms = {
    color: { value: new Color() },
    level: { value: 0 },
    arcs: { value: Array.from({ length: ARCS }, () => new Vector2()) },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: SOUND_VERTEX,
    fragmentShader: SOUND_FRAGMENT,
    transparent: true,
    depthWrite: false,
  })
  // Standing on its lower edge, the buzzer under the middle of it.
  const height = ARC_REACH + ARC_LINE
  const sheet = new PlaneGeometry(2 * height, height).translate(0, height / 2, 0)

  return { uniforms, material, sheet }
}

// On top: the buzzer, and the LED ring around it. At rest the ring breathes in the Status's color. While the
// Alarm is on it blinks in the Alarm's, and the buzzer sounds on the same beat. One fades into the other.
function Crown({ ring, alarm }: Pick<SceneProps['enclosure'], 'ring' | 'alarm'>) {
  const led = useRef<MeshStandardMaterial>(null)
  const waves = useRef<Mesh>(null)
  const color = alarm?.color ?? ring.color
  const colorNow = useColorFade(color)
  // How much of the Alarm shows, 0–1.
  const alarmNow = useFade([alarm ? 1 : 0])
  const [initial] = useState(color)
  const sound = useMemo(createSound, [])
  const toCamera = useMemo(() => new Vector3(), [])
  useEffect(
    () => () => {
      sound.material.dispose()
      sound.sheet.dispose()
    },
    [sound],
  )

  useFrame(({ clock, camera }) => {
    const shown = colorNow()
    const alarmed = alarmNow()[0] ?? 0
    const seconds = clock.elapsedTime
    if (led.current) {
      led.current.emissive.fromArray(shown)
      led.current.emissiveIntensity = MathUtils.lerp(
        RING_GLOW.breath * breath(seconds),
        RING_GLOW.flash * blink(seconds),
        alarmed,
      )
    }
    if (!waves.current?.parent) return
    // Nothing to draw while the buzzer is silent.
    waves.current.visible = alarmed > 0.004
    if (!waves.current.visible) return
    // The sheet turns on the buzzer to face whoever looks, wherever the camera is on its orbit.
    waves.current.parent.worldToLocal(toCamera.copy(camera.position))
    waves.current.rotation.y = Math.atan2(toCamera.x, toCamera.z)
    sound.uniforms.color.value.fromArray(shown)
    sound.uniforms.level.value = alarmed
    arcsAt(seconds).forEach(({ radius, opacity }, arc) => {
      sound.uniforms.arcs.value[arc]?.set(radius, opacity)
    })
  })

  return (
    <group position={[0, TOP, 0]}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.32, 0.04, 48]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh name={ENCLOSURE_PARTS.ledRing} position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.24, 0.022, 16, 64]} />
        <meshStandardMaterial ref={led} color="#0c0d0f" emissive={initial} emissiveIntensity={RING_GLOW.breath} />
      </mesh>
      <group name={ENCLOSURE_PARTS.buzzer} position={[0, 0.08, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.13, 0.13, 0.08, 40]} />
          <meshStandardMaterial color="#0d0f12" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.041, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.025, 24]} />
          <meshStandardMaterial color="#000000" roughness={1} />
        </mesh>
        {/* Its sound, from its top up. */}
        <mesh
          ref={waves}
          position={[0, 0.045, 0]}
          geometry={sound.sheet}
          material={sound.material}
          visible={false}
        />
      </group>
    </group>
  )
}

export type EnclosureProps = SceneProps['enclosure'] & {
  // Whether someone is near the site: a `presence` Alert is active.
  presence: boolean
  // How far the camera on its roof is turned from where it rests, in radians.
  pan: number
  // Its link to the Command Post: the frames it carries, whether it is up, whether it is encrypted.
  link: Pick<AntennaProps, 'frames' | 'live' | 'encrypted'>
}

// The Sentinel-X product: a dark bevelled module on a mast, its Probes and actuators each a part of its
// own (ENCLOSURE_PARTS). The body turns red and glows as gas rises; the LCD shows the Status and the
// LED ring breathes in its color, until the Alarm makes it blink and the buzzer sound; the Probes the
// predictive model says are drifting pulse, their score on a label under them; the PIR dome blinks while
// someone is near; the antenna on its side sends an impulse of light for each frame of telemetry
// received, a padlock by it while the feed is encrypted.
export function Enclosure({ color, glow, lcd, ring, alarm, pulses, drift, presence, pan, link }: EnclosureProps) {
  const body = useRef<MeshStandardMaterial>(null)
  const light = useRef<PointLight>(null)
  const target = useMemo(() => new Color(color), [color])
  // Set once: a color prop would be reapplied on every change and jump past the easing.
  const [initial] = useState(color)
  const shown = useRef(glow)
  const shell = useMemo(() => new RoundedBoxGeometry(BODY.width, BODY.height, BODY.depth, 4, 0.09), [])
  useEffect(() => () => shell.dispose(), [shell])
  const mast = useMemo(latticeMast, [])
  useEffect(() => () => mast.dispose(), [mast])

  useFrame((_, delta) => {
    shown.current = MathUtils.damp(shown.current, glow, EASE, delta)
    if (body.current) {
      ease(body.current.color, target, delta)
      body.current.emissiveIntensity = shown.current * 0.6
    }
    if (light.current) light.current.intensity = shown.current * 8
  })

  return (
    <group scale={SCALE}>
      {/* Foot and mast: the lattice stands still, so its shadow is drawn once with the others. */}
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, ENCLOSURE_SHAPE.foot, 0.06, 48]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh geometry={mast} castShadow receiveShadow>
        <meshStandardMaterial color="#3a424c" metalness={0.7} roughness={0.35} />
      </mesh>

      <group position={[0, BODY_Y, 0]}>
        <mesh geometry={shell} castShadow receiveShadow>
          <meshStandardMaterial
            ref={body}
            color={initial}
            metalness={ANODIZED.metalness}
            roughness={ANODIZED.roughness}
            emissive={GAS_COLOR}
            emissiveIntensity={0}
          />
        </mesh>
        <Lcd {...lcd} />
        <Camera pan={pan} />
        <PirDome presence={presence} />
        <MicGrille />
        <Engraving />
        <ProbeCompartment pulses={pulses} drift={drift} />
        <Crown ring={ring} alarm={alarm} />
        {/* On the right side, behind the engraving: its tip stands just over the roof. */}
        <Antenna {...link} position={[BODY.width / 2 + 0.1, -0.4, -0.39]} />
        {/* What the gas throws on the ground around the Enclosure: from inside the body, it lights what
            is around without burning its own faces. */}
        <pointLight ref={light} color={GAS_COLOR} intensity={0} distance={7} />
      </group>
    </group>
  )
}
