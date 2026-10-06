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
  Vector3,
} from 'three'
import { useFade } from '../hooks/use-fade'
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
import { type Track, trackAt } from '../utils/glide'
import { INTRUSION_COLOR, type SceneProps } from '../utils/scene'
import { bearingTo, lensHeight, lensPoint, watchedPoint } from '../utils/site'
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
// How the figurine stands at rest: its arms a little off its sides, its forearms a little forward, which tells
// its front from its back. In radians.
const REST = { lean: 0.07, bend: 0.3 } as const
const TORSO_BEVEL = 0.022
// How far below its front the sweep that brings the figurine in still shows, as a band of light.
const BAND = 0.05
// The figurine is drawn in two goes, after the sector on the ground: its shade, then its light.
const DRAWN = { shade: 3, light: 4 } as const

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

  return {
    uniforms,
    shade,
    light,
    shapes,
    pin,
    stem,
    gem,
    rod,
    dispose() {
      shade.dispose()
      light.dispose()
      pin.dispose()
      for (const shape of [...Object.values(shapes), stem, gem, rod]) shape.dispose()
    },
  }
}

type Figurine = ReturnType<typeof createFigurine>
type Triple = readonly [number, number, number]

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
  // How far it leans off the figurine's side, and how far its second segment bends forward. In radians.
  lean?: number
  bend?: number
}

// An arm or a leg: two segments, the second jointed to the first.
function Limb({ drawn, at, upper, lower, length, lean = 0, bend = 0 }: LimbProps) {
  return (
    <group position={at} rotation={[0, 0, lean]}>
      <Volume drawn={drawn} shape={upper} />
      <group position={[0, -length, 0]} rotation={[-bend, 0, 0]}>
        <Volume drawn={drawn} shape={lower} />
      </group>
    </group>
  )
}

// Its left, then its right.
const SIDES = [1, -1] as const

// The figurine, standing at rest on the ground at its feet and looking down its own z: a head, a torso, two
// arms and two legs of two segments each, from the maquette's volumes.
function Standing({ drawn }: { drawn: Figurine }) {
  const { hip, thigh, torso, shoulder, upperArm } = FIGURE
  const { shapes } = drawn

  return (
    <>
      <Volume drawn={drawn} shape={shapes.head} at={[0, headBase(), 0]} />
      <Volume drawn={drawn} shape={shapes.torso} at={[0, torsoSpan().base + torso.height / 2, 0]} />
      {SIDES.map((side) => (
        <Fragment key={side}>
          <Limb
            drawn={drawn}
            at={[side * shoulder.x, shoulderHeight(), 0]}
            upper={shapes.upperArm}
            lower={shapes.forearm}
            length={upperArm.length}
            lean={side * REST.lean}
            bend={REST.bend}
          />
          <Limb
            drawn={drawn}
            at={[side * hip.x, hipHeight(), 0]}
            upper={shapes.thigh}
            lower={shapes.shin}
            length={thigh.length}
          />
        </Fragment>
      ))}
    </>
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
// vision service sees, it sees through there. As `x_norm` changes the figurine glides along the arc to its new
// place, the line following it. A newly raised intruder appears where it stands, in a sweep from its feet to
// its head; once the last `intrusion` Alert is cleared, it fades out where it last stood. Unlit and brighter
// than white, so the halo takes it all for lights. Nothing casts a shadow: the shadows are drawn once, and it
// moves.
export const Intruder = memo(function Intruder({ intruder }: IntruderProps) {
  const group = useRef<Group>(null)
  const standing = useRef<Group>(null)
  const ring = useRef<MeshBasicMaterial>(null)
  const line = useRef<Mesh>(null)
  const lineMaterial = useRef<MeshBasicMaterial>(null)
  const track = useRef<Track | null>(null)
  const whole = useRef(WHOLE)
  const shownNow = useFade([intruder ? 1 : 0])
  const drawn = useMemo(createFigurine, [])
  useEffect(() => () => drawn.dispose(), [drawn])
  const red = useMemo(() => new Color(INTRUSION_COLOR).multiplyScalar(GLOW), [])
  const lineRed = useMemo(() => new Color(INTRUSION_COLOR).multiplyScalar(LINE.glow), [])
  const lens = useMemo(() => {
    const { x, z } = lensPoint()
    return new Vector3(x, lensHeight(), z)
  }, [])
  const toHead = useMemo(() => new Vector3(), [])

  useFrame(({ clock }, delta) => {
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
    standing.current?.rotation.set(0, bearingTo(at, lens), 0)
    drawn.uniforms.level.value = figurine
    // Past the top of its head, so that the band of light leaves it.
    drawn.uniforms.swept.value = sweptTo(tracked.age) * (figureHeight() + BAND)
    drawn.uniforms.time.value = now
    if (ring.current) ring.current.opacity = level
    drawn.pin.opacity = level
    if (lineMaterial.current) lineMaterial.current.opacity = level

    const rod = line.current
    if (!rod) return
    toHead.set(at.x, headHeight(), at.z).sub(lens)
    rod.scale.set(1, toHead.length(), 1)
    rod.quaternion.setFromUnitVectors(UP, toHead.normalize())
  })

  return (
    <group ref={group} visible={false}>
      <group ref={standing}>
        <Standing drawn={drawn} />
        <mesh geometry={drawn.stem} material={drawn.pin} />
        <mesh geometry={drawn.gem} material={drawn.pin} />
        {/* On the arc itself, just above the camera's sector so it does not flicker into it. */}
        <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[RING.inner, RING.outer, 48]} />
          <meshBasicMaterial ref={ring} color={red} transparent opacity={0} depthWrite={false} />
        </mesh>
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
