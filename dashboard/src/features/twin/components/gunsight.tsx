import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  type Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Mesh,
  MeshBasicMaterial,
  Object3D,
  type PerspectiveCamera,
  Quaternion,
  type Sprite,
  type SpriteMaterial,
  Vector3,
} from 'three'
import { figureHeight } from '../utils/figure'
import { HAND_COLORS, HOLOGRAM, hologramAnchor, hologramPoint, type OperatorHands, type Point } from '../utils/operator-hands'
import { type Card, CALM_CARD, cardFor, type Intel, pointedAt } from '../utils/pointing'
import { INTRUSION_COLOR } from '../utils/scene'
import { BURST, burstMote, landsAt, type Range, SHOT, type Triple } from '../utils/shooting'
import { useCanvasTexture } from './label-card'

// The sight: a ring with four ticks, `depth` in front of the camera, and how much smaller it closes once the
// thumb is drawn back.
const SIGHT = { depth: 2, radius: 0.034, line: 0.003, tick: 0.014, dot: 0.004, cocked: 0.62 } as const
// How bright the sight, the trace of a shot and what it leaves emit, for the halo to take them for lights.
const GLOW = { sight: 2.2, onSpot: 4, trace: 5, burst: 4 } as const
// The share of the way to how it should look that the sight goes in a second.
const SIGHT_PULL = 14
// How thin the trace of a shot is, in scene units.
const TRACE = 0.006
// How far around a figurine's axis the motes it comes apart in start.
const FIGURE_WIDE = 0.07
// The card by the sight, in pixels, how wide it is in scene units at the sight's depth, and how far off the
// sight's middle it starts.
const CARD = { width: 640, height: 300, wide: 0.6, off: 0.07 } as const
// The share of the way to shown, or to gone, that the card goes in a second.
const CARD_PULL = 10
// Past this far to the right of the view, the card is on the sight's left; past this far down it stands on the
// sight's level, and past it up it hangs from it: it stays whole on screen.
const CARD_FLIPS = 0.3
const CARD_LIFTS = 0.45
const UP = new Vector3(0, 1, 0)
// As the hologram leans: the shot leaves from the tip of its index.
const LEAN = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), HOLOGRAM.lean)

const additive = () => new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false })

// What the sight is on, in words: a title and a few lines on a dark card edged in the color of what it tells.
// A sprite by the sight, on the side `side` says (across 1: its right; up 1: above its level, -1: below),
// drawn over everything. It keeps its last
// words while it fades out.
function SightCard({ card, side }: { card: Card | null; side: () => { across: 1 | -1; up: 1 | 0 | -1 } }) {
  const sprite = useRef<Sprite>(null)
  const material = useRef<SpriteMaterial>(null)
  const level = useRef(0)
  const [written, setWritten] = useState(card)
  if (card !== null && card !== written) setWritten(card)

  const texture = useCanvasTexture(CARD.width, CARD.height, (context) => {
    if (!written) return
    const { width, height } = CARD
    const inset = 6
    context.beginPath()
    context.roundRect(inset, inset, width - 2 * inset, height - 2 * inset, 22)
    context.fillStyle = 'rgba(8, 10, 13, 0.88)'
    context.fill()
    context.lineWidth = 4
    context.strokeStyle = written.color
    context.stroke()
    context.textBaseline = 'middle'
    context.fillStyle = written.color
    context.font = '700 34px ui-monospace, Menlo, Consolas, monospace'
    context.fillText(written.title, 34, 52, width - 68)
    context.fillRect(34, 84, width - 68, 2)
    context.fillStyle = '#e8eef5'
    context.font = '500 31px ui-monospace, Menlo, Consolas, monospace'
    written.lines.slice(0, 4).forEach((line, index) => context.fillText(line, 34, 126 + index * 46, width - 68))
  })

  useFrame((_, delta) => {
    level.current += ((card ? 1 : 0) - level.current) * (1 - Math.exp(-CARD_PULL * delta))
    if (material.current) material.current.opacity = level.current
    if (!sprite.current) return
    sprite.current.visible = level.current > 0.004
    const { across, up } = side()
    sprite.current.center.set(across === 1 ? 0 : 1, 0.5 - up / 2)
    sprite.current.position.setX(across * CARD.off)
  })

  return (
    <sprite ref={sprite} scale={[CARD.wide, (CARD.wide * CARD.height) / CARD.width, 1]} renderOrder={12} visible={false}>
      <spriteMaterial ref={material} map={texture} transparent opacity={0} depthTest={false} toneMapped={false} />
    </sprite>
  )
}

