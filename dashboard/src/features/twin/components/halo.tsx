import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  type Camera,
  type Effect,
  HalfFloatType,
  Light,
  type Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { useFade } from '../hooks/use-fade'

const HALO_STRENGTH = 0.22
const HALO_RADIUS = 0.8

// Lit frame + halo, both still linear: the renderer tone-maps the sum afterwards.
const SUM_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SUM_FRAGMENT = /* glsl */ `
  uniform sampler2D tLit;
  uniform sampler2D tHalo;
  uniform float saturation;
  uniform float time;
  uniform float aspect;
  uniform float unit;
  varying vec2 vUv;

  // How far hot air throws what is seen through it, in scene units, at this point of the frame (in scene
  // units too): waves that rise, bent by slower ones that run across them.
  vec2 ripple(vec2 at) {
    float bend = sin(at.x * 9.0 + time * 1.9) + 0.6 * sin(at.x * 23.0 - time * 2.7);
    float wave = sin(at.y * 27.0 - time * 9.0 + 1.5 * bend);
    float fine = sin(at.y * 58.0 - time * 15.0 + at.x * 19.0 + bend);
    return 0.018 * vec2(wave + 0.5 * fine, 0.4 * (wave - fine));
  }

  // One 8-bit step of the screen (sRGB), as wide as it is in linear light at this level.
  vec3 screenStep(vec3 color) {
    return max(2.275 * pow(color, vec3(0.583)), vec3(1.0 / 12.92)) / 255.0;
  }

  void main() {
    // The lit frame's alpha is what hot air leaves of it: 1 or more where there is none (HeatShimmer writes it).
    float hotAir = 1.0 - texture2D(tLit, vUv).a;
    vec2 frame = vec2(aspect, 1.0);
    vec2 seen = vUv;
    if (hotAir > 0.0) seen += hotAir * unit * ripple(vUv * frame / unit) / frame;
    vec3 color = max(texture2D(tLit, seen).rgb + texture2D(tHalo, seen).rgb, 0.0);
    // Toward the grey that is as bright as the color: the frame keeps its light and loses its hues.
    color = mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, saturation);
    // A halo fading to black shows the screen's steps as bands: half a step of noise either way hides them.
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
    gl_FragColor = vec4(max(color + noise * screenStep(color), 0.0), 1.0);
  }
`

interface HaloEffect extends Effect {
  // How much of its hues the frame keeps, 0–1.
  saturation: { value: number }
  // The seconds hot air ripples by, and the share of the frame's height a scene unit takes at the heart of
  // the scene: the ripples keep their size on the model, however far the camera stands.
  time: { value: number }
  unit: { value: number }
  capture: (renderer: WebGLRenderer, scene: Scene, camera: Camera) => void
  dispose: () => void
}

// A halo around what emits light, and around nothing else. Before each frame the scene is drawn once with its
// lights off: only the emissive part of the materials is left (an unlit material is left whole), hidden behind
// whatever stands in front of it. That image, blurred, is the halo. No brightness threshold, so a lit surface
// never glows however bright it is, and a faint emissive glows faintly whatever its color.
function createHalo(): HaloEffect {
  // Half the resolution and no antialiasing: plenty for an image that ends up blurred.
  const glowing = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
  const bloom = new UnrealBloomPass(new Vector2(1, 1), HALO_STRENGTH, HALO_RADIUS, 0)
  // Where the pass leaves the blur alone, before adding it over its input.
  const blurred = bloom.renderTargetsHorizontal[0]
  if (!blurred) throw new Error('UnrealBloomPass has no blurred target')

  const lit: { value: Texture | null } = { value: null }
  const saturation = { value: 1 }
  const time = { value: 0 }
  const aspect = { value: 1 }
  const unit = { value: 1 }
  const sum = new ShaderMaterial({
    uniforms: { tLit: lit, tHalo: { value: blurred.texture }, saturation, time, aspect, unit },
    vertexShader: SUM_VERTEX,
    fragmentShader: SUM_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  })
  const frame = new FullScreenQuad(sum)
  const lights: Light[] = []
  const intensities: number[] = []

  return {
    saturation,
    time,
    unit,

    setSize(width, height) {
      glowing.setSize(Math.round(width / 2), Math.round(height / 2))
      bloom.setSize(width, height)
      aspect.value = width / height
    },

    capture(renderer, scene, camera) {
      lights.length = 0
      scene.traverse((object) => {
        if (object instanceof Light) lights.push(object)
      })
      lights.forEach((light, index) => {
        intensities[index] = light.intensity
        light.intensity = 0
      })
      // Nothing casts a shadow in the dark: the lit frame draws them.
      const shadows = renderer.shadowMap.autoUpdate
      renderer.shadowMap.autoUpdate = false
      renderer.setRenderTarget(glowing)
      renderer.render(scene, camera)
      renderer.shadowMap.autoUpdate = shadows
      lights.forEach((light, index) => {
        light.intensity = intensities[index] ?? 0
      })

      bloom.render(renderer, glowing, glowing, 0, false)
      renderer.setRenderTarget(null)
    },

    render(renderer, writeBuffer, readBuffer) {
      lit.value = readBuffer.texture
      renderer.setRenderTarget(writeBuffer)
      frame.render(renderer)
    },

    dispose() {
      glowing.dispose()
      bloom.dispose()
      sum.dispose()
      frame.dispose()
    },
  }
}

export interface HaloProps {
  // How much of its hues the frame keeps, from 0 (all grey) to 1 (as lit). A change fades in.
  saturation?: number
}

// Takes over the rendering of the Canvas, whose renderer must draw to an HDR buffer (`outputBufferType`):
// three.js only runs effects there. Its pass is the last to touch the frame, halo included: that is where
// the whole frame can lose its hues, and where hot air ripples what is seen through it.
export function Halo({ saturation = 1 }: HaloProps) {
  const gl = useThree((state) => state.gl)
  const halo = useRef<HaloEffect | null>(null)
  const saturationNow = useFade([saturation])

  useEffect(() => {
    const created = createHalo()
    gl.setEffects([created])
    halo.current = created

    return () => {
      halo.current = null
      gl.setEffects(null)
      created.dispose()
    }
  }, [gl])

  // After every other frame callback, so that the halo and the lit frame show the same instant.
  useFrame(({ scene, camera, clock }) => {
    if (halo.current) {
      halo.current.saturation.value = saturationNow()[0] ?? 1
      halo.current.time.value = clock.elapsedTime
      // A perspective's projection holds 1 / tan(half its field of view): what a unit takes of the frame's
      // height, one unit away.
      halo.current.unit.value = (camera.projectionMatrix.elements[5] ?? 1) / (2 * camera.position.length())
      halo.current.capture(gl, scene, camera)
    }
    gl.render(scene, camera)
  }, 1)

  return null
}
