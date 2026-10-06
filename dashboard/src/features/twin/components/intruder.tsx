import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  ShaderMaterial,
  Vector3,
} from 'three'
import { useFade } from '../hooks/use-fade'
import { type Track, trackAt } from '../utils/glide'
import { INTRUSION_COLOR, type SceneProps } from '../utils/scene'
import { lensHeight, lensPoint, watchedPoint } from '../utils/site'

// The column of light the intruder is: a little wider than a post, and three times the fence's height, so it
// reads over it from the back of the room.
const COLUMN = { radius: 0.085, height: 0.8 } as const
// How bright it emits at its foot, in the intrusion's red.
const GLOW = 4
// The ring at its feet, flat on the ground, which marks the very point of the arc it stands on.
const RING = { inner: 0.085, outer: 0.115 } as const
// The line from the lens to the column: how thin, how bright, and how far up the column it ends, as a share
// of its height: about where a head would be.
const LINE = { radius: 0.005, glow: 2.5, end: 0.4 } as const

const COLUMN_VERTEX = /* glsl */ `
  varying float vUp;
  varying float vFacing;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 outward = normalize(mat3(modelMatrix) * normal);
    vFacing = abs(dot(outward, normalize(cameraPosition - world.xyz)));
    vUp = uv.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const COLUMN_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float level;
  varying float vUp;
  varying float vFacing;

  void main() {
    // Brightest along its axis, where it is seen through the most light, and at its foot, fading upward.
    float core = vFacing * vFacing;
    float fall = pow(1.0 - vUp, 1.5);
    gl_FragColor = vec4(color * core * fall * level, 1.0);
  }
`

function createColumn() {
  const uniforms = {
    color: { value: new Color(INTRUSION_COLOR).multiplyScalar(GLOW) },
    level: { value: 0 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: COLUMN_VERTEX,
    fragmentShader: COLUMN_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    // Its far side shows through its near one: a volume of light, not a tube.
    side: DoubleSide,
  })
  // Open at both ends, its foot on the ground.
  const shape = new CylinderGeometry(COLUMN.radius, COLUMN.radius, COLUMN.height, 32, 1, true).translate(
    0,
    COLUMN.height / 2,
    0,
  )
  // The line: a thin rod one unit long from its foot up, stretched and turned from the lens to the column.
  const rod = new CylinderGeometry(LINE.radius, LINE.radius, 1, 6, 1, true).translate(0, 0.5, 0)

  return { uniforms, material, shape, rod }
}

const UP = new Vector3(0, 1, 0)

export interface IntruderProps {
  // The intruder of the active `intrusion` Alerts, or null: there is none.
  intruder: SceneProps['intruder']
}

// The intruder the camera sees: a column of light in the intrusion's red, standing on the arc of the fence the
// camera watches, where `x_norm` places it, and tied to the Enclosure's lens by a thin line: what the vision
// service sees, it sees through there. As `x_norm` changes the column glides along the arc to its new place,
// the line following it; a newly raised intruder fades in where it stands. Once the last `intrusion` Alert is
// cleared, column and line fade out where they last stood. Unlit and brighter than white, so the halo takes
// them for lights. Nothing casts a shadow: the shadows are drawn once, and it moves.
export const Intruder = memo(function Intruder({ intruder }: IntruderProps) {
  const group = useRef<Group>(null)
  const column = useRef<Group>(null)
  const ring = useRef<MeshBasicMaterial>(null)
  const line = useRef<Mesh>(null)
  const lineMaterial = useRef<MeshBasicMaterial>(null)
  const track = useRef<Track | null>(null)
  const shownNow = useFade([intruder ? 1 : 0])
  const drawn = useMemo(createColumn, [])
  useEffect(
    () => () => {
      drawn.material.dispose()
      drawn.shape.dispose()
      drawn.rod.dispose()
    },
    [drawn],
  )
  const red = useMemo(() => new Color(INTRUSION_COLOR).multiplyScalar(GLOW), [])
  const lineRed = useMemo(() => new Color(INTRUSION_COLOR).multiplyScalar(LINE.glow), [])
  const lens = useMemo(() => {
    const { x, z } = lensPoint()
    return new Vector3(x, lensHeight(), z)
  }, [])
  const toColumn = useMemo(() => new Vector3(), [])

  useFrame((_, delta) => {
    track.current = trackAt(track.current, intruder && { alertId: intruder.alertId, x_norm: intruder.x_norm }, delta)
    const level = shownNow()[0] ?? 0
    const shown = track.current !== null && level > 0
    if (group.current) group.current.visible = shown
    if (!shown || !track.current) return

    const at = watchedPoint(track.current.x_norm)
    column.current?.position.set(at.x, 0, at.z)
    drawn.uniforms.level.value = level
    if (ring.current) ring.current.opacity = level
    if (lineMaterial.current) lineMaterial.current.opacity = level

    const rod = line.current
    if (!rod) return
    toColumn.set(at.x, COLUMN.height * LINE.end, at.z).sub(lens)
    rod.scale.set(1, toColumn.length(), 1)
    rod.quaternion.setFromUnitVectors(UP, toColumn.normalize())
  })

  return (
    <group ref={group} visible={false}>
      <group ref={column}>
        <mesh geometry={drawn.shape} material={drawn.material} />
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
