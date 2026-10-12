import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, Color, DoubleSide, type Mesh, ShaderMaterial, SphereGeometry } from 'three'
import { useFade } from '../hooks/use-fade'
import { type SceneProps, SHIELD_COLOR } from '../utils/scene'
import { SITE } from '../utils/site'
import { LabelCard } from './label-card'

// How bright the dome emits where it is brightest, its edge against the sky: enough for a halo, not so much
// that it hides the site under it.
const GLOW = 1.5
// What it emits of that, 0–1: over its whole skin, on the lines of its weave, on its edge, and at its foot.
const FILM = 0.035
const WEAVE = 0.2
const EDGE = 0.75
const FOOT = 0.45
// What the side of the dome seen from inside, through the near one, keeps of its light.
const FAR_SIDE = 0.3
// Cells of the weave from the top of the dome down to the ground.
const CELLS = 9
// Seconds a band of light takes to climb the dome, and how much it adds: the shield is live, not a glass bell.
const SWEEP_PERIOD = 5
const SWEEP = 0.12
// How wide its label is, in scene units, and how far over the top of the dome it stands.
const LABEL_WIDTH = 2.3
const LABEL_RISE = 0.12

const VERTEX = /* glsl */ `
  // Where on the dome, as on half a sphere of radius 1, then its normal and the way to the eye, as the camera
  // sees them: the dome is taller than it is wide, and its normals lean with it.
  varying vec3 vAt;
  varying vec3 vNormal;
  varying vec3 vToEye;

  void main() {
    vAt = position;
    vec4 seen = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalMatrix * normal;
    vToEye = -seen.xyz;
    gl_Position = projectionMatrix * seen;
  }
`
const FRAGMENT = /* glsl */ `
  uniform vec3 color;
  // How far the dome is raised, 0–1, and the seconds its band of light climbs by.
  uniform float raised;
  uniform float time;
  varying vec3 vAt;
  varying vec3 vNormal;
  varying vec3 vToEye;

  // How far inside its cell of a honeycomb the point is: 0 on a wall, 0.5 at the middle. Cells are 1 across.
  float cell(vec2 at) {
    const vec2 pitch = vec2(1.0, 1.7320508);
    vec4 nearest = floor(vec4(at, at - vec2(0.5, 1.0)) / pitch.xyxy) + 0.5;
    vec4 from = vec4(at - nearest.xy * pitch, at - (nearest.zw + 0.5) * pitch);
    vec2 off = abs(dot(from.xy, from.xy) < dot(from.zw, from.zw) ? from.xy : from.zw);
    return 0.5 - max(dot(off, pitch * 0.5), off.x);
  }

  void main() {
    float up = vAt.y;
    // It rises from the ground: what is above its crest is not there yet.
    float crest = raised * 1.04;
    if (up > crest) discard;

    // The weave, laid out from the top of the dome: as far from it as the angle down from it, so the cells
    // keep their size from the top to the ground.
    float down = acos(clamp(up, -1.0, 1.0));
    vec2 laid = normalize(vAt.xz + 1.0e-5) * down * ${((2 * CELLS) / Math.PI).toFixed(3)};
    float inside = cell(laid);
    float line = 1.0 - smoothstep(0.0, max(0.035, 1.5 * fwidth(inside)), inside);

    // Brighter where the skin is seen edge-on: the outline of the dome against the sky.
    float facing = abs(dot(normalize(vNormal), normalize(vToEye)));
    float edge = pow(1.0 - facing, 2.5);
    float foot = exp(-up * 45.0);
    float sweep = exp(-pow((up - fract(time / ${SWEEP_PERIOD.toFixed(1)}) * 1.2) / 0.07, 2.0));
    // The crest glows as it climbs and as it comes down, and not once the dome is closed.
    float rim = exp(-pow((crest - up) / 0.05, 2.0)) * (1.0 - smoothstep(0.9, 1.0, raised));

    float light = ${FILM} + ${WEAVE} * line + ${EDGE} * edge + ${FOOT} * foot + ${SWEEP} * sweep * (0.4 + line);
    if (!gl_FrontFacing) light *= ${FAR_SIDE};
    light = light * smoothstep(0.0, 0.5, raised) + rim;
    gl_FragColor = vec4(color * ${GLOW.toFixed(1)} * light, 1.0);
  }
`

function createDome() {
  const uniforms = { color: { value: new Color(SHIELD_COLOR) }, raised: { value: 0 }, time: { value: 0 } }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
  // Half a sphere of radius 1, from its top down to the ground it stands on.
  const half = new SphereGeometry(1, 64, 24, 0, 2 * Math.PI, 0, Math.PI / 2)

  return { uniforms, material, half }
}

export interface ShieldProps {
  // The shield of the scene: raised around the whole Outpost while it is not null, lowered otherwise.
  shield: SceneProps['shield']
}

// What an attack on the Command Post looks like on the maquette: a dome of light raised around the whole
// Outpost, a honeycomb weave brighter on its outline, for as long as a `cyber` Alert is active. It rises from
// the ground and comes back down to it in a fade, like everything in the Twin. Over its top, a card names the
// entry point attacked and the attempts refused so far, and keeps its last text while it fades out.
// One see-through mesh, light added over what is behind it, unlit: the halo takes it for a light, the site
// reads through it, and what stands in front of its far side hides it. Nothing is drawn while it is lowered.
export function Shield({ shield }: ShieldProps) {
  const mesh = useRef<Mesh>(null)
  const raisedNow = useFade([shield ? 1 : 0])
  const dome = useMemo(createDome, [])
  useEffect(
    () => () => {
      dome.material.dispose()
      dome.half.dispose()
    },
    [dome],
  )

  useFrame(({ clock }) => {
    const raised = raisedNow()[0] ?? 0
    dome.uniforms.raised.value = raised
    dome.uniforms.time.value = clock.elapsedTime
    if (mesh.current) mesh.current.visible = raised > 0.004
  })

  const { radius, height } = SITE.shield

  return (
    <>
      <mesh
        ref={mesh}
        geometry={dome.half}
        material={dome.material}
        scale={[radius, height, radius]}
        // Over the haze, the dust and what is lit on the ground, and before the hot air, which ripples it too.
        renderOrder={4}
        visible={false}
      />
      <LabelCard
        text={shield?.label ?? null}
        color={SHIELD_COLOR}
        width={LABEL_WIDTH}
        position={[0, height + LABEL_RISE, 0]}
        anchor="foot"
        shown={() => raisedNow()[0] ?? 0}
      />
    </>
  )
}
