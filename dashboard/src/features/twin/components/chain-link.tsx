import { type BufferGeometry, DoubleSide, type WebGLProgramParametersWithUniforms } from 'three'
import { STEEL } from './palette'

// How thick a wire is, as a share of the gap between two wires that run the same way: about twice a real
// mesh's, to read from the back of the room.
const WIRE = 0.16
// Under this much of a wire, nothing is drawn, nor lit.
const NO_WIRE = 0.004
// How much of the light a wire takes as if it fell on it from above, the rest as the surface it is drawn on.
const UPWARD = 0.6

// The mesh's diamonds, drawn from `vLink`: where a point is on the surface, in diamonds across and up. Its
// wires run both ways along the diagonals.
const WEAVE = /* glsl */ `
  varying vec2 vLink;
  const float WIRE = ${WIRE.toFixed(3)};

  // How much of a wire there is here, 0–1, for the wires that run where "across" is whole. A wire is never
  // drawn thinner than a pixel: it is drawn fainter instead, as much as it is wider. Where the wires would
  // crowd together, seen from afar or at a grazing angle, they fade to the veil they add up to.
  float wires(float across) {
    float pixel = fwidth(across);
    float width = max(WIRE, pixel);
    float off = abs(fract(across - 0.5) - 0.5);
    float wire = 1.0 - smoothstep(0.5 * (width - pixel), 0.5 * (width + pixel), off);
    return mix(wire * WIRE / width, WIRE, smoothstep(0.3, 0.6, pixel));
  }

  float chainLink(vec2 at) {
    float rising = wires(at.x - at.y);
    float falling = wires(at.x + at.y);
    return rising + falling - rising * falling;
  }
`

function weave(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vLink;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLink = uv;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${WEAVE}`)
    // Before the alpha test: where there is no wire, the light is not worked out.
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= chainLink(vLink);')
    // A wire is round: whichever side of the mesh is seen, it shows the light that falls on it from above.
    .replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, ${UPWARD.toFixed(2)}));`,
    )
}

// Counts a surface's `uv` in diamonds of chain-link: `across` of them over its width, `up` over its height.
export function inDiamonds(surface: BufferGeometry, across: number, up: number): BufferGeometry {
  const uv = surface.getAttribute('uv')
  for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * across, uv.getY(index) * up)
  return surface
}

// What the fence's mesh and the gate's are made of: chain-link, drawn by the material on a plain surface whose
// `uv` counts its diamonds (`inDiamonds`). However many there are, none has a shape of its own. Steel like the
// posts and lit like the rest of the maquette, so it takes the scene's light, the Status's flash included, and
// never glows. What stands behind it is seen between its wires, from either side: it leaves no depth, so draw
// it before what must not be veiled by it.
export function ChainLinkMaterial() {
  return (
    // Matte, and wide on screen all round the site: the cheapest material that takes the light.
    <meshLambertMaterial
      color={STEEL}
      transparent
      alphaTest={NO_WIRE}
      depthWrite={false}
      side={DoubleSide}
      // Both sides in one go: they are the same steel, whichever is drawn over the other.
      forceSinglePass
      onBeforeCompile={weave}
    />
  )
}
