import { useFrame } from '@react-three/fiber'
import { Fragment, memo, useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  type Group,
  type Material,
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
import { figurineLevel, lastKnown, NO_TRACKS, type Track, tracksAt } from '../utils/track'
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
// The outline the figurine leaves where it was last seen: how thick its line is, in scene units, and how bright
// it emits. Dimmer than the ring and the marker of an intruder that is seen.
const OUTLINE = { width: 0.007, glow: 3 } as const
// The figurine is drawn in two goes, after the camera's field, its walls as its sector on the ground: its
// shade, then its light. Its outline comes after both. The frame of its detection comes after everything that
// stands on the site, and under the labels.
const DRAWN = { shade: 3, light: 4, outline: 5, frame: 9 } as const

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

// The outline: each volume a line's width larger than it is, of which only the inside is drawn, the far side
// of it. The volumes themselves hide all of that but what goes past their edge: a line around the figurine.
const OUTLINE_VERTEX = /* glsl */ `
  attribute vec3 outward;
  varying float vHeight;

  void main() {
    vec4 world = modelMatrix * vec4(position + ${OUTLINE.width} * outward, 1.0);
    vHeight = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const OUTLINE_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float level;
  uniform float swept;
  varying float vHeight;

  void main() {
    // Of a figurine its sweep had not brought in whole, only what was seen: the line closes over it.
    if (vHeight > swept + ${OUTLINE.width}) discard;
    gl_FragColor = vec4(color * ${OUTLINE.glow.toFixed(1)} * level, 1.0);
  }
`
// What hides the inside of an outline that has no figurine left in it: the volumes, of which only the depth
// is drawn.
const HOLLOW_FRAGMENT = /* glsl */ `
  uniform float swept;
  varying float vHeight;

  void main() {
    if (vHeight > swept) discard;
    gl_FragColor = vec4(0.0);
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

// Gives `shape` the way out of it at each of its points: its normal there, and across a crisp edge, where
// several points stand at one place with a normal each, the mean of them. A volume moved out along it stays in
// one piece, where along its normals it would come apart at every edge.
function withOutward(shape: BufferGeometry): BufferGeometry {
  const positions = shape.getAttribute('position')
  const normals = shape.getAttribute('normal')
  const ways = new Map<string, Vector3>()
  const point = new Vector3()
  const normal = new Vector3()
  const places = Array.from({ length: positions.count }, (_, index) => {
    point.fromBufferAttribute(positions, index)
    // To a hundredth of a millimetre of the maquette: the same place.
    const place = point.toArray().map((along) => Math.round(along * 1e5)).join()
    const way = ways.get(place) ?? new Vector3()
    ways.set(place, way.add(normal.fromBufferAttribute(normals, index)))
    return place
  })
  for (const way of ways.values()) way.normalize()

  const outward = new BufferAttribute(new Float32Array(positions.count * 3), 3)
  places.forEach((place, index) => {
    const way = ways.get(place)
    if (way) outward.setXYZ(index, way.x, way.y, way.z)
  })
  return shape.setAttribute('outward', outward)
}

// One go of what a figurine's volumes are drawn in, and when it comes among the others.
interface Pass {
  material: Material
  order: number
}

// The outline of a figurine: its line, and how much of it shows. `swept` is how high the figurine's sweep had
// got to.
function createOutline(swept: { value: number }) {
  const uniforms = { color: { value: new Color(INTRUSION_COLOR) }, level: { value: 0 }, swept }
  const line = new ShaderMaterial({
    vertexShader: OUTLINE_VERTEX,
    fragmentShader: OUTLINE_FRAGMENT,
    uniforms,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: BackSide,
  })
  return { uniforms, line }
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

  // Its outline, which it leaves where it last stood once its Alert is cleared. Its shade, which by then
  // shades nothing, still leaves its depth: that is what keeps the outline hollow.
  const outline = createOutline(uniforms.swept)
  // The outline of the intruder before it, which goes out where that one stood as a new one is raised: it has
  // no figurine left in it, only the depth of one. Drawn when a figurine's shade is, after the camera's
  // field: before it, it would cut its shape out of the field and of its sector.
  const formerSwept = { value: 0 }
  const former = createOutline(formerSwept)
  const hollow = new ShaderMaterial({
    vertexShader: HOLOGRAM_VERTEX,
    fragmentShader: HOLLOW_FRAGMENT,
    uniforms: { swept: formerSwept },
    transparent: true,
    colorWrite: false,
  })

  const { thigh, shin, torso, upperArm, forearm, head } = FIGURE
  const shapes = {
    head: withOutward(turnedShape(egg(head))),
    torso: withOutward(boxShape([torso.width, torso.height, torso.depth], TORSO_BEVEL)),
    upperArm: withOutward(turnedShape(hanging(upperArm))),
    forearm: withOutward(turnedShape(hanging(forearm))),
    thigh: withOutward(turnedShape(hanging(thigh))),
    shin: withOutward(turnedShape(hanging(shin))),
  }
  const passes: readonly Pass[] = [
    { material: shade, order: DRAWN.shade },
    { material: light, order: DRAWN.light },
    { material: outline.line, order: DRAWN.outline },
  ]
  const formerPasses: readonly Pass[] = [
    { material: hollow, order: DRAWN.shade },
    { material: former.line, order: DRAWN.outline },
  ]
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
    light,
    outline,
    former,
    // The figurine's volumes and what they are drawn in, and the same for the outline of the one before it.
    body: { shapes, passes },
    formerBody: { shapes, passes: formerPasses },
    pin,
    stem,
    gem,
    rod,
    frame,
    corners,
    dispose() {
      for (const material of [shade, light, outline.line, former.line, hollow, pin, frame]) material.dispose()
      for (const shape of [...Object.values(shapes), stem, gem, rod, corners]) shape.dispose()
    },
  }
}

// A figurine's volumes, and the goes they are drawn in.
type Drawn = ReturnType<typeof createFigurine>['body']
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

// One of the figurine's volumes, at `at`, in each of the goes it is drawn in.
function Volume({ drawn, shape, at }: { drawn: Drawn; shape: BufferGeometry; at?: Triple }) {
  return (
    <group position={at}>
      {drawn.passes.map(({ material, order }) => (
        <mesh key={order} geometry={shape} material={material} renderOrder={order} />
      ))}
    </group>
  )
}

interface LimbProps {
  drawn: Drawn
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
function Body({ drawn, skeleton }: { drawn: Drawn; skeleton: Skeleton }) {
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

// Stands a figurine where its track has it, `standing` at its feet, in the pose of its walk: both are returned.
function stand(standing: Group | null, skeleton: Skeleton, track: Track, lens: Vector3) {
  const at = watchedPoint(track.x_norm)
  standing?.position.set(at.x, 0, at.z)
  // It faces the lens at rest and the way it goes in full stride, and turns from one to the other as it gets
  // into its stride and out of it. Its walk cycle goes by the ground it has covered.
  const stride = Math.abs(track.walking)
  const toLens = bearingTo(at, lens)
  const facing = stride === 0 ? toLens : turnedTo(toLens, bearingAlongFence(at, track.walking), stride)
  const walk = walkCycle(walkPhase(track.walked), stride)
  skeleton.body?.position.setY(-walk.drop)
  skeleton.body?.rotation.set(0, facing, 0)
  for (const { limb } of SIDES) {
    pose(skeleton.legs[limb], walk.legs[limb], 1)
    pose(skeleton.arms[limb], walk.arms[limb], -1)
  }
  return { at, walk }
}

// How high the sweep that brought a figurine in has got to: past the top of its head, so that the band of
// light leaves it.
const sweptHeight = (track: Track) => sweptTo(track.age) * (figureHeight() + BAND)

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
// A newly raised intruder appears where it stands, at rest, in a sweep from its feet to its head. Once the
// last `intrusion` Alert is cleared, it fades out where it last stood and leaves its outline there, hollow,
// still and at rest, with no pin, no ring, no line, no brackets and no label: the last known position, which
// stays for about five seconds and goes out. An intruder raised meanwhile appears at its own place, and the
// outline of the one before it goes out where it is. Unlit and brighter than white, so the halo takes it all
// for lights. Nothing casts a shadow: the shadows are drawn once, and it moves.
export const Intruder = memo(function Intruder({ intruder }: IntruderProps) {
  const group = useRef<Group>(null)
  const standing = useRef<Group>(null)
  const marks = useRef<Group>(null)
  const sighted = useRef<Group>(null)
  const frame = useRef<Group>(null)
  const label = useRef<Group>(null)
  const ring = useRef<MeshBasicMaterial>(null)
  const line = useRef<Mesh>(null)
  const lineMaterial = useRef<MeshBasicMaterial>(null)
  const formerStanding = useRef<Group>(null)
  const tracks = useRef(NO_TRACKS)
  const shownNow = useFade([intruder ? 1 : 0])
  const drawn = useMemo(createFigurine, [])
  useEffect(() => () => drawn.dispose(), [drawn])
  const skeleton = useMemo(createSkeleton, [])
  const formerSkeleton = useMemo(createSkeleton, [])
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
    tracks.current = tracksAt(tracks.current, intruder && { alertId: intruder.alertId, x_norm: intruder.x_norm }, delta)
    const { intruder: tracked, former } = tracks.current
    if (group.current) group.current.visible = tracked !== null || former !== null

    // The outline a new intruder puts out, where the one before it last stood.
    if (formerStanding.current) formerStanding.current.visible = former !== null
    if (former) {
      stand(formerStanding.current, formerSkeleton, former, lens)
      drawn.former.uniforms.level.value = lastKnown(former)?.level ?? 0
      drawn.former.uniforms.swept.value = sweptHeight(former)
    }

    // What tells an intruder that is seen, which its outline does not carry: all of it fades with its Alert.
    const level = tracked ? (shownNow()[0] ?? 0) : 0
    if (standing.current) standing.current.visible = tracked !== null
    if (marks.current) marks.current.visible = level > 0
    if (sighted.current) sighted.current.visible = level > 0
    if (!tracked) return

    const { at, walk } = stand(standing.current, skeleton, tracked, lens)
    // While its Alert is active the figurine is whole, its sweep brings it in: it only fades out, and its
    // outline comes as it goes.
    const figurine = figurineLevel(tracked)
    const outline = lastKnown(tracked)?.level ?? 0
    drawn.uniforms.level.value = figurine
    drawn.uniforms.swept.value = sweptHeight(tracked)
    drawn.uniforms.time.value = clock.elapsedTime
    drawn.light.visible = figurine > 0
    drawn.outline.uniforms.level.value = outline
    drawn.outline.line.visible = outline > 0
    if (level === 0) return

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
        <Body drawn={drawn.body} skeleton={skeleton} />
        <group ref={marks}>
          <mesh geometry={drawn.stem} material={drawn.pin} />
          <mesh geometry={drawn.gem} material={drawn.pin} />
          {/* On the arc itself, just above the camera's sector so it does not flicker into it. */}
          <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[RING.inner, RING.outer, 48]} />
            <meshBasicMaterial ref={ring} color={red} transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      </group>
      <group ref={sighted}>
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
      <group ref={formerStanding} visible={false}>
        <Body drawn={drawn.formerBody} skeleton={formerSkeleton} />
      </group>
    </group>
  )
})
