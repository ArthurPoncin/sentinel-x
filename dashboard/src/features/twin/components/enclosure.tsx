import { useFrame } from '@react-three/fiber'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  CanvasTexture,
  Color,
  type Group,
  MathUtils,
  type Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type PointLight,
  ShaderMaterial,
  type Sprite,
  type SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { useColorFade, useFade } from '../hooks/use-fade'
import { useSweep } from '../hooks/use-sweep'
import { ARC_REACH, ARCS, arcsAt, blink } from '../utils/alarm'
import { breath } from '../utils/breathing'
import { EASE, ease } from '../utils/easing'
import { ENCLOSURE_PARTS, ENCLOSURE_SHAPE, ENGRAVING } from '../utils/enclosure-parts'
import { domeFlash } from '../utils/presence'
import { pulse } from '../utils/pulse'
import { DRIFT_COLOR, type DriftingProbe, GAS_COLOR, PRESENCE_COLOR, type SceneProps } from '../utils/scene'

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

// A texture drawn in code on a 2D canvas: the LCD's screen, the engraving, the mic grille.
function useCanvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const created = new CanvasTexture(canvas)
    created.colorSpace = SRGBColorSpace
    created.anisotropy = 8
    return created
  }, [width, height])

  useEffect(() => {
    const context = (texture.image as HTMLCanvasElement).getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    draw(context)
    texture.needsUpdate = true
  })

  useEffect(() => () => texture.dispose(), [texture])
  return texture
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

// The camera: a lens barrel and its glass, the eye the vision service sees through.
function CameraLens() {
  return (
    <group name={ENCLOSURE_PARTS.camera} position={[ENCLOSURE_SHAPE.lens.x, ENCLOSURE_SHAPE.lens.y - BODY_Y, FRONT]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.05]} castShadow>
        <cylinderGeometry args={[0.14, 0.15, 0.1, 48]} />
        <meshStandardMaterial color="#4a5562" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, ENCLOSURE_SHAPE.lens.z - FRONT]}>
        <cylinderGeometry args={[0.1, 0.1, 0.012, 48]} />
        <meshStandardMaterial color="#13304f" metalness={0.6} roughness={0.12} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.102]}>
        <ringGeometry args={[0.085, 0.115, 48]} />
        <meshStandardMaterial color="#aab5c0" metalness={0.9} roughness={0.2} />
      </mesh>
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

// The drift label's card, in pixels, and its size on the Enclosure at scale 1: wider than the compartment it
// hangs under, to be read from the back of the room.
const LABEL_CARD = { width: 640, height: 128 } as const
const LABEL_WIDTH = 1.5
// How far under the compartment's floor the label hangs, at scale 1, so it hides neither Probe.
const LABEL_DROP = 0.2

// Under the drifting Probes, what the predictive model says of them: « dérive · score 0.91 », on a dark card
// edged in the drift's orange. A sprite: it faces the camera wherever the orbit takes it, and is drawn over
// the mast and the body, so it reads from every side. It comes and goes in a fade, and keeps its last text
// while it fades out.
function DriftLabel({ drift, below }: Pick<SceneProps['enclosure'], 'drift'> & { below: number }) {
  const sprite = useRef<Sprite>(null)
  const material = useRef<SpriteMaterial>(null)
  const shownNow = useFade([drift ? 1 : 0])
  const [text, setText] = useState(drift?.label ?? '')
  if (drift && drift.label !== text) setText(drift.label)

  const card = useCanvasTexture(LABEL_CARD.width, LABEL_CARD.height, (context) => {
    const { width, height } = LABEL_CARD
    const inset = 6
    context.beginPath()
    context.roundRect(inset, inset, width - 2 * inset, height - 2 * inset, (height - 2 * inset) / 2)
    context.fillStyle = 'rgba(8, 10, 13, 0.86)'
    context.fill()
    context.lineWidth = 5
    context.strokeStyle = DRIFT_COLOR
    context.stroke()
    context.fillStyle = DRIFT_COLOR
    context.font = '700 58px ui-monospace, Menlo, Consolas, monospace'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, width / 2, height / 2 + 2, width - 80)
  })

  useFrame(() => {
    const shown = shownNow()[0] ?? 0
    if (material.current) material.current.opacity = shown
    // Nothing to draw once it has faded out.
    if (sprite.current) sprite.current.visible = shown > 0.004
  })

  return (
    <sprite
      ref={sprite}
      position={[0, below - LABEL_DROP, 0.05]}
      scale={[LABEL_WIDTH, (LABEL_WIDTH * LABEL_CARD.height) / LABEL_CARD.width, 1]}
      renderOrder={10}
      visible={false}
    >
      <spriteMaterial ref={material} map={card} transparent opacity={0} depthTest={false} toneMapped={false} />
    </sprite>
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
}

// The Sentinel-X product: a dark bevelled module on a mast, its Probes and actuators each a part of its
// own (ENCLOSURE_PARTS). The body turns red and glows as gas rises; the LCD shows the Status and the
// LED ring breathes in its color, until the Alarm makes it blink and the buzzer sound; the Probes the
// predictive model says are drifting pulse, their score on a label under them; the PIR dome blinks while
// someone is near.
export function Enclosure({ color, glow, lcd, ring, alarm, pulses, drift, presence }: EnclosureProps) {
  const body = useRef<MeshStandardMaterial>(null)
  const light = useRef<PointLight>(null)
  const target = useMemo(() => new Color(color), [color])
  // Set once: a color prop would be reapplied on every change and jump past the easing.
  const [initial] = useState(color)
  const shown = useRef(glow)
  const shell = useMemo(() => new RoundedBoxGeometry(BODY.width, BODY.height, BODY.depth, 4, 0.09), [])
  useEffect(() => () => shell.dispose(), [shell])

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
      {/* Foot and mast */}
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, ENCLOSURE_SHAPE.foot, 0.06, 48]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh position={[0, MAST_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[0.065, 0.08, MAST_HEIGHT, 24]} />
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
        <CameraLens />
        <PirDome presence={presence} />
        <MicGrille />
        <Engraving />
        <ProbeCompartment pulses={pulses} drift={drift} />
        <Crown ring={ring} alarm={alarm} />
        {/* What the gas throws on the ground around the Enclosure: from inside the body, it lights what
            is around without burning its own faces. */}
        <pointLight ref={light} color={GAS_COLOR} intensity={0} distance={7} />
      </group>
    </group>
  )
}