// An extra, and no signal: with a finger pointed over the sensor the Operator has a sight over the Twin, which
// follows the tip of their index, closes as their thumb is drawn back and turns to the intrusion's red over an
// intruder. A card by the sight says what it is on: what the vision model tells of an intruder, what its Probe
// reads of the gas tank or of the generator hall, how the Enclosure and its link are (`intel`). The thumb brought down fires: a trace of light from the hologram's index to where the sight was,
// and motes of light where it ends. An intruder's figurine that is hit comes apart in them, and `range` is told
// so: whoever draws it leaves it out for a few seconds. Nothing of it is there without a hand that aims.
export function Gunsight({ operator, range, intel }: { operator: OperatorHands; range: Range; intel: Intel }) {
  const sight = useRef<Group>(null)
  const trace = useRef<Mesh>(null)
  // The last shot shown, by its time: undefined until the first frame, so that one fired before is not.
  const shown = useRef<number | null | undefined>(undefined)
  // What the last shot left, and for how many seconds: where its trace ends and its motes start.
  const fired = useRef<{ age: number; from: Vector3; to: Vector3; at: Vector3; tall: number; wide: number; motes: number } | null>(null)
  const closed = useRef(1)
  // The card of what the sight is on, where it stands, and the side of the sight it is on.
  const [card, setCard] = useState<Card | null>(null)
  const told = useRef('')
  const plate = useRef<Group>(null)
  const side = useRef<{ across: 1 | -1; up: 1 | 0 | -1 }>({ across: 1, up: 0 })

  const parts = useMemo(() => {
    const line = additive()
    const beam = additive()
    const motes = new InstancedMesh(new IcosahedronGeometry(1, 0), additive(), BURST.motes)
    motes.count = 0
    motes.renderOrder = 11
    motes.frustumCulled = false
    // A rod along y, one unit long from its foot: the trace is it stretched from the index to where it ends.
    const rod = new CylinderGeometry(TRACE, TRACE, 1, 6, 1, true).translate(0, 0.5, 0)
    return { line, beam, motes, rod }
  }, [])
  useEffect(
    () => () => {
      parts.line.dispose()
      parts.beam.dispose()
      parts.rod.dispose()
      parts.motes.geometry.dispose()
      ;(parts.motes.material as MeshBasicMaterial).dispose()
      parts.motes.dispose()
    },
    [parts],
  )
  const scratch = useMemo(
    () => ({ way: new Vector3(), along: new Vector3(), mote: new Object3D(), tint: new Color(), lit: new Color(HAND_COLORS.idle) }),
    [],
  )

  useFrame(({ camera }, delta) => {
    const { way, along, mote, tint, lit } = scratch
    const eye = camera.position.toArray() as [number, number, number]
    // The way a sight at (x, y) in the view looks from the eye, and what it is then on, if anything.
    const sighted = (x: number, y: number) => {
      const direction = way.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize().toArray() as Triple
      return { direction, on: pointedAt(eye, direction, range.standing) }
    }
    // Says what the sight is on, when it is no longer what the card reads.
    const tell = (next: Card | null) => {
      const words = next ? [next.title, next.color, ...next.lines].join('\n') : ''
      if (words === told.current) return
      told.current = words
      setCard(next)
    }

    const aim = operator.aim()
    if (sight.current) sight.current.visible = aim !== null
    if (aim && sight.current) {
      const { direction, on } = sighted(aim.x, aim.y)
      sight.current.position.set(...direction).multiplyScalar(SIGHT.depth).add(camera.position)
      sight.current.quaternion.copy(camera.quaternion)
      plate.current?.position.copy(sight.current.position)
      plate.current?.quaternion.copy(camera.quaternion)
      side.current = { across: aim.x > CARD_FLIPS ? -1 : 1, up: aim.y < -CARD_LIFTS ? 1 : aim.y > CARD_LIFTS ? -1 : 0 }
      tell(cardFor(on, intel))
      const pull = 1 - Math.exp(-SIGHT_PULL * delta)
      closed.current += ((aim.cocked ? SIGHT.cocked : 1) - closed.current) * pull
      sight.current.scale.setScalar(closed.current)
      lit.lerp(tint.set(on?.kind === 'person' ? INTRUSION_COLOR : on ? CALM_CARD : HAND_COLORS.idle), pull)
      parts.line.color.copy(lit).multiplyScalar(on?.kind === 'spot' ? GLOW.onSpot : GLOW.sight)
    } else {
      tell(null)
    }

    const shot = operator.shot()
    if (shown.current === undefined) shown.current = shot?.at ?? null
    if (shot && shot.at !== shown.current) {
      shown.current = shot.at
      const { direction, on } = sighted(shot.x, shot.y)
      const hit = on?.kind === 'person' ? { id: on.person.id, x: on.person.at.x, z: on.person.at.z } : null
      const to = hit ? new Vector3(hit.x, figureHeight() / 2, hit.z) : new Vector3(...landsAt(eye, direction))
      fired.current = {
        age: 0,
        from: muzzle(shot.from, camera as PerspectiveCamera),
        to,
        at: hit ? new Vector3(hit.x, 0, hit.z) : to,
        tall: hit ? figureHeight() : 0,
        wide: hit ? FIGURE_WIDE : 0,
        motes: hit ? BURST.motes : BURST.sparks,
      }
      if (hit) range.struck.set(hit.id, 0)
      const color = tint.set(hit ? INTRUSION_COLOR : HAND_COLORS.idle)
      parts.beam.color.copy(color).multiplyScalar(GLOW.trace)
      ;(parts.motes.material as MeshBasicMaterial).color.copy(color).multiplyScalar(GLOW.burst)
    }

    const last = fired.current
    if (trace.current) trace.current.visible = last !== null && last.age < SHOT.trace
    if (!last) return
    if (trace.current?.visible) {
      along.subVectors(last.to, last.from)
      const length = along.length()
      trace.current.position.copy(last.from)
      trace.current.quaternion.setFromUnitVectors(UP, along.divideScalar(length || 1))
      trace.current.scale.set(1, length, 1)
      parts.beam.opacity = 1 - last.age / SHOT.trace
    }
    for (let index = 0; index < last.motes; index++) {
      const { x, y, z, size } = burstMote(index, last.age, last.tall, last.wide)
      mote.position.set(last.at.x + x, last.at.y + y, last.at.z + z)
      mote.scale.setScalar(size / 2)
      mote.updateMatrix()
      parts.motes.setMatrixAt(index, mote.matrix)
    }
    parts.motes.count = last.motes
    parts.motes.instanceMatrix.needsUpdate = true
    last.age += delta
    if (last.age >= BURST.seconds) {
      fired.current = null
      parts.motes.count = 0
    }
  })

  return (
    <>
      <group ref={sight} visible={false} renderOrder={11}>
        <mesh material={parts.line} renderOrder={11}>
          <ringGeometry args={[SIGHT.radius - SIGHT.line, SIGHT.radius, 48]} />
        </mesh>
        <mesh material={parts.line} renderOrder={11}>
          <circleGeometry args={[SIGHT.dot, 16]} />
        </mesh>
        {[0, 1, 2, 3].map((quarter) => (
          <mesh
            key={quarter}
            material={parts.line}
            renderOrder={11}
            rotation={[0, 0, (quarter * Math.PI) / 2]}
            position={[
              Math.cos((quarter * Math.PI) / 2) * (SIGHT.radius + SIGHT.tick / 2),
              Math.sin((quarter * Math.PI) / 2) * (SIGHT.radius + SIGHT.tick / 2),
              0,
            ]}
          >
            <planeGeometry args={[SIGHT.tick, SIGHT.line]} />
          </mesh>
        ))}
      </group>
      <group ref={plate}>
        <SightCard card={card} side={() => side.current} />
      </group>
      <mesh ref={trace} geometry={parts.rod} material={parts.beam} visible={false} renderOrder={11} frustumCulled={false} />
      <primitive object={parts.motes} />
    </>
  )
}

// Where the tip of the index the sensor sees at `tip` is in the scene: on the hologram, which rides with the
// camera in a corner of its view.
function muzzle(tip: Point, camera: PerspectiveCamera): Vector3 {
  const anchor = new Vector3(...hologramAnchor(camera.fov, camera.aspect)).applyQuaternion(camera.quaternion).add(camera.position)
  return new Vector3(...hologramPoint(tip)).applyQuaternion(LEAN).applyQuaternion(camera.quaternion).add(anchor)
}
