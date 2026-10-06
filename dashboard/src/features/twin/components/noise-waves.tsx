import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, CircleGeometry, Color, type Mesh, ShaderMaterial, Vector2, Vector3 } from 'three'
import type { Frame } from '@/shared/contract'
import { useWaves } from '../hooks/use-waves'
import { MAX_WAVES } from '../utils/noise'
import { NOISE_COLOR } from '../utils/scene'
import { SITE } from '../utils/site'

// How bright a wave emits at its brightest: enough for a halo, not so much that it hides the ground it crosses.
const WAVE_GLOW = 1.6
// How much sharper the wave's front is than its back: it leaves a wake behind it, not ahead.
const FRONT = 3
// How far in from the socle's rim a wave starts to fade out: it ends at the cut edge, it does not spill over.
const RIM = 0.06

const WAVES_VERTEX = /* glsl */ `
  varying vec2 vGround;

  void main() {
    vGround = (modelMatrix * vec4(position, 1.0)).xz;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`
const WAVES_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform vec2 center;
  // Each wave's radius, the width of its band and how bright it is.
  uniform vec3 waves[${MAX_WAVES}];
  varying vec2 vGround;

  void main() {
    float away = distance(vGround, center);
    float light = 0.0;
    for (int wave = 0; wave < ${MAX_WAVES}; wave++) {
      vec3 shape = waves[wave];
      float off = (away - shape.x) / shape.y;
      off *= off > 0.0 ? ${FRONT.toFixed(1)} : 1.0;
      light += shape.z * exp(-off * off);
    }
    float onSocle = 1.0 - smoothstep(${(SITE.socle.radius - RIM).toFixed(3)}, ${SITE.socle.radius.toFixed(3)}, length(vGround));
    gl_FragColor = vec4(color * ${WAVE_GLOW.toFixed(1)} * min(light, 1.0) * onSocle, 1.0);
  }
`

function createWaves() {
  const uniforms = {
    color: { value: new Color(NOISE_COLOR) },
    center: { value: new Vector2(SITE.enclosure.x, SITE.enclosure.z) },
    // A wave that is not there has no light, and a band wide enough never to divide by zero.
    waves: { value: Array.from({ length: MAX_WAVES }, () => new Vector3(0, 1, 0)) },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: WAVES_VERTEX,
    fragmentShader: WAVES_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  // The whole socle, lying on it: a wave is drawn wherever it reaches, and only there.
  const ground = new CircleGeometry(SITE.socle.radius, 128).rotateX(-Math.PI / 2)

  return { uniforms, material, ground }
}

export interface NoiseWavesProps {
  // The feed's frames, oldest first: a `noise` Alert raised among those that come in sends a wave.
  frames: readonly Frame[]
}

// What a clap sounds like on the maquette: a wave of light that leaves the foot of the Enclosure and spreads
// over the socle, further and brighter the louder the clap, then fades out. It plays to its end whatever the
// Alert does, and each clap sends its own. Light added over the ground, unlit: the halo takes it for a light,
// and the buildings it passes behind hide it. Nothing at all is drawn while the site is quiet.
export function NoiseWaves({ frames }: NoiseWavesProps) {
  const mesh = useRef<Mesh>(null)
  const wavesNow = useWaves(frames)
  const drawn = useMemo(createWaves, [])
  useEffect(
    () => () => {
      drawn.material.dispose()
      drawn.ground.dispose()
    },
    [drawn],
  )

  useFrame(() => {
    const waves = wavesNow()
    if (!mesh.current) return
    mesh.current.visible = waves.length > 0
    if (!mesh.current.visible) return
    drawn.uniforms.waves.value.forEach((slot, index) => {
      const wave = waves[index]
      if (wave) slot.set(wave.radius, wave.width, wave.glow)
      else slot.set(0, 1, 0)
    })
  })

  return (
    // Just above the camera sector, so that neither flickers into the other.
    <mesh
      ref={mesh}
      geometry={drawn.ground}
      material={drawn.material}
      position={[0, 0.009, 0]}
      renderOrder={2}
      visible={false}
    />
  )
}
