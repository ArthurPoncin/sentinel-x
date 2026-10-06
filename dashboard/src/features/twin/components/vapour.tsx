import { useMemo } from 'react'
import type { WebGLProgramParametersWithUniforms } from 'three'
import { OFF_WHITE } from './palette'

// Where a point of the ball is, and where the eye is from it, in the ball's own frame: there it is still
// round, however it was squashed in the scene.
const IN_ITS_FRAME = 'varying vec3 vPuff;\nvarying vec3 vPuffEye;\nvoid main() {'

// A puff is not a ball: it has no outline, since one looks through less of it toward its edge, and no dark
// side, since light goes through it. So it thins out toward its edge and takes the light as if from above.
function soften(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader.replace('void main() {', IN_ITS_FRAME).replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
      vPuff = position;
      vPuffEye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position;`,
  )
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', IN_ITS_FRAME)
    .replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      float vapourDepth = pow(saturate(dot(normalize(vPuff), normalize(vPuffEye))), VAPOUR_EDGE);
      normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, 0.7));`,
    )
    .replace('#include <opaque_fragment>', 'diffuseColor.a *= vapourDepth;\n#include <opaque_fragment>')
}

export interface VapourMaterialProps {
  // How soon a puff thins out toward its edge: the higher, the less of an outline it has.
  edge?: number
}

// What the steam and the haze are made of, for a ball to pass for a puff, round or squashed. It is lit like
// the rest of the maquette, so it takes the scene's light, the Status's flash included, and does not glow.
// Unseen until given an opacity.
export function VapourMaterial({ edge = 1.6 }: VapourMaterialProps) {
  const defines = useMemo(() => ({ VAPOUR_EDGE: edge.toFixed(2) }), [edge])

  return (
    // Matte, and many deep on screen: the cheapest material that takes the light.
    <meshLambertMaterial
      color={OFF_WHITE}
      transparent
      opacity={0}
      depthWrite={false}
      defines={defines}
      onBeforeCompile={soften}
    />
  )
}
