import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, CustomBlending, type Mesh, MinEquation, OneFactor, ShaderMaterial, ZeroFactor } from 'three'
import { useFade } from '../hooks/use-fade'
import type { Block } from '../utils/site'

// How far the hot air spreads from the middle of the roof before it has thinned out to a third: as shares of
// the block's width and depth, and in scene units above it.
const SPREAD = { width: 0.34, depth: 0.34, rise: 0.6 }
// The box it is drawn in reaches this many spreads out: past that the air is too thin to bend anything. What
// stands inside that box is taken to be behind the hot air: keep it clear of the plant's other parts.
const REACH = 2.2
// How much of the frame the hot air gives up to the ripples where it is thickest, 0–1.
const STRENGTH = 1

const VERTEX = /* glsl */ `
  // Where on the box, and where the eye is: both in spreads from the foot of the hot air.
  varying vec3 vAt;
  varying vec3 vEye;

  void main() {
    vAt = position * ${REACH.toFixed(2)};
    vEye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz * ${REACH.toFixed(2)};
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAGMENT = /* glsl */ `
  uniform float strength;
  varying vec3 vAt;
  varying vec3 vEye;

  // The share of a bell curve that lies before x, from -1 to 1: within a hundredth of erf.
  float before(float x) {
    return sign(x) * sqrt(1.0 - exp(-1.2732 * x * x));
  }

  void main() {
    vec3 sight = normalize(vAt - vEye);
    // The air thins out as a bell around its foot, the middle of the roof. Along the line of sight that is
    // a bell again, around the point of the line nearest the foot, which it misses by sqrt(miss).
    float toward = dot(vEye, sight);
    float miss = dot(vEye, vEye) - toward * toward;
    // A sight that goes down stops on the roof: only the air above it counts.
    float end = sight.y < 0.0 ? -vEye.y / sight.y : 1.0e4;
    float through = exp(-miss) * 0.5 * (1.0 + before(end + toward));
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - strength * through);
  }
`

export interface HeatShimmerProps extends Block {
  // Whether the air ripples. It comes and goes in a fade.
  active: boolean
}

// The hot air above a block of the plant, from its top up. It draws nothing itself: for each pixel it writes
// what the hot air the eye looks through leaves of the frame's alpha, hidden by whatever stands in front, and
// the frame's last pass (Halo) ripples the image there. So it costs one box, and nothing while the air is still.
export function HeatShimmer({ x, z, width, depth, height, active }: HeatShimmerProps) {
  const mesh = useRef<Mesh>(null)
  const strengthNow = useFade([active ? STRENGTH : 0])
  // A box standing on its origin, the foot of the hot air.
  const box = useMemo(() => new BoxGeometry(2, 1, 2).translate(0, 0.5, 0), [])
  const uniforms = useMemo(() => ({ strength: { value: 0 } }), [])
  const air = useMemo(
    () =>
      new ShaderMaterial({
        uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        // The frame keeps its colors, and of its alpha no more than the hot air leaves: the lesser of the two,
        // so that a light added behind the hot air, which raises the alpha, ripples like the rest.
        blending: CustomBlending,
        blendSrc: ZeroFactor,
        blendDst: OneFactor,
        blendEquationAlpha: MinEquation,
      }),
    [uniforms],
  )

  useEffect(
    () => () => {
      box.dispose()
      air.dispose()
    },
    [box, air],
  )

  useFrame(() => {
    uniforms.strength.value = strengthNow()[0] ?? 0
    if (mesh.current) mesh.current.visible = uniforms.strength.value > 0
  })

  return (
    <mesh
      ref={mesh}
      geometry={box}
      material={air}
      position={[x, height, z]}
      scale={[REACH * SPREAD.width * width, REACH * SPREAD.rise, REACH * SPREAD.depth * depth]}
      visible={false}
      // After everything else that is see-through: none of it then blends over what is written here.
      renderOrder={10}
    />
  )
}
