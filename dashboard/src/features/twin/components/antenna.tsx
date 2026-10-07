import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import {
  AdditiveBlending,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type Sprite,
  type SpriteMaterial,
} from 'three'
import type { Frame } from '@/shared/contract'
import { useFade } from '../hooks/use-fade'
import { useImpulses } from '../hooks/use-impulses'
import { ENCLOSURE_PARTS } from '../utils/enclosure-parts'
import { MAX_IMPULSES } from '../utils/link'
import { LINK_COLOR } from '../utils/scene'
import { useCanvasTexture } from './label-card'

// The antenna, at the Enclosure's scale 1: an arm out of the body's side, `reach` long, a joint on its end and
// a whip up from it to its tip, `height` over the arm.
const ANTENNA = { reach: 0.2, arm: 0.04, joint: 0.07, height: 0.95, tip: 0.022 } as const
const STEEL = { color: '#3a424c', metalness: 0.7, roughness: 0.35 } as const
const TRIM = { color: '#14181d', metalness: 0.4, roughness: 0.5 } as const
// How bright an impulse emits at its brightest, and the tip it leaves: enough for a halo.
const IMPULSE_GLOW = 2.4
const TIP_GLOW = 3
// How thick the line of an impulse's ring is, as a share of its radius.
const RING_LINE = 0.16
const SLOTS = Array.from({ length: MAX_IMPULSES }, (_, slot) => slot)

// The card the padlock and « WSS » are drawn on, in pixels, and how wide it is by the antenna at scale 1.
const CARD = { width: 320, height: 128, wide: 0.42 } as const
const WORD = 'WSS'

// A closed padlock, `size` tall, its middle at (`x`, `y`): a body and the shackle over it.
function drawPadlock(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const body = { width: size * 0.78, height: size * 0.56 }
  const top = y + size / 2 - body.height
  const shackle = size * 0.24
  context.lineWidth = size * 0.13
  context.lineCap = 'butt'
  context.beginPath()
  context.moveTo(x - shackle, top + 2)
  context.lineTo(x - shackle, top - size * 0.14)
  context.arc(x, top - size * 0.14, shackle, Math.PI, 0)
  context.lineTo(x + shackle, top + 2)
  context.stroke()
  context.beginPath()
  context.roundRect(x - body.width / 2, top, body.width, body.height, size * 0.08)
  context.fill()
}

// By the antenna, what says the link is encrypted: a padlock and « WSS » on a dark card edged in the link's
// white. A sprite, like a label's card: it faces the camera wherever the orbit takes it, hangs under the
// antenna's foot and is drawn over whatever stands in front of it. It comes and goes in a fade.
function LinkLock({ encrypted }: Pick<AntennaProps, 'encrypted'>) {
  const sprite = useRef<Sprite>(null)
  const material = useRef<SpriteMaterial>(null)
  const shownNow = useFade([encrypted ? 1 : 0])
  const card = useCanvasTexture(CARD.width, CARD.height, (context) => {
    const { width, height } = CARD
    const left = 6
    const inset = 6
    context.beginPath()
    context.roundRect(left, inset, width - left - inset, height - 2 * inset, (height - 2 * inset) / 2)
    context.fillStyle = 'rgba(8, 10, 13, 0.86)'
    context.fill()
    context.lineWidth = 5
    context.strokeStyle = LINK_COLOR
    context.stroke()
    context.fillStyle = LINK_COLOR
    drawPadlock(context, left + 62, height / 2 + 2, 66)
    context.font = '700 58px ui-monospace, Menlo, Consolas, monospace'
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.fillText(WORD, left + 112, height / 2 + 2)
  })

  useFrame(() => {
    const level = shownNow()[0] ?? 0
    if (material.current) material.current.opacity = level
    // Nothing to draw once it has faded out.
    if (sprite.current) sprite.current.visible = level > 0.004
  })

  return (
    <sprite
      ref={sprite}
      // Under the arm, clear of the LCD and of the engraving whichever side it is seen from.
      position={[0, -0.05, 0]}
      center={[0.5, 1]}
      scale={[CARD.wide, (CARD.wide * CARD.height) / CARD.width, 1]}
      renderOrder={10}
      visible={false}
    >
      <spriteMaterial ref={material} map={card} transparent opacity={0} depthTest={false} toneMapped={false} />
    </sprite>
  )
}

export interface AntennaProps {
  // The feed's frames, oldest first: telemetry among those that come in sends an impulse.
  frames: readonly Frame[]
  // Whether the link is up: no impulse leaves while the signal is lost.
  live: boolean
  // Whether the live feed is encrypted, WSS: the padlock shows by the antenna.
  encrypted: boolean
  // Where the foot of its whip is, off the Enclosure's right side: its arm comes out of the body to there.
  position: readonly [x: number, y: number, z: number]
}

// The Enclosure's wireless link, seen: an antenna on its side, whose tip stands just over the roof, and a
// ring of white light that leaves that tip for each frame of telemetry received, rises and fades out. It is
// hung on the side, not stood on the roof: the camera frames the Enclosure with little room above it, and
// an impulse has to rise within the frame. The antenna stands still and casts its shadow
// with the others, drawn once; the impulses are light added over the frame, unlit: the halo takes them for
// lights, and they cast none. Nothing of them is drawn between two frames of telemetry.
export function Antenna({ frames, live, encrypted, position }: AntennaProps) {
  const tip = useRef<MeshStandardMaterial>(null)
  const rings = useRef<(Mesh | null)[]>([])
  const impulsesNow = useImpulses(frames, live)

  useFrame(() => {
    const impulses = impulsesNow()
    // The tip lights as an impulse leaves it, and goes dark as that one fades.
    if (tip.current) tip.current.emissiveIntensity = TIP_GLOW * Math.max(0, ...impulses.map(({ glow }) => glow))
    rings.current.forEach((ring, slot) => {
      if (!ring) return
      const impulse = impulses[slot]
      ring.visible = impulse !== undefined && impulse.glow > 0.004
      if (!impulse || !ring.visible) return
      ring.position.y = ANTENNA.height + impulse.height
      ring.scale.setScalar(impulse.radius)
      ;(ring.material as MeshBasicMaterial).color.set(LINK_COLOR).multiplyScalar(IMPULSE_GLOW * impulse.glow)
    })
  })

  return (
    <group name={ENCLOSURE_PARTS.antenna} position={position}>
      <mesh position={[-ANTENNA.reach / 2, 0, 0]} castShadow>
        <boxGeometry args={[ANTENNA.reach, ANTENNA.arm, ANTENNA.arm * 1.4]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh position={[0, ANTENNA.joint / 2 - ANTENNA.arm / 2, 0]} castShadow>
        <cylinderGeometry args={[0.026, 0.03, ANTENNA.joint, 20]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[0, ANTENNA.height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.011, 0.017, ANTENNA.height, 12]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[0, ANTENNA.height, 0]}>
        <sphereGeometry args={[ANTENNA.tip, 16, 12]} />
        <meshStandardMaterial ref={tip} {...STEEL} emissive={LINK_COLOR} emissiveIntensity={0} />
      </mesh>
      {SLOTS.map((slot) => (
        <mesh
          key={slot}
          ref={(ring) => {
            rings.current[slot] = ring
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={2}
          visible={false}
        >
          <torusGeometry args={[1, RING_LINE, 8, 40]} />
          <meshBasicMaterial
            color="#000000"
            transparent
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      <LinkLock encrypted={encrypted} />
    </group>
  )
}
