import { useFrame } from '@react-three/fiber'
import { Fragment, memo, useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  type Group,
  type Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three'
import { useFade } from '../hooks/use-fade'
import { brackets, detectionFrame } from '../utils/detection'
import { fadeTo, fadeValue, settled } from '../utils/fade'
import {
  FIGURE,
  figureHeight,
  headBase,
  headHeight,
  hipHeight,
  type Segment,
  shoulderHeight,
  sweptTo,
  torsoSpan,
} from '../utils/figure'
import { INTRUSION_COLOR, type SceneProps } from '../utils/scene'
import { bearingAlongFence, bearingTo, lensHeight, lensPoint, watchedPoint } from '../utils/site'
import { type Track, trackAt } from '../utils/track'
import { type LimbPose, turnedTo, walkCycle, walkPhase } from '../utils/walk'
import { LabelCard } from './label-card'
import { boxShape, type Profile, turnedShape } from './volumes'

// How bright the ring at its feet emits, in the intrusion's red.
const GLOW = 4
// The ring at its feet, flat on the ground, which marks the very point of the arc it stands on.
const RING = { inner: 0.115, outer: 0.14 } as const
// The line from the lens to the figurine's head: how thin, how bright.
const LINE = { radius: 0.005, glow: 2.5 } as const
// The marker over its head, which tells it from afar: a pin of light, a thin stem from `clear` above the head
// up to a gem whose tip is at `top`, three fences high.
const MARKER = { clear: 0.04, top: 0.8, stem: 0.004, gem: { radius: 0.022, height: 0.07 }, glow: 4 } as const
// How far off its sides the figurine holds its arms, in radians.
const LEAN = 0.07
const TORSO_BEVEL = 0.022
// How far below its front the sweep that brings the figurine in still shows, as a band of light.
const BAND = 0.05
// How bright the brackets of the detection's frame emit.
const FRAME_GLOW = 4
// The label of the detection, over the marker: how wide its card is, and how far above the gem's tip, or the
// frame's top, it starts.
const LABEL = { width: 1.2, clear: 0.05 } as const
// The figurine is drawn in two goes, after the sector on the ground: its shade, then its light. The frame of
// its detection comes after everything that stands on the site, and under the labels.
const DRAWN = { shade: 3, light: 4, frame: 9 } as const

const HOLOGRAM_VERTEX = /* glsl */ `
  varying float vHeight;
  varying vec3 vOutward;
  varying vec3 vToEye;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vOutward = mat3(modelMatrix) * normal;
    vToEye = cameraPosition - world.xyz;
    vHeight = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const HOLOGRAM_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float level;
  uniform float swept;
  uniform float time;
  uniform float light;
  varying float vHeight;
  varying vec3 vOutward;
  varying vec3 vToEye;

  // The share of what stands behind it that its shade takes.
  const float SHADE = 0.8;
  // How bright its body emits, and how much more its edge does.
  const float BODY = 0.9;
  const float EDGE = 4.5;
  // Its scan lines: how far apart, how many go by in a second, and the share of its light they take.
  const float PITCH = 0.025;
  const float RISE = 1.5;
  const float LINES = 0.5;
  // How bright the front of its sweep is.
  const float FRONT = 6.0;

  void main() {
    // Nothing of it above where its sweep has got to.
    if (vHeight > swept) discard;

    // Brightest where its surface turns away from the eye: a lit edge all around it.
    float edge = pow(1.0 - abs(dot(normalize(vOutward), normalize(vToEye))), 2.0);
    // Lines closer than two pixels apart would shimmer: they fade into the light they take, evenly.
    float sharp = clamp(PITCH / fwidth(vHeight) / 2.0 - 1.0, 0.0, 1.0);
    float lines = 1.0 - 0.5 * LINES * (1.0 - sharp * sin(6.2832 * (vHeight / PITCH - time * RISE)));
    // A band of light just under the sweep's front, which leaves by the head.
    float front = smoothstep(swept - ${BAND}, swept, vHeight);

    // Its shade is black, as opaque as it takes; its light is added whole.
    vec3 glow = color * ((BODY + EDGE * edge) * lines + FRONT * front);
    gl_FragColor = mix(vec4(0.0, 0.0, 0.0, SHADE * level), vec4(glow * level, 1.0), light);
  }
`

// What a limb's segment is turned from: it hangs from its joint, where it is drawn from, and is rounded
// around it and around the next one.
function hanging({ length, radius: [top, bottom] }: Segment): Profile {
  return [
    [0, -length - bottom],
    [bottom * Math.SQRT1_2, -length - bottom * Math.SQRT1_2],
    [bottom, -length],
    [top, 0],
    [top * Math.SQRT1_2, top * Math.SQRT1_2],
    [0, top],
  ]
}

// What the head is turned from, standing on its base: an egg, wider above its middle.
function egg({ height, radius }: typeof FIGURE.head): Profile {
  return [
    [0, 0],
    [radius * 0.6, height * 0.07],
    [radius * 0.93, height * 0.3],
    [radius, height * 0.55],
    [radius * 0.82, height * 0.82],
    [radius * 0.45, height * 0.96],
    [0, height],
  ]
}

function createFigurine() {
  const uniforms = {
    color: { value: new Color(INTRUSION_COLOR) },
    level: { value: 0 },
    swept: { value: 0 },
    time: { value: 0 },
  }
  const hologram = { vertexShader: HOLOGRAM_VERTEX, fragmentShader: HOLOGRAM_FRAGMENT, transparent: true }
  // Its shade first, which dims what stands behind it: red on the red of the lit sector, its light alone would
  // not tell it apart. It leaves its depth too: of its volumes, only what is nearest the eye then takes the
  // light, so that an arm in front of the torso does not add up to twice as much.
  const shade = new ShaderMaterial({ ...hologram, uniforms: { ...uniforms, light: { value: 0 } } })
  const light = new ShaderMaterial({
    ...hologram,
    uniforms: { ...uniforms, light: { value: 1 } },
    blending: AdditiveBlending,
    depthWrite: false,
  })

  const { thigh, shin, torso, upperArm, forearm, head } = FIGURE
  const shapes = {
    head: turnedShape(egg(head)),
    torso: boxShape([torso.width, torso.height, torso.depth], TORSO_BEVEL),
    upperArm: turnedShape(hanging(upperArm)),
    forearm: turnedShape(hanging(forearm)),
    thigh: turnedShape(hanging(thigh)),
    shin: turnedShape(hanging(shin)),
  }
  // The marker: a stem standing over the head, and the gem it carries, an octahedron taller than it is wide.
  const pin = new MeshBasicMaterial({
    color: new Color(INTRUSION_COLOR).multiplyScalar(MARKER.glow),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const foot = figureHeight() + MARKER.clear
  const neck = MARKER.top - MARKER.gem.height
  const stem = new CylinderGeometry(MARKER.stem, MARKER.stem, neck - foot, 6, 1, true).translate(0, (neck + foot) / 2, 0)
  const gem = new OctahedronGeometry(MARKER.gem.radius)
    .scale(1, MARKER.gem.height / 2 / MARKER.gem.radius, 1)
    .translate(0, MARKER.top - MARKER.gem.height / 2, 0)
  // The line: a thin rod one unit long from its foot up, stretched and turned from the lens to the head.
  const rod = new CylinderGeometry(LINE.radius, LINE.radius, 1, 6, 1, true).translate(0, 0.5, 0)
  // The detection's frame: its four brackets, flat, around its own middle. What stands in front of the
  // figurine does not hide them: they are what the vision model draws over its image, not a thing on the site.
  const frame = new MeshBasicMaterial({
    color: new Color(INTRUSION_COLOR).multiplyScalar(FRAME_GLOW),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  })
  const corners = new ShapeGeometry(brackets().map((outline) => new Shape(outline.map(([x, y]) => new Vector2(x, y)))))

  return {
    uniforms,
    shade,
    light,
    shapes,
    pin,
    stem,
    gem,
    rod,
    frame,
    corners,
    dispose() {
      shade.dispose()
      light.dispose()
      pin.dispose()
      frame.dispose()
      for (const shape of [...Object.values(shapes), stem, gem, rod, corners]) shape.dispose()
    },
  }
}

type Figurine = ReturnType<typeof createFigurine>
type Triple = readonly [number, number, number]

// What a limb is posed by: the joint it hangs from, and the one its second segment hangs from the first by.
interface Joints {
  upper: Group | null
  lower: Group | null
}

// What the figurine is posed by: its body, which its hips carry, and its limbs, left then right.
interface Skeleton {
  body: Group | null
  arms: readonly [Joints, Joints]
  legs: readonly [Joints, Joints]
}

function createSkeleton(): Skeleton {
  const joints = (): Joints => ({ upper: null, lower: null })
  return { body: null, arms: [joints(), joints()], legs: [joints(), joints()] }
}

// Puts a limb in its pose: it swings forward from its joint, and its second segment folds on the first,
// `fold` 1 backward like a knee, -1 forward like an elbow.
function pose({ upper, lower }: Joints, { swing, bend }: LimbPose, fold: 1 | -1) {
  if (upper) upper.rotation.x = -swing
  if (lower) lower.rotation.x = fold * bend
}

// One of the figurine's volumes, at `at`: its shade, then its light.
function Volume({ drawn, shape, at }: { drawn: Figurine; shape: BufferGeometry; at?: Triple }) {
  return (
    <group position={at}>
      <mesh geometry={shape} material={drawn.shade} renderOrder={DRAWN.shade} />
      <mesh geometry={shape} material={drawn.light} renderOrder={DRAWN.light} />
    </group>
  )
}

interface LimbProps {
  drawn: Figurine
  // The joint it hangs from.
  at: Triple
  // Its two segments, and how long the first is: the second hangs from its end.
  upper: BufferGeometry
  lower: BufferGeometry
  length: number
  // How far it leans off the figurine's side, in radians.
  lean?: number
  // Its two joints, for whoever poses it.
  joints: Joints
}

// An arm or a leg: two segments, the second jointed to the first. It hangs straight until it is posed.
function Limb({ drawn, at, upper, lower, length, lean = 0, joints }: LimbProps) {
  return (
    <group
      ref={(joint) => {
        joints.upper = joint
      }}
      position={at}
      rotation={[0, 0, lean]}
    >
      <Volume drawn={drawn} shape={upper} />
      <group
        ref={(joint) => {
          joints.lower = joint
        }}
        position={[0, -length, 0]}
      >
        <Volume drawn={drawn} shape={lower} />
      </group>
    </group>
  )
}

// Its left, then its right: the side of its axis each is on, and its place among the limbs.
const SIDES = [
  { side: 1, limb: 0 },
  { side: -1, limb: 1 },
] as const

// The figurine's body, on the ground at its feet and looking down its own z: a head, a torso, two arms and two
// legs of two segments each, from the maquette's volumes. `skeleton` is what it is posed by.
function Body({ drawn, skeleton }: { drawn: Figurine; skeleton: Skeleton }) {
  const { hip, thigh, torso, shoulder, upperArm } = FIGURE
  const { shapes } = drawn

  return (
    <group
      ref={(body) => {
        skeleton.body = body
      }}
    >
      <Volume drawn={drawn} shape={shapes.head} at={[0, headBase(), 0]} />
      <Volume drawn={drawn} shape={shapes.torso} at={[0, torsoSpan().base + torso.height / 2, 0]} />
      {SIDES.map(({ side, limb }) => (
        <Fragment key={side}>
          <Limb
            drawn={drawn}
            at={[side * shoulder.x, shoulderHeight(), 0]}
            upper={shapes.upperArm}
            lower={shapes.forearm}
            length={upperArm.length}
            lean={side * LEAN}
            joints={skeleton.arms[limb]}
          />
          <Limb
            drawn={drawn}
            at={[side * hip.x, hipHeight(), 0]}
            upper={shapes.thigh}
            lower={shapes.shin}
            length={thigh.length}
            joints={skeleton.legs[limb]}
          />
        </Fragment>
      ))}
    </group>
  )
}

const UP = new Vector3(0, 1, 0)
// The figurine whole, and what it fades to once its Alert is cleared.
const WHOLE = settled([1])
const GONE = [0]

export interface IntruderProps {
  // The intruder of the active `intrusion` Alerts, or null: there is none.
  intruder: SceneProps['intruder']
}

// The intruder the camera sees: a human figurine in hologram, in the intrusion's red, standing on the arc of
// the fence the camera watches, where `x_norm` places it, and facing the Enclosure's lens. A pin of light
// over its head tells it from afar, a ring marks its feet, and a thin line ties its head to the lens: what the
// vision service sees, it sees through there. Four brackets frame it like a detection in an image, always
// facing the Twin's camera, and a label over the marker reads what the model sees and how sure it is of it,
// « PERSONNE · 88 % »: both are drawn over whatever stands in front of the figurine. As `x_norm` changes the
// figurine walks along the arc to its new place, arms and legs in opposition, turned the way it goes, the
// line, the brackets and the label following it; once there it comes back to rest and turns to the lens again.
// A newly raised intruder appears where it stands, at rest, in a sweep from its feet to its head; once the
// last `intrusion` Alert is cleared, it fades out where it last stood. Unlit and brighter than white, so the
// halo takes it all for lights. Nothing casts a shadow: the shadows are drawn once, and it moves.
export const Intruder = memo(function Intruder({ intruder }: IntruderProps) {
  const group = useRef<Group>(null)
  const standing = useRef<Group>(null)
  const frame = useRef<Group>(null)
  const label = useRef<Group>(null)
  const ring = useRef<MeshBasicMaterial>(null)
  const line = useRef<Mesh>(null)
  const lineMaterial = useRef<MeshBasicMaterial>(null)
  const track = useRef<Track | null>(null)
  const whole = useRef(WHOLE)
  const shownNow = useFade([intruder ? 1 : 0])
  const drawn = useMemo(createFigurine, [])
  useEffect(() => () => drawn.dispose(), [drawn])
  const skeleton = useMemo(createSkeleton, [])
  const red = useMemo(() => new Color(INTRUSION_COLOR).multiplyScalar(GLOW), [])
  const lineRed = useMemo(() => new Color(INTRUSION_COLOR).multiplyScalar(LINE.glow), [])
  const lens = useMemo(() => {
    const { x, z } = lensPoint()
    return new Vector3(x, lensHeight(), z)
  }, [])
  const toHead = useMemo(() => new Vector3(), [])
  const framed = useMemo(detectionFrame, [])
  const cameraUp = useMemo(() => new Vector3(), [])

  useFrame(({ clock, camera }, delta) => {
    track.current = trackAt(track.current, intruder && { alertId: intruder.alertId, x_norm: intruder.x_norm }, delta)
    const tracked = track.current
    const level = shownNow()[0] ?? 0
    // While its Alert is active the figurine is whole, its sweep brings it in: it only fades out.
    const now = clock.elapsedTime
    const active = tracked !== null && tracked.alertId !== null
    whole.current = active ? WHOLE : fadeTo(whole.current, GONE, now)
    const figurine = fadeValue(whole.current, now)[0] ?? 0
    const shown = active || (tracked !== null && (level > 0 || figurine > 0))
    if (group.current) group.current.visible = shown
    if (!shown || !tracked) return

    const at = watchedPoint(tracked.x_norm)
    standing.current?.position.set(at.x, 0, at.z)
    // It faces the lens at rest and the way it goes in full stride, and turns from one to the other as it gets
    // into its stride and out of it. Its walk cycle goes by the ground it has covered.
    const stride = Math.abs(tracked.walking)
    const toLens = bearingTo(at, lens)
    const facing = stride === 0 ? toLens : turnedTo(toLens, bearingAlongFence(at, tracked.walking), stride)
    const walk = walkCycle(walkPhase(tracked.walked), stride)
    skeleton.body?.position.setY(-walk.drop)
    skeleton.body?.rotation.set(0, facing, 0)
    for (const { limb } of SIDES) {
      pose(skeleton.legs[limb], walk.legs[limb], 1)
      pose(skeleton.arms[limb], walk.arms[limb], -1)
    }
    drawn.uniforms.level.value = figurine
    // Past the top of its head, so that the band of light leaves it.
    drawn.uniforms.swept.value = sweptTo(tracked.age) * (figureHeight() + BAND)
    drawn.uniforms.time.value = now
    if (ring.current) ring.current.opacity = level
    drawn.pin.opacity = level
    if (lineMaterial.current) lineMaterial.current.opacity = level
    // The brackets stand around the figurine's middle and face the camera, wherever it orbits. The label stands
    // over the marker's gem as the camera sees it, and never lower than the top of the frame: from above, the
    // marker looks short.
    frame.current?.position.set(at.x, framed.middle, at.z)
    frame.current?.quaternion.copy(camera.quaternion)
    const upright = cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).y
    label.current?.position.setY(Math.max(framed.height / 2, (MARKER.top - framed.middle) * upright) + LABEL.clear)
    drawn.frame.opacity = level

    const rod = line.current
    if (!rod) return
    toHead.set(at.x, headHeight() - walk.drop, at.z).sub(lens)
    rod.scale.set(1, toHead.length(), 1)
    rod.quaternion.setFromUnitVectors(UP, toHead.normalize())
  })

  return (
    <group ref={group} visible={false}>
      <group ref={standing}>
        <Body drawn={drawn} skeleton={skeleton} />
        <mesh geometry={drawn.stem} material={drawn.pin} />
        <mesh geometry={drawn.gem} material={drawn.pin} />
        {/* On the arc itself, just above the camera's sector so it does not flicker into it. */}
        <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[RING.inner, RING.outer, 48]} />
          <meshBasicMaterial ref={ring} color={red} transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <group ref={frame}>
        <mesh geometry={drawn.corners} material={drawn.frame} renderOrder={DRAWN.frame} />
        <group ref={label}>
          <LabelCard
            text={intruder?.label ?? null}
            color={INTRUSION_COLOR}
            width={LABEL.width}
            anchor="foot"
            shown={() => shownNow()[0] ?? 0}
          />
        </group>
      </group>
      <mesh ref={line} geometry={drawn.rod} position={lens}>
        <meshBasicMaterial
          ref={lineMaterial}
          color={lineRed}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
})
