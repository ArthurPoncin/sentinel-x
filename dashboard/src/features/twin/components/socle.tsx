import { memo, useEffect, useMemo } from 'react'
import {
  Color,
  DataTexture,
  LinearFilter,
  RedFormat,
  type Texture,
  UnsignedByteType,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { fromPath, type GroundPoint, SITE, track } from '../utils/site'
import { GRAPHITE, STEEL, TERRAIN } from './palette'

// The socle's cut edge: lighter than the terrain, as a board's edge is, so the disc reads as a thick slab.
const CUT = '#4b4f55'
// Contour lines to the unit of relief.
const LEVELS = 5

// The track is drawn from a map of the ground, `size` points a side over the whole socle: each holds how far
// it is from the middle of the track, up to `reach`.
const TRACK_MAP = { size: 256, reach: 0.4 } as const
// The track on the ground: how much of the terrain its earth covers, packed and paler; its two ruts, each
// `rut.aside` from its middle and `rut.width` wide, paler still; and how soft its edge is.
const TRACK = { cover: 0.38, rut: { aside: 0.062, width: 0.03, cover: 0.26 }, edge: 0.025 } as const

// The map the track is drawn from, worked out once from the site plan.
function trackMap(): Texture {
  const { size, reach } = TRACK_MAP
  const span = 2 * SITE.socle.radius
  const { toHall, toEdge } = track()
  // Drawn on past the rim, so that the socle's edge cuts the track clean rather than round.
  const [from, rim] = [toEdge.at(-2), toEdge.at(-1)]
  const past: GroundPoint[] =
    from && rim ? [...toEdge, { x: rim.x + (rim.x - from.x), z: rim.z + (rim.z - from.z) }] : toEdge
  const far = new Uint8Array(size * size)
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const point = { x: ((column + 0.5) / size - 0.5) * span, z: ((row + 0.5) / size - 0.5) * span }
      const away = Math.min(fromPath(point, toHall), fromPath(point, past))
      far[row * size + column] = Math.round(255 * Math.min(1, away / reach))
    }
  }
  const map = new DataTexture(far, size, size, RedFormat, UnsignedByteType)
  map.magFilter = LinearFilter
  map.minFilter = LinearFilter
  map.needsUpdate = true
  return map
}

// How much of the track there is at a point of the ground, 0–1: its earth, then its ruts.
const TRACK_DRAWN = /* glsl */ `
  uniform sampler2D uTrackMap;
  uniform vec3 uTrack;

  vec2 trackAt(vec2 at) {
    float away = texture2D(uTrackMap, at / ${(2 * SITE.socle.radius).toFixed(3)} + 0.5).r * ${TRACK_MAP.reach.toFixed(3)};
    float half_ = ${(SITE.track.width / 2).toFixed(4)};
    float earth = 1.0 - smoothstep(half_ - ${TRACK.edge.toFixed(4)}, half_ + ${TRACK.edge.toFixed(4)}, away);
    float rut = 1.0 - smoothstep(0.3, 1.0, abs(away - ${TRACK.rut.aside.toFixed(4)}) / ${(TRACK.rut.width / 2).toFixed(4)});
    return vec2(earth, rut * earth);
  }
`

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

// What is drawn in the ground, which stays flat: the track first, in the ground itself, then the contour
// lines over it, which run on across the track.
const drawGround = (map: Texture) => (shader: WebGLProgramParametersWithUniforms) => {
  shader.uniforms.uContour = { value: new Color(STEEL) }
  shader.uniforms.uTrack = { value: new Color(STEEL) }
  shader.uniforms.uTrackMap = { value: map }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${CONTOURS}\n${TRACK_DRAWN}`)
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec2 onTrack = trackAt(vGround);
      diffuseColor.rgb = mix(diffuseColor.rgb, uTrack, ${TRACK.cover.toFixed(2)} * onTrack.x + ${TRACK.rut.cover.toFixed(2)} * onTrack.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, uContour, 0.34 * contour(vGround));`,
    )
}

// The socle: a disc of terrain cut clean like an architect's model, with fine contour lines, afloat in the
// black. Its top is the ground the Outpost stands on. The track is drawn in it where the site plan runs it,
// from the gate to the hall's door and from the gate out to the rim, where it stops: packed earth and two
// ruts, without relief, in the maquette's neutral tones.
export const Socle = memo(function Socle() {
  const { radius, thickness } = SITE.socle
  const map = useMemo(trackMap, [])
  const ground = useMemo(() => drawGround(map), [map])
  useEffect(() => () => map.dispose(), [map])

  return (
    <mesh position={[0, -thickness / 2, 0]} receiveShadow>
      <cylinderGeometry args={[radius, radius, thickness, 128]} />
      {/* The cut edge, the terrain, the underside. */}
      <meshStandardMaterial attach="material-0" color={CUT} roughness={0.8} />
      <meshStandardMaterial attach="material-1" color={TERRAIN} roughness={0.95} onBeforeCompile={ground} />
      <meshStandardMaterial attach="material-2" color={GRAPHITE} />
    </mesh>
  )
})
