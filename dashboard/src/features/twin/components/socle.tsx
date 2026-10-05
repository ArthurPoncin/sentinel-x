import { memo } from 'react'
import { Color, type WebGLProgramParametersWithUniforms } from 'three'
import { SITE } from '../utils/site'
import { GRAPHITE, STEEL, TERRAIN } from './palette'

// The socle's cut edge: lighter than the terrain, as a board's edge is, so the disc reads as a thick slab.
const CUT = '#4b4f55'
// Contour lines to the unit of relief.
const LEVELS = 5

// The relief the contour lines draw: a slope across the site, two hills and a hollow. It is only drawn: the
// ground stays flat, so everything stands level on it.
const CONTOURS = /* glsl */ `
  varying vec2 vGround;
  uniform vec3 uContour;

  float hill(vec2 at, vec2 top, float spread) {
    vec2 off = at - top;
    return exp(-dot(off, off) / spread);
  }

  float relief(vec2 at) {
    return 0.2 * at.x - 0.1 * at.y
      + 1.1 * hill(at, vec2(-2.2, 2.0), 1.7)
      + 0.8 * hill(at, vec2(2.5, 1.1), 2.3)
      - 0.7 * hill(at, vec2(0.7, -2.7), 1.3);
  }

  // How much of a contour line there is here, 0–1: lines a pixel or two wide whatever the zoom, which fade
  // where they would crowd together, seen from afar or at a grazing angle.
  float contour(vec2 at) {
    float level = relief(at) * float(${LEVELS});
    float pixel = fwidth(level);
    float line = 1.0 - smoothstep(0.5, 1.3, abs(fract(level - 0.5) - 0.5) / pixel);
    return line * (1.0 - smoothstep(0.2, 0.45, pixel));
  }
`

function drawContours(shader: WebGLProgramParametersWithUniforms) {
  shader.uniforms.uContour = { value: new Color(STEEL) }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${CONTOURS}`)
    .replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uContour, 0.34 * contour(vGround));',
    )
}

// The socle: a disc of terrain cut clean like an architect's model, with fine contour lines, afloat in the
// black. Its top is the ground the Outpost stands on.
export const Socle = memo(function Socle() {
  const { radius, thickness } = SITE.socle

  return (
    <mesh position={[0, -thickness / 2, 0]} receiveShadow>
      <cylinderGeometry args={[radius, radius, thickness, 128]} />
      {/* The cut edge, the terrain, the underside. */}
      <meshStandardMaterial attach="material-0" color={CUT} roughness={0.8} />
      <meshStandardMaterial attach="material-1" color={TERRAIN} roughness={0.95} onBeforeCompile={drawContours} />
      <meshStandardMaterial attach="material-2" color={GRAPHITE} />
    </mesh>
  )
})
