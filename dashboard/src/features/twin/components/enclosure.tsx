import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CanvasTexture,
  Color,
  MathUtils,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
  SRGBColorSpace,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { breath } from '../utils/breathing'
import { EASE, ease } from '../utils/easing'
import { ENCLOSURE_PARTS, ENGRAVING } from '../utils/enclosure-parts'
import { GAS_COLOR, type SceneProps } from '../utils/scene'

// The Enclosure stands on a mast at an exaggerated scale, to stay readable from the back of the room.
const SCALE = 1.25
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

// The LCD band: the Status in white on black, tinted by an unlit material whose color eases toward the
// Status's. The text switches like a real LCD's; its color fades.
function Lcd({ text, color }: SceneProps['enclosure']['lcd']) {
  const material = useRef<MeshBasicMaterial>(null)
  const target = useMemo(() => new Color(color), [color])
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

  useFrame((_, delta) => {
    if (material.current) ease(material.current.color, target, delta)
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
    <group name={ENCLOSURE_PARTS.camera} position={[-0.38, -0.17, FRONT]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.05]} castShadow>
        <cylinderGeometry args={[0.14, 0.15, 0.1, 48]} />
        <meshStandardMaterial color="#4a5562" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.1]}>
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

// The PIR's faceted white dome.
function PirDome() {
  return (
    <group position={[0.02, -0.19, FRONT]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.012]}>
        <cylinderGeometry args={[0.125, 0.125, 0.024, 32]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh name={ENCLOSURE_PARTS.pir} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.024]} castShadow>
        <sphereGeometry args={[0.105, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#e9e6de" roughness={0.55} flatShading />
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

// Under the body, the ventilated compartment that keeps the Probes away from the electronics' heat:
// louvres front and back, the DHT22 and the MQ-2 visible between them.
function ProbeCompartment() {
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
      <group name={ENCLOSURE_PARTS.dht22} position={[-0.22, -0.02, 0.05]}>
        <mesh castShadow>
          <boxGeometry args={[0.15, 0.22, 0.07]} />
          <meshStandardMaterial color="#f1efe8" roughness={0.6} />
        </mesh>
        {[-0.05, -0.01, 0.03, 0.07].map((y) => (
          <mesh key={y} position={[0, y, 0.036]}>
            <boxGeometry args={[0.1, 0.012, 0.002]} />
            <meshStandardMaterial color="#9c9a93" />
          </mesh>
        ))}
      </group>
      {/* MQ-2: the steel mesh can on its blue board */}
      <group name={ENCLOSURE_PARTS.mq2} position={[0.22, -0.06, 0.05]}>
        <mesh position={[0, -0.05, 0]} castShadow>
          <boxGeometry args={[0.2, 0.012, 0.16]} />
          <meshStandardMaterial color="#1f4fa8" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.02, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.13, 32]} />
          <meshStandardMaterial color="#b9c0c6" metalness={0.85} roughness={0.35} />
        </mesh>
      </group>
    </group>
  )
}

// On top: the buzzer, and the LED ring around it that breathes in the Status's color.
function Crown({ color }: SceneProps['enclosure']['ring']) {
  const ring = useRef<MeshStandardMaterial>(null)
  const target = useMemo(() => new Color(color), [color])
  const [initial] = useState(color)

  useFrame(({ clock }, delta) => {
    if (!ring.current) return
    ease(ring.current.emissive, target, delta)
    ring.current.emissiveIntensity = 2.2 * breath(clock.elapsedTime)
  })

  return (
    <group position={[0, TOP, 0]}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.32, 0.04, 48]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh name={ENCLOSURE_PARTS.ledRing} position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.24, 0.022, 16, 64]} />
        <meshStandardMaterial ref={ring} color="#0c0d0f" emissive={initial} emissiveIntensity={2.2} />
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
      </group>
    </group>
  )
}

// The Sentinel-X product: a dark bevelled module on a mast, its Probes and actuators each a part of its
// own (ENCLOSURE_PARTS). The body turns red and glows as gas rises; the LCD shows the Status and the
// LED ring breathes in its color.
export function Enclosure({ color, glow, lcd, ring }: SceneProps['enclosure']) {
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
        <cylinderGeometry args={[0.42, 0.48, 0.06, 48]} />
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
        <PirDome />
        <MicGrille />
        <Engraving />
        <ProbeCompartment />
        <Crown {...ring} />
        {/* What the gas throws on the ground around the Enclosure: from inside the body, it lights what
            is around without burning its own faces. */}
        <pointLight ref={light} color={GAS_COLOR} intensity={0} distance={7} />
      </group>
    </group>
  )
}
